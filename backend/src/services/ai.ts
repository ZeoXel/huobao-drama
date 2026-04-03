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
 * Apply GATEWAY_URL and per-user apiKey overrides.
 * GATEWAY_URL env var, when set, replaces ALL provider baseUrls — all AI requests
 * route through the gateway. User-level apiKey (from auth context) overrides the
 * config-level key for per-user quota isolation.
 */
function applyOverrides(config: AIConfig, apiKey?: string): AIConfig {
  const gatewayUrl = (process.env.GATEWAY_URL || '').trim()
  const userApiKey = (apiKey || '').trim()
  return {
    ...config,
    baseUrl: gatewayUrl || config.baseUrl,
    apiKey: userApiKey || config.apiKey,
  }
}

export function getActiveConfig(serviceType: ServiceType, apiKey?: string): AIConfig | null {
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
    .all()
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

export function getTextConfig(apiKey?: string): AIConfig {
  const config = getActiveConfig('text', apiKey)
  if (!config) throw new Error('No active text AI config')
  return config
}

export function getAudioConfig(apiKey?: string): AIConfig {
  const config = getActiveConfig('audio', apiKey)
  if (!config) throw new Error('No active audio AI config — 请在设置中添加音频服务')
  return config
}

export function getAudioConfigById(id?: number | null, apiKey?: string): AIConfig {
  if (id) {
    const config = getConfigById(id, apiKey)
    if (config) return config
  }
  return getAudioConfig(apiKey)
}

export function getConfigById(id: number, apiKey?: string): AIConfig | null {
  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id)).all()
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
