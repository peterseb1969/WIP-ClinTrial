/**
 * Minimal Anthropic API client using plain fetch (no SDK dependency).
 *
 * Key resolution (mirrors WIP-KB CASE-508): process.env is frozen at process
 * start, so an env-only key can't be rotated without a redeploy. Resolve in
 * priority order so the key is settable in a running system: runtime override
 * (set via the admin config endpoint) -> key file (ANTHROPIC_API_KEY_FILE,
 * mirroring the WIP apiKeyFile pattern) -> env. The key is a secret — it is
 * never stored in a WIP document and never echoed back to a caller.
 */
import { readFileSync, writeFileSync } from 'fs'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
// Cheap model for the liveness probe in validateKey — minimise cost per check.
const VALIDATE_MODEL = 'claude-haiku-4-5'

// ---------- Anthropic key resolution (runtime-settable) ----------
let runtimeKeyOverride: string | null = null

function keyFromFile(): string {
  const f = process.env.ANTHROPIC_API_KEY_FILE
  if (!f) return ''
  try {
    return readFileSync(f, 'utf-8').trim()
  } catch {
    return ''
  }
}

/** Resolve the active Anthropic key: runtime override -> key file -> env. */
function anthropicKey(): string {
  return runtimeKeyOverride || keyFromFile() || process.env.ANTHROPIC_API_KEY || ''
}

function keySource(): 'override' | 'file' | 'env' | 'none' {
  if (runtimeKeyOverride) return 'override'
  if (keyFromFile()) return 'file'
  if (process.env.ANTHROPIC_API_KEY) return 'env'
  return 'none'
}

/** Masked status only — the key value is never returned to a caller. */
export function getKeyStatus() {
  const key = anthropicKey()
  return {
    configured: !!key,
    source: keySource(),
    last4: key ? key.slice(-4) : null,
  }
}

/** Cheap liveness probe — confirm a key actually authenticates before accepting it. */
export async function validateKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: VALIDATE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    if (res.ok) return { ok: true }
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body?.error?.message) detail = body.error.message
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, error: detail }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'validation failed' }
  }
}

/**
 * Set the key in the running system. Updates the in-memory override and, when
 * persist is set and ANTHROPIC_API_KEY_FILE is configured, writes the key file
 * 0600 so it survives a restart (and is picked up by the file-resolve path).
 */
export function setAnthropicKey(
  key: string,
  opts: { persist?: boolean } = {},
): ReturnType<typeof getKeyStatus> & { persisted: boolean } {
  runtimeKeyOverride = key
  let persisted = false
  const f = process.env.ANTHROPIC_API_KEY_FILE
  if (opts.persist && f) {
    writeFileSync(f, key, { mode: 0o600 })
    persisted = true
  }
  return { ...getKeyStatus(), persisted }
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnthropicCallOptions {
  model?: string
  system?: string
  messages: AnthropicMessage[]
  maxTokens?: number
  temperature?: number
}

/**
 * Call the Anthropic Messages API in STREAMING mode and return the
 * concatenated assistant text. Streaming is required for long-running
 * calls — non-streaming requests don't send response headers until the
 * full answer is computed, which trips Node undici's 5-minute
 * headersTimeout and drops the connection (wasting the Claude output).
 */
export async function callClaude(opts: AnthropicCallOptions): Promise<{
  text: string
  usage: { input_tokens: number; output_tokens: number }
}> {
  const apiKey = anthropicKey()
  if (!apiKey) {
    throw new Error('No Anthropic API key configured — set one in Settings')
  }

  const body = {
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.temperature ?? 0,
    stream: true,
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages,
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    const errText = res.body ? await res.text() : `(no body)`
    throw new Error(`Anthropic API ${res.status}: ${errText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  const textChunks: string[] = []
  let inputTokens = 0
  let outputTokens = 0

  // SSE parser: events are separated by blank lines. Each event may
  // contain `event: <name>` and `data: <json>` lines. We care only
  // about content_block_delta (text_delta) and message_delta (usage).
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const dataLines = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
      if (dataLines.length === 0) continue
      const data = dataLines.join('\n')
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data) as {
          type: string
          delta?: { type?: string; text?: string; stop_reason?: string }
          message?: { usage?: { input_tokens: number; output_tokens: number } }
          usage?: { input_tokens?: number; output_tokens?: number }
        }
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          textChunks.push(parsed.delta.text ?? '')
        } else if (parsed.type === 'message_start' && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens
          outputTokens = parsed.message.usage.output_tokens
        } else if (parsed.type === 'message_delta' && parsed.usage) {
          if (parsed.usage.output_tokens !== undefined) outputTokens = parsed.usage.output_tokens
        }
      } catch {
        // Ignore non-JSON data lines (e.g. keep-alive pings)
      }
    }
  }

  return {
    text: textChunks.join(''),
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

/** Extract a JSON block from a Claude response (handles ```json fences). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = fenced ? fenced[1] : text
  // Find first `[` or `{` and last `]` or `}` to be tolerant of prose around the JSON
  const start = Math.min(
    ...['[', '{']
      .map((c) => candidate.indexOf(c))
      .filter((i) => i >= 0),
  )
  const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Could not locate JSON in response: ${text.slice(0, 200)}`)
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T
}
