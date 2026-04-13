import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import '../middleware/context.js'

import {
  DEFAULT_USER_ID as DEFAULT_USER,
  HUOBAO_PRESET_SERVICES,
  HUOBAO_AGENT_DEFAULTS,
  HUOBAO_AGENT_MODEL,
} from '../db/defaults.js'

const app = new Hono()
const uid = (c: any) => (c.get('userId') || '').trim() || DEFAULT_USER

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function viduHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Token ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${m || 'gemini-2.5-flash'}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return { method: 'POST', url: url.toString(), headers: geminiHeaders(apiKey, true), body: {} }
  }

  if (p === 'openai' || p === 'openrouter' || p === 'chatfire') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'ali') {
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', serviceType === 'video'
        ? '/services/aigc/video-generation/video-synthesis'
        : '/services/aigc/image-generation/generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    const path = serviceType === 'audio'
      ? '/t2a_v2'
      : serviceType === 'video'
        ? '/video_generation'
        : '/image_generation'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v1', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'vidu') {
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '', '/ent/v2/img2video'),
      headers: viduHeaders(apiKey, true),
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text
// 合并策略：用户行覆盖 standalone 默认行（按 service_type+provider 去重）
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  const userId = uid(c)

  const userRows = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.userId, userId))

  let defaultRows: any[] = []
  if (userId !== DEFAULT_USER) {
    defaultRows = await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.userId, DEFAULT_USER))
  }

  const key = (r: any) => `${r.serviceType}::${r.provider || ''}`
  const merged = new Map<string, any>()
  for (const r of defaultRows) merged.set(key(r), { row: r, isDefault: true })
  for (const r of userRows) merged.set(key(r), { row: r, isDefault: false })

  let items = Array.from(merged.values())
  if (serviceType) items = items.filter(it => it.row.serviceType === serviceType)

  const parsed = items.map(({ row, isDefault }) => ({
    ...toSnakeCase(row),
    // 默认行对非 standalone 用户屏蔽 api_key，避免密钥泄露
    api_key: isDefault ? '' : row.apiKey,
    model: row.model ? JSON.parse(row.model) : [],
    is_default: isDefault,
  }))
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段
  if (!body.service_type || !body.provider) {
    return badRequest(c, 'service_type and provider are required')
  }

  const [row] = await db.insert(schema.aiServiceConfigs).values({
    userId: uid(c),
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  }).returning()

  return created(c, {
    ...toSnakeCase(row),
    model: row.model ? JSON.parse(row.model) : [],
  })
})

// POST /ai-configs/huobao-preset
app.post('/huobao-preset', async (c) => {
  const body = await c.req.json()
  const apiKey = String(body.api_key || '').trim()
  if (!apiKey) return badRequest(c, 'api_key is required')

  const ts = now()
  const userId = uid(c)

  for (const preset of HUOBAO_PRESET_SERVICES) {
    const allForType = await db.select().from(schema.aiServiceConfigs)
      .where(and(eq(schema.aiServiceConfigs.serviceType, preset.serviceType), eq(schema.aiServiceConfigs.userId, userId)))
    const [existing] = allForType.filter(row => row.provider === preset.provider)

    const values = {
      userId,
      serviceType: preset.serviceType,
      provider: preset.provider,
      name: `火宝默认${preset.label}服务`,
      baseUrl: preset.baseUrl,
      apiKey,
      model: JSON.stringify([preset.model]),
      priority: preset.priority,
      isActive: true,
      updatedAt: ts,
    }

    if (existing) {
      await db.update(schema.aiServiceConfigs).set(values).where(eq(schema.aiServiceConfigs.id, existing.id))
    } else {
      await db.insert(schema.aiServiceConfigs).values({
        ...values,
        createdAt: ts,
      })
    }
  }

  for (const agent of HUOBAO_AGENT_DEFAULTS) {
    const [existing] = await db.select().from(schema.agentConfigs)
      .where(and(eq(schema.agentConfigs.agentType, agent.agentType), eq(schema.agentConfigs.userId, userId)))
    const values = {
      userId,
      name: agent.name,
      model: HUOBAO_AGENT_MODEL,
      isActive: true,
      updatedAt: ts,
    }

    if (existing) {
      await db.update(schema.agentConfigs).set(values).where(eq(schema.agentConfigs.id, existing.id))
    } else {
      await db.insert(schema.agentConfigs).values({
        userId,
        agentType: agent.agentType,
        description: '',
        model: HUOBAO_AGENT_MODEL,
        name: agent.name,
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 4096,
        maxIterations: 10,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }

  const allConfigs = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.userId, userId))
  const configs = allConfigs.map(row => ({
    ...toSnakeCase(row),
    model: row.model ? JSON.parse(row.model) : [],
  }))
  const allAgents = await db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.userId, userId))
  const agents = allAgents.map(row => toSnakeCase(row))

  logTaskSuccess('AIConfig', 'huobao-preset-applied', {
    serviceCount: HUOBAO_PRESET_SERVICES.length,
    agentCount: HUOBAO_AGENT_DEFAULTS.length,
  })

  return success(c, {
    configs,
    agents,
    agent_model: HUOBAO_AGENT_MODEL,
  })
})

