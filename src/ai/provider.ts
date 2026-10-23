import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getConfig } from '../config.js'

// Current-generation ids, deliberately undated: a dated snapshot goes stale
// silently. Override either with SHADE_AI_MODEL.
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
const DEFAULT_OPENAI_MODEL = 'gpt-5.2'

// Every AI-backed tool asks for JSON. A cap this low truncates the reply
// mid-object, JSON.parse fails, and the caller silently gets the fallback
// shape instead of an analysis — so the ceiling is generous rather than tight.
const DEFAULT_MAX_TOKENS = 2000

/**
 * Bounds every provider request. Without a timeout the SDK waits ~10 minutes,
 * and the calling tool holds its browser slot for the duration; retries are
 * capped at one so a stalling provider cannot multiply that wait.
 */
export function aiClientOptions(): { timeout: number; maxRetries: number } {
  return { timeout: getConfig().aiTimeoutMs, maxRetries: 1 }
}

export interface AIProvider {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
}

export interface CallAIOptions {
  system: string
  userContent: Array<{ type: string; text?: string; image_url?: { url: string } }>
  maxTokens?: number
  jsonMode?: boolean
  ai: AIProvider
}

function readKeyFile(projectRoot: string, filename: string): string | null {
  try {
    const key = readFileSync(join(projectRoot, filename), 'utf-8').trim()
    return key || null
  } catch {
    return null
  }
}

export function getAIProvider(options: { projectRoot: string }): AIProvider | null {
  // Env vars first (highest priority)
  const model = getConfig().aiModel
  const anthropicEnv = process.env.ANTHROPIC_API_KEY
  if (anthropicEnv) {
    return { provider: 'anthropic', apiKey: anthropicEnv, model: model ?? DEFAULT_ANTHROPIC_MODEL }
  }
  const openaiEnv = process.env.OPENAI_API_KEY
  if (openaiEnv) {
    return { provider: 'openai', apiKey: openaiEnv, model: model ?? DEFAULT_OPENAI_MODEL }
  }
  // Dotfiles
  const anthropicKey = readKeyFile(options.projectRoot, '.anthropic')
  if (anthropicKey) {
    return { provider: 'anthropic', apiKey: anthropicKey, model: model ?? DEFAULT_ANTHROPIC_MODEL }
  }
  const openaiKey = readKeyFile(options.projectRoot, '.openai')
  if (openaiKey) {
    return { provider: 'openai', apiKey: openaiKey, model: model ?? DEFAULT_OPENAI_MODEL }
  }
  return null
}

export async function callAI(options: CallAIOptions): Promise<string | null> {
  if (options.ai.provider === 'anthropic') {
    return callAnthropic(options)
  }
  return callOpenAI(options)
}

async function callAnthropic(options: CallAIOptions): Promise<string | null> {
  const client = new Anthropic({ apiKey: options.ai.apiKey, ...aiClientOptions(), openTelemetry: false })

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = options.userContent.map(block => {
    if (block.type === 'image_url' && block.image_url) {
      const url = block.image_url.url
      const match = url.match(/^data:(image\/\w+);base64,(.+)$/)
      if (match) {
        return {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: match[1] as 'image/png', data: match[2] }
        }
      }
    }
    return { type: 'text' as const, text: block.text || '' }
  })

  let system = options.system
  if (options.jsonMode) {
    system += '\n\nRespond with valid JSON only. Do not include Markdown or explanations.'
  }

  const response = await client.messages.create({
    model: options.ai.model,
    max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content }]
  })

  const textBlock = response.content.find((b: Anthropic.ContentBlock) => b.type === 'text')
  return textBlock && 'text' in textBlock ? textBlock.text : null
}

async function callOpenAI(options: CallAIOptions): Promise<string | null> {
  const client = new OpenAI({ apiKey: options.ai.apiKey, ...aiClientOptions() })

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.userContent.map(block => {
      if (block.type === 'image_url' && block.image_url) {
        return { type: 'image_url' as const, image_url: { url: block.image_url.url } }
      }
      return { type: 'text' as const, text: block.text || '' }
    })}
  ]

  const response = await client.chat.completions.create({
    model: options.ai.model,
    max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    messages,
    ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {})
  })

  return response.choices[0]?.message?.content || null
}

export const NO_AI_KEY_MESSAGE = 'No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY. Alternatively, create a .anthropic or .openai file in the project root.'
