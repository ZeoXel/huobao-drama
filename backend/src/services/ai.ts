/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { and, eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

import { DEFAULT_USER_ID } from '../db/defaults.js'
function resolveUserId(userId?: string): string {
  return (userId || '').trim() || DEFAULT_USER_ID
}

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

async function pickActiveRow(serviceType: ServiceType, uid: string) {
  const allRows = await db.select().from(schema.aiServiceConfigs)
    .where(and(
      eq(schema.aiServiceConfigs.serviceType, serviceType),
      eq(schema.aiServiceConfigs.userId, uid),
    ))
  return allRows
    .filter((r: any) => r.isActive)
    .sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))[0] || null
}

export async function getActiveConfig(serviceType: ServiceType, apiKey?: string, userId?: string): Promise<AIConfig | null> {
  const uid = resolveUserId(userId)
  let active = await pickActiveRow(serviceType, uid)
  let fromDefault = false
  if (!active && uid !== DEFAULT_USER_ID) {
    active = await pickActiveRow(serviceType, DEFAULT_USER_ID)
    fromDefault = !!active
  }
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType, userId: uid })
    return null
  }
  if (fromDefault) {
    logTaskProgress('AIConfig', 'active-config-fallback-default', { serviceType, userId: uid })
  }

  const models = active.model ? JSON.parse(active.model) : []
  logTaskProgress('AIConfig', 'active-config-selected', {
    serviceType,
    configId: active.id,
    provider: active.provider,
    model: models[0] || '',
    priority: active.priority,
    userId: uid,
  })
  const config: AIConfig = {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
  }
  return applyOverrides(config, apiKey)
}

export async function getTextConfig(apiKey?: string, userId?: string): Promise<AIConfig> {
  const config = await getActiveConfig('text', apiKey, userId)
  if (!config) throw new Error('No active text AI config')
  return config
}

export async function getAudioConfig(apiKey?: string, userId?: string): Promise<AIConfig> {
  const config = await getActiveConfig('audio', apiKey, userId)
  if (!config) throw new Error('No active audio AI config — 请在设置中添加音频服务')
  return config
}

export async function getAudioConfigById(id?: number | null, apiKey?: string, userId?: string): Promise<AIConfig> {
  if (id) {
    const config = await getConfigById(id, apiKey, userId)
    if (config) return config
  }
  return getAudioConfig(apiKey, userId)
}

export async function getConfigById(id: number, apiKey?: string, userId?: string): Promise<AIConfig | null> {
  const uid = resolveUserId(userId)
  let [row] = await db.select().from(schema.aiServiceConfigs)
    .where(and(
      eq(schema.aiServiceConfigs.id, id),
      eq(schema.aiServiceConfigs.userId, uid),
    ))
  if (!row && uid !== DEFAULT_USER_ID) {
    ;[row] = await db.select().from(schema.aiServiceConfigs)
      .where(and(
        eq(schema.aiServiceConfigs.id, id),
        eq(schema.aiServiceConfigs.userId, DEFAULT_USER_ID),
      ))
  }
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id, userId: uid })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  logTaskProgress('AIConfig', 'config-by-id-selected', {
    configId: id,
    provider: row.provider,
    model: models[0] || '',
    serviceType: row.serviceType,
    userId: uid,
  })
  const config: AIConfig = {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
  }
  return applyOverrides(config, apiKey)
}
