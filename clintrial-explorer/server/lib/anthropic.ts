/**
 * Minimal Anthropic API client using plain fetch (no SDK dependency).
 * Reads ANTHROPIC_API_KEY from process.env at call time.
 */

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-6'

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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set in environment')
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