// POST /ai-configs/test
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, 'service_type, provider and base_url are required')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    const payload = {
      ok: resp.ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// GET /ai-configs/:id — 先查用户行；不存在回落 standalone
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const userId = uid(c)
  let [row] = await db.select().from(schema.aiServiceConfigs)
    .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, userId)))
  let isDefault = false
  if (!row && userId !== DEFAULT_USER) {
    ;[row] = await db.select().from(schema.aiServiceConfigs)
      .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, DEFAULT_USER)))
    isDefault = !!row
  }
  if (!row) return notFound(c)
  return success(c, {
    ...toSnakeCase(row),
    api_key: isDefault ? '' : row.apiKey,
    model: row.model ? JSON.parse(row.model) : [],
    is_default: isDefault,
  })
})

// PUT /ai-configs/:id — 若 id 指向 standalone 行且调用者非 standalone，写时复制
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const userId = uid(c)
  const ts = now()

  const applyBody = (base: any) => ({
    provider: 'provider' in body ? body.provider : base.provider,
    name: 'name' in body ? body.name : base.name,
    baseUrl: 'base_url' in body ? body.base_url : base.baseUrl,
    apiKey: 'api_key' in body ? body.api_key : base.apiKey,
    model: 'model' in body ? JSON.stringify(body.model) : base.model,
    priority: 'priority' in body ? body.priority : base.priority,
    isActive: 'is_active' in body ? body.is_active : base.isActive,
  })

  // 用户自己行
  const [own] = await db.select().from(schema.aiServiceConfigs)
    .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, userId)))
  if (own) {
    await db.update(schema.aiServiceConfigs)
      .set({ ...applyBody(own), updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, id))
    return success(c)
  }

  // 回落：检查是否 standalone 默认行 → 写时复制
  if (userId !== DEFAULT_USER) {
    const [def] = await db.select().from(schema.aiServiceConfigs)
      .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, DEFAULT_USER)))
    if (def) {
      // 若同 userId+service_type+provider 已存在覆盖行则更新，否则插入
      const [existing] = await db.select().from(schema.aiServiceConfigs).where(and(
        eq(schema.aiServiceConfigs.userId, userId),
        eq(schema.aiServiceConfigs.serviceType, def.serviceType),
        eq(schema.aiServiceConfigs.provider, def.provider as any),
      ))
      const payload = applyBody(def)
      if (existing) {
        await db.update(schema.aiServiceConfigs).set({ ...payload, updatedAt: ts })
          .where(eq(schema.aiServiceConfigs.id, existing.id))
        return success(c, { copied_from_default: def.id, user_row_id: existing.id })
      }
      const [created] = await db.insert(schema.aiServiceConfigs).values({
        userId,
        serviceType: def.serviceType,
        ...payload,
        createdAt: ts,
        updatedAt: ts,
      }).returning()
      return success(c, { copied_from_default: def.id, user_row_id: created.id })
    }
  }
  return notFound(c)
})

// DELETE /ai-configs/:id — 仅能删自己的行；standalone 默认行不可删
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const userId = uid(c)
  if (userId !== DEFAULT_USER) {
    const [def] = await db.select().from(schema.aiServiceConfigs)
      .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, DEFAULT_USER)))
    if (def) return badRequest(c, '默认配置不可删除，请创建用户覆盖后再调整')
  }
  await db.delete(schema.aiServiceConfigs)
    .where(and(eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.userId, userId)))
  return success(c)
})

// GET /ai-providers
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = await db.select().from(schema.aiServiceProviders)
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
