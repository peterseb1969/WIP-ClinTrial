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

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

/** Call the Anthropic Messages API and return the assistant text. */
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

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${errText}`)
  }

  const data = (await res.json()) as AnthropicResponse
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  return { text, usage: data.usage }
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
