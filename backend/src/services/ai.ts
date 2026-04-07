/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

export type ServiceType = 'text' | 'image' | 'video' | 'audio'

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai' || provider === 'openrouter' || provider === 'chatfire') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  if (provider === 'ali') {
    return joinProviderUrl(config.baseUrl, '/api/v1', '')
  }

  return config.baseUrl
}

/**
 * Gateway sub-path per provider.
 * Most providers use OpenAI-compatible /v1/* via the gateway root.
 * Only providers with non-OpenAI native APIs need sub-paths:
 *   minimax → GATEWAY/minimax (native /v1/t2a_v2 etc.)
 *   kling   → GATEWAY/kling   (native /v1/videos/*)
 * volcengine, vidu, ali route via model name through /v1/* endpoints.
 */
const GATEWAY_PROVIDER_PATH: Record<string, string> = {
  minimax: '/minimax',
  kling: '/kling',
}

/**
 * Apply GATEWAY_URL and per-user apiKey overrides.
 * GATEWAY_URL env var, when set, replaces provider baseUrls with the correct
 * gateway sub-path. User-level apiKey overrides config-level key for quota isolation.
 */
function applyOverrides(config: AIConfig, apiKey?: string): AIConfig {
  const gatewayUrl = (process.env.GATEWAY_URL || '').trim().replace(/\/+$/, '')
  const userApiKey = (apiKey || '').trim()

  let baseUrl = config.baseUrl
  if (gatewayUrl) {
    const subPath = GATEWAY_PROVIDER_PATH[config.provider.toLowerCase()] || ''
    baseUrl = `${gatewayUrl}${subPath}`
  }

  return {
    ...config,
    baseUrl,
    apiKey: userApiKey || config.apiKey,
  }
}

export async function getActiveConfig(serviceType: ServiceType, apiKey?: string): Promise<AIConfig | null> {
  const allRows = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  const rows = allRows
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)) // 高优先级优先

  const active = rows[0]
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  logTaskProgress('AIConfig', 'active-config-selected', {
    serviceType,
    configId: active.id,
    provider: active.provider,
    model: models[0] || '',
    priority: active.priority,
  })
  const config: AIConfig = {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
  }
  return applyOverrides(config, apiKey)
}

export async function getTextConfig(apiKey?: string): Promise<AIConfig> {
  const config = await getActiveConfig('text', apiKey)
  if (!config) throw new Error('No active text AI config')
  return config
}

export async function getAudioConfig(apiKey?: string): Promise<AIConfig> {
  const config = await getActiveConfig('audio', apiKey)
  if (!config) throw new Error('No active audio AI config — 请在设置中添加音频服务')
  return config
}

export async function getAudioConfigById(id?: number | null, apiKey?: string): Promise<AIConfig> {
  if (id) {
    const config = await getConfigById(id, apiKey)
    if (config) return config
  }
  return getAudioConfig(apiKey)
}

export async function getConfigById(id: number, apiKey?: string): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  logTaskProgress('AIConfig', 'config-by-id-selected', {
    configId: id,
    provider: row.provider,
    model: models[0] || '',
    serviceType: row.serviceType,
  })
  const config: AIConfig = {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
  }
  return applyOverrides(config, apiKey)
}
