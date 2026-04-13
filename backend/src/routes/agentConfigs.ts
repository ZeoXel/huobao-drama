import { Hono } from 'hono'
import { eq, isNull, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { DEFAULT_USER_ID as DEFAULT_USER } from '../db/defaults.js'
import '../middleware/context.js'

const app = new Hono()
const uid = (c: any) => (c.get('userId') || '').trim() || DEFAULT_USER

// GET /agent-configs — 合并：用户行覆盖 standalone 默认行（按 agent_type 去重）
app.get('/', async (c) => {
  const userId = uid(c)
  const userRows = await db.select().from(schema.agentConfigs)
    .where(and(eq(schema.agentConfigs.userId, userId), isNull(schema.agentConfigs.deletedAt)))

  let defaultRows: any[] = []
  if (userId !== DEFAULT_USER) {
    defaultRows = await db.select().from(schema.agentConfigs)
      .where(and(eq(schema.agentConfigs.userId, DEFAULT_USER), isNull(schema.agentConfigs.deletedAt)))
  }

  const merged = new Map<string, { row: any; isDefault: boolean }>()
  for (const r of defaultRows) merged.set(r.agentType, { row: r, isDefault: true })
  for (const r of userRows) merged.set(r.agentType, { row: r, isDefault: false })

  const arr = Array.from(merged.values()).map(({ row, isDefault }) => ({
    ...toSnakeCase(row),
    is_default: isDefault,
  }))
  return success(c, arr)
})

// GET /agent-configs/:id — 用户优先，回落 standalone
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const userId = uid(c)
  let [row] = await db.select().from(schema.agentConfigs)
    .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, userId)))
  let isDefault = false
  if (!row && userId !== DEFAULT_USER) {
    ;[row] = await db.select().from(schema.agentConfigs)
      .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, DEFAULT_USER)))
    isDefault = !!row
  }
  if (!row) return badRequest(c, 'Not found')
  return success(c, { ...toSnakeCase(row), is_default: isDefault })
})

// POST /agent-configs (upsert by agent_type, 按用户隔离)
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.agent_type) return badRequest(c, 'agent_type required')
  const ts = now()
  const userId = uid(c)

  const [existing] = await db.select().from(schema.agentConfigs)
    .where(and(
      eq(schema.agentConfigs.agentType, body.agent_type),
      eq(schema.agentConfigs.userId, userId),
    ))

  if (existing) {
    await db.update(schema.agentConfigs).set({
      name: body.name || existing.name,
      model: body.model ?? existing.model,
      systemPrompt: body.system_prompt ?? existing.systemPrompt,
      temperature: body.temperature ?? existing.temperature,
      maxTokens: body.max_tokens ?? existing.maxTokens,
      maxIterations: body.max_iterations ?? existing.maxIterations,
      isActive: body.is_active ?? true,
      deletedAt: null,
      updatedAt: ts,
    }).where(eq(schema.agentConfigs.id, existing.id))
    const [row] = await db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.id, existing.id))
    return success(c, toSnakeCase(row))
  }

  const [result] = await db.insert(schema.agentConfigs).values({
    userId,
    agentType: body.agent_type,
    name: body.name || '',
    description: body.description || '',
    model: body.model || '',
    systemPrompt: body.system_prompt || '',
    temperature: body.temperature ?? 0.7,
    maxTokens: body.max_tokens ?? 4096,
    maxIterations: body.max_iterations ?? 10,
    isActive: body.is_active ?? true,
    createdAt: ts,
    updatedAt: ts,
  }).returning()
  return success(c, toSnakeCase(result))
})

// PUT /agent-configs/:id — 若目标为 standalone 默认行且调用者非 standalone，写时复制
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const userId = uid(c)
  const ts = now()

  const applyBody = (base: any) => ({
    name: 'name' in body ? body.name : base.name,
    description: 'description' in body ? body.description : base.description,
    model: 'model' in body ? body.model : base.model,
    systemPrompt: 'system_prompt' in body ? body.system_prompt : base.systemPrompt,
    temperature: 'temperature' in body ? body.temperature : base.temperature,
    maxTokens: 'max_tokens' in body ? body.max_tokens : base.maxTokens,
    maxIterations: 'max_iterations' in body ? body.max_iterations : base.maxIterations,
    isActive: 'is_active' in body ? body.is_active : base.isActive,
  })

  const [own] = await db.select().from(schema.agentConfigs)
    .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, userId)))
  if (own) {
    await db.update(schema.agentConfigs).set({ ...applyBody(own), updatedAt: ts })
      .where(eq(schema.agentConfigs.id, id))
    const [row] = await db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.id, id))
    return success(c, row ? toSnakeCase(row) : null)
  }

  if (userId !== DEFAULT_USER) {
    const [def] = await db.select().from(schema.agentConfigs)
      .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, DEFAULT_USER)))
    if (def) {
      // 若用户已有同 agent_type 行（含 soft-deleted）则更新；否则插入
      const [existing] = await db.select().from(schema.agentConfigs)
        .where(and(
          eq(schema.agentConfigs.agentType, def.agentType),
          eq(schema.agentConfigs.userId, userId),
        ))
      const payload = applyBody(def)
      if (existing) {
        await db.update(schema.agentConfigs)
          .set({ ...payload, deletedAt: null, updatedAt: ts })
          .where(eq(schema.agentConfigs.id, existing.id))
        const [row] = await db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.id, existing.id))
        return success(c, row ? toSnakeCase(row) : null)
      }
      const [created] = await db.insert(schema.agentConfigs).values({
        userId,
        agentType: def.agentType,
        ...payload,
        createdAt: ts,
        updatedAt: ts,
      }).returning()
      return success(c, toSnakeCase(created))
    }
  }
  return badRequest(c, 'Not found')
})

// DELETE /agent-configs/:id — 仅能软删自己的行；standalone 默认行不可删
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const userId = uid(c)
  if (userId !== DEFAULT_USER) {
    const [def] = await db.select().from(schema.agentConfigs)
      .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, DEFAULT_USER)))
    if (def) return badRequest(c, '默认配置不可删除，请创建用户覆盖后再调整')
  }
  await db.update(schema.agentConfigs).set({ deletedAt: now() })
    .where(and(eq(schema.agentConfigs.id, id), eq(schema.agentConfigs.userId, userId)))
  return success(c)
})

export default app
