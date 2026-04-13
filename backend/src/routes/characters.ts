import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { generateVoiceSample } from '../services/tts-generation.js'
import { generateImage } from '../services/image-generation.js'
import { getDramaStyle, appendStyle } from '../utils/drama-style.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import '../middleware/context.js'

const app = new Hono()

// POST /characters — 手动新增角色
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id || !body.name) return badRequest(c, 'drama_id and name are required')
  const ts = now()
  const [result] = await db.insert(schema.characters).values({
    dramaId: Number(body.drama_id),
    name: String(body.name),
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    personality: body.personality || '',
    voiceStyle: body.voice_style || null,
    voiceProvider: body.voice_provider || null,
    createdAt: ts,
    updatedAt: ts,
  }).returning()

  const episodeId = Number(body.episode_id || 0)
  if (episodeId) {
    await db.insert(schema.episodeCharacters).values({
      episodeId,
      characterId: result.id,
      createdAt: ts,
    })
  }
  return success(c, result)
})

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of ['name', 'role', 'description', 'appearance', 'personality', 'voiceStyle', 'voiceProvider', 'imageUrl', 'localPath']) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  if ('voice_style' in body || 'voiceStyle' in body) {
    updates.voiceSampleUrl = null
  }
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// DELETE /characters/:id — 软删除角色，同时清理链接表避免孤立引用
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const ts = now()
  await db.update(schema.characters).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.characters.id, id))
  await db.delete(schema.episodeCharacters).where(eq(schema.episodeCharacters.characterId, id))
  await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.characterId, id))
  return success(c)
})

// POST /characters/:id/generate-voice-sample — 生成角色音色试听
app.post('/:id/generate-voice-sample', async (c) => {
  const id = Number(c.req.param('id'))
  const apiKey = c.get('apiKey') || ''
  const body = await c.req.json().catch(() => ({}))
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, 'Character not found')
  if (!char.voiceStyle) return badRequest(c, '请先分配音色')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  try {
    logTaskStart('VoiceSample', 'generate', { characterId: id, characterName: char.name, episodeId: ep.id, voice: char.voiceStyle })
    const audioPath = await generateVoiceSample(char.name, char.voiceStyle, ep.audioConfigId ?? undefined, apiKey, c.get('userId') || 'standalone')
    await db.update(schema.characters)
      .set({ voiceSampleUrl: audioPath, updatedAt: now() })
      .where(eq(schema.characters.id, id))
    logTaskSuccess('VoiceSample', 'generate', { characterId: id, path: audioPath })
    return success(c, { voice_sample_url: audioPath })
  } catch (err: any) {
    logTaskError('VoiceSample', 'generate', { characterId: id, error: err.message })
    return badRequest(c, `TTS 生成失败: ${err.message}`)
  }
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const apiKey = c.get('apiKey') || ''
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, 'Character not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  const style = await getDramaStyle(char.dramaId)
  const basePrompt = body.prompt || `${char.name}, ${char.appearance || char.description || '人物立绘'}, 高质量, 正面, 白色背景`
  const prompt = appendStyle(basePrompt, style)
  try {
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId, style })
    const genId = await generateImage({ characterId: id, dramaId: char.dramaId, prompt, configId: ep.imageConfigId ?? undefined, apiKey, userId: c.get('userId') || 'standalone' })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const apiKey = c.get('apiKey') || ''
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')
  const results: number[] = []
  const styleCache = new Map<number, string>()
  for (const cid of ids) {
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, cid))
    if (!char) continue
    let style = styleCache.get(char.dramaId)
    if (!style) {
      style = await getDramaStyle(char.dramaId)
      styleCache.set(char.dramaId, style)
    }
    const prompt = appendStyle(`${char.name}, ${char.appearance || char.description || '人物立绘'}, 高质量, 正面, 白色背景`, style)
    try {
      const genId = await generateImage({ characterId: cid, dramaId: char.dramaId, prompt, configId: ep.imageConfigId ?? undefined, apiKey, userId: c.get('userId') || 'standalone' })
      results.push(genId)
    } catch {}
  }
  logTaskSuccess('CharacterImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})

export default app
