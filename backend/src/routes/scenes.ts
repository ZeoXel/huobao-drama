import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { getDramaStyle, appendStyle } from '../utils/drama-style.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import '../middleware/context.js'

const app = new Hono()

// POST /scenes
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id || !body.location) return badRequest(c, 'drama_id and location are required')
  const ts = now()
  const [result] = await db.insert(schema.scenes).values({
    dramaId: Number(body.drama_id),
    episodeId: body.episode_id ? Number(body.episode_id) : null,
    location: body.location,
    time: body.time || '',
    prompt: body.prompt || body.location,
    createdAt: ts,
    updatedAt: ts,
  }).returning()
  const episodeId = Number(body.episode_id || 0)
  if (episodeId) {
    await db.insert(schema.episodeScenes).values({
      episodeId,
      sceneId: result.id,
      createdAt: ts,
    })
  }
  return created(c, result)
})

// PUT /scenes/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.location !== undefined) updates.location = body.location
  if (body.time !== undefined) updates.time = body.time
  if (body.prompt !== undefined) updates.prompt = body.prompt
  await db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, id))
  return success(c)
})

// POST /scenes/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const apiKey = c.get('apiKey') || ''
  const body = await c.req.json()
  const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, id))
  if (!scene) return badRequest(c, 'Scene not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  const style = await getDramaStyle(scene.dramaId)
  const basePrompt = body.prompt || scene.prompt || `${scene.location}, ${scene.time || ''}, 高质量场景, 电影感`
  const prompt = appendStyle(basePrompt, style)
  try {
    logTaskStart('SceneImage', 'generate', { sceneId: id, episodeId: ep.id, dramaId: scene.dramaId, location: scene.location, style })
    await db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, id))
    const genId = await generateImage({ sceneId: id, dramaId: scene.dramaId, prompt, configId: ep.imageConfigId ?? undefined, apiKey, userId: c.get('userId') || 'standalone' })
    logTaskSuccess('SceneImage', 'generate', { sceneId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('SceneImage', 'generate', { sceneId: id, error: err.message })
    await db.update(schema.scenes).set({ status: 'failed', updatedAt: now() }).where(eq(schema.scenes.id, id))
    return badRequest(c, err.message)
  }
})

// DELETE /scenes/:id — 软删除场景，清理 episode 关联，置空已引用该场景的镜头 scene_id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const ts = now()
  await db.update(schema.scenes).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.scenes.id, id))
  await db.delete(schema.episodeScenes).where(eq(schema.episodeScenes.sceneId, id))
  await db.update(schema.storyboards)
    .set({ sceneId: null, updatedAt: ts })
    .where(eq(schema.storyboards.sceneId, id))
  return success(c)
})

export default app
