# Studio Platform Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Studio gateway routing, auth middleware with user isolation, and COS cloud storage to the upstream TypeScript codebase — without touching any adapter or generation logic.

**Architecture:** Three independent layers wrap the existing generation pipeline: (1) auth middleware extracts userId/apiKey from headers and injects them into Hono context, (2) a `GATEWAY_URL` env var overrides all AI config baseUrls at read-time, (3) a storage abstraction replaces direct `fs.writeFileSync` calls with a pluggable backend (local or COS). All layers default to standalone/local behavior when env vars are absent.

**Tech Stack:** Hono middleware, jose (JWT), cos-nodejs-sdk-v5, Drizzle ORM (SQLite), Nuxt 3 plugins/composables

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/middleware/auth.ts` | Create | JWT validation, standalone fallback, context injection |
| `backend/src/middleware/context.ts` | Create | TypeScript types for auth context keys |
| `backend/src/index.ts` | Modify:33-38 | Register auth middleware, expand CORS origins |
| `backend/src/services/ai.ts` | Modify:36-62 | Gateway URL override in `getActiveConfig()` |
| `backend/src/db/schema.ts` | Modify | Add `userId` column to 6 tables |
| `backend/src/db/index.ts` | Modify | Add `userId` column DDL + backfill |
| `backend/src/routes/dramas.ts` | Modify | Filter by userId in all queries |
| `backend/src/routes/images.ts` | Modify | Pass userId to generation, filter queries |
| `backend/src/routes/videos.ts` | Modify | Pass userId to generation, filter queries |
| `backend/src/routes/episodes.ts` | Modify | Filter by drama ownership |
| `backend/src/utils/storage.ts` | Modify | Refactor to StorageBackend interface + LocalStorage impl |
| `backend/src/utils/cos-storage.ts` | Create | COS storage backend implementation |
| `backend/src/utils/cos-keys.ts` | Create | COS key path builders (user-scoped) |
| `backend/src/services/image-generation.ts` | Modify | Use storage.save() instead of downloadFile() |
| `backend/src/services/video-generation.ts` | Modify | Use storage.save() instead of downloadFile() |
| `backend/src/services/tts-generation.ts` | Modify | Use storage.save() instead of fs.writeFileSync() |
| `frontend/app/plugins/studio-auth.client.ts` | Create | PostMessage listener, DRAMA_READY signal |
| `frontend/app/composables/useAuth.ts` | Create | Auth state (token/apiKey/userId) |
| `frontend/app/composables/useApi.ts` | Modify:3-4 | Inject auth headers into requests |

---

## Task 1: Auth Context Types

**Files:**
- Create: `backend/src/middleware/context.ts`

- [ ] **Step 1: Create context type definitions**

```typescript
// backend/src/middleware/context.ts

/**
 * Auth context keys — injected by auth middleware, consumed by route handlers.
 */
export interface AuthContext {
  userId: string
  apiKey: string
}

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    apiKey: string
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to context.ts (other pre-existing errors are OK)

- [ ] **Step 3: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/middleware/context.ts
git commit -m "feat: add auth context type definitions for Hono"
```

---

## Task 2: Auth Middleware

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Modify: `backend/src/index.ts:1-38`

- [ ] **Step 1: Create auth middleware**

```typescript
// backend/src/middleware/auth.ts
import type { MiddlewareHandler } from 'hono'
import './context.js'

/**
 * Auth middleware — dual mode:
 * 1. Studio mode: Bearer JWT → validate with NEXTAUTH_SECRET, extract userId from claims
 * 2. Standalone mode: no Authorization header → userId from X-User-ID or 'standalone'
 *
 * Always sets c.set('userId', ...) and c.set('apiKey', ...) for downstream handlers.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = (c.req.header('Authorization') || '').trim()

  // Standalone mode: no auth header
  if (!authHeader) {
    const userId = c.req.header('X-User-ID')?.trim() || 'standalone'
    c.set('userId', userId)
    c.set('apiKey', '')
    return next()
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'invalid authorization header' }, 401)
  }

  const secret = process.env.NEXTAUTH_SECRET || ''
  if (!secret) {
    // Secret not configured — fall back to standalone
    const userId = c.req.header('X-User-ID')?.trim() || 'standalone'
    c.set('userId', userId)
    c.set('apiKey', '')
    return next()
  }

  const tokenStr = authHeader.slice(7).trim()
  try {
    // Dynamic import jose to avoid top-level dependency when unused
    const { jwtVerify } = await import('jose')
    const secretKey = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(tokenStr, secretKey, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    })

    const userId = (payload.id as string) || (payload.sub as string) || ''
    if (!userId) {
      return c.json({ error: 'missing user id in token' }, 401)
    }

    c.set('userId', userId)
    c.set('apiKey', (c.req.header('X-API-Key') || '').trim())
    return next()
  } catch {
    return c.json({ error: 'invalid or expired token' }, 401)
  }
}
```

- [ ] **Step 2: Install jose dependency**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && npm install jose`
Expected: added 1 package

- [ ] **Step 3: Register middleware and expand CORS in index.ts**

Replace lines 32-38 in `backend/src/index.ts`:

Old:
```typescript
// Middleware
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)
```

New:
```typescript
// Middleware
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use('*', cors({
  origin: [
    'http://localhost:3013',
    'http://localhost:5679',
    ...corsOrigins,
  ],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Auth — must be after logger, before routes
import { authMiddleware } from './middleware/auth.js'
app.use('/api/*', authMiddleware)
```

- [ ] **Step 4: Verify server starts**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && timeout 5 npx tsx src/index.ts 2>&1 || true`
Expected: "Huobao Drama TS server on http://localhost:5679" (then timeout kills it)

- [ ] **Step 5: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/middleware/auth.ts backend/src/index.ts backend/package.json backend/package-lock.json
git commit -m "feat: add dual-mode auth middleware (Studio JWT + standalone)"
```

---

## Task 3: Gateway URL Override

**Files:**
- Modify: `backend/src/services/ai.ts:36-62`

- [ ] **Step 1: Add gateway override to getActiveConfig()**

Replace the `getActiveConfig` function (lines 36-63) in `backend/src/services/ai.ts`:

Old:
```typescript
export function getActiveConfig(serviceType: ServiceType): AIConfig | null {
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
  return {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
  }
}
```

New:
```typescript
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
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

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
```

- [ ] **Step 2: Update getConfigById to accept apiKey**

Replace `getConfigById` (lines 85-105):

Old:
```typescript
export function getConfigById(id: number): AIConfig | null {
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
  return {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
  }
}
```

New:
```typescript
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
```

- [ ] **Step 3: Update convenience functions**

Replace `getTextConfig`, `getAudioConfig`, `getAudioConfigById` (lines 65-83):

```typescript
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
```

- [ ] **Step 4: Verify no import errors**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (callers passing 0 args still work since apiKey is optional)

- [ ] **Step 5: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/services/ai.ts
git commit -m "feat: add GATEWAY_URL override and per-user apiKey injection"
```

---

## Task 4: User ID Schema Migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/index.ts`

- [ ] **Step 1: Add userId column to schema.ts**

Add `userId` field to these 6 tables in `backend/src/db/schema.ts`:

In `dramas` table (after line 8, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

In `episodes` table (after line 25, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

In `imageGenerations` table (after line 199, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

In `videoGenerations` table (after line 232, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

In `videoMerges` table (after line 267, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

In `assets` table (after line 300, after `id`):
```typescript
  userId: text('user_id').notNull().default('standalone'),
```

- [ ] **Step 2: Add DDL migration in db/index.ts**

Find the section with `ensureColumn` calls in `backend/src/db/index.ts` and add after it:

```typescript
// --- User isolation columns ---
const userIdTables = ['dramas', 'episodes', 'image_generations', 'video_generations', 'video_merges', 'assets']
for (const table of userIdTables) {
  ensureColumn(table, 'user_id', `ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'standalone'`)
}
// Create indexes for user_id filtering
for (const table of userIdTables) {
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`)
}
```

- [ ] **Step 3: Verify database starts correctly**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && timeout 5 npx tsx src/index.ts 2>&1 || true`
Expected: Server starts without migration errors

- [ ] **Step 4: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/db/schema.ts backend/src/db/index.ts
git commit -m "feat: add user_id column to 6 tables for multi-user isolation"
```

---

## Task 5: User-Scoped Routes

**Files:**
- Modify: `backend/src/routes/dramas.ts`
- Modify: `backend/src/routes/images.ts`
- Modify: `backend/src/routes/videos.ts`
- Modify: `backend/src/routes/episodes.ts`

- [ ] **Step 1: Scope dramas routes**

In `backend/src/routes/dramas.ts`:

Add import at top:
```typescript
import { eq, isNull, like, desc, and } from 'drizzle-orm'
```
(replace existing import — adds `and`)

Add context import:
```typescript
import '../middleware/context.js'
```

**GET /** (list): Replace line 16:
```typescript
  let query = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))
```
With:
```typescript
  const userId = c.get('userId') || 'standalone'
  const allRows = await db.select().from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, userId)))
    .orderBy(desc(schema.dramas.updatedAt))
```
And remove the original `const allRows = await query.orderBy(...)` line below it (line 18).

**POST /** (create): Add userId to insert values (line 55-64):
```typescript
  const userId = c.get('userId') || 'standalone'
```
And add `userId` to the `.values({...})` object:
```typescript
    userId,
```

**GET /stats**: Replace line 89:
```typescript
  const all = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt)).all()
```
With:
```typescript
  const userId = c.get('userId') || 'standalone'
  const all = db.select().from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, userId))).all()
```

**GET /:id**: After getting drama (line 102), add ownership check:
```typescript
  const userId = c.get('userId') || 'standalone'
  if (drama.userId !== userId) return notFound(c, '剧本不存在')
```

**PUT /:id** and **DELETE /:id**: Add ownership check before update:
```typescript
  const userId = c.get('userId') || 'standalone'
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama || drama.userId !== userId) return notFound(c, '剧本不存在')
```

- [ ] **Step 2: Scope images routes**

In `backend/src/routes/images.ts`:

Add context import:
```typescript
import '../middleware/context.js'
```

**POST /**: Pass apiKey to generation (already available from context):
```typescript
  const apiKey = c.get('apiKey') || ''
```
Pass it to the `generateImage` call by adding `apiKey` to the params object (this will be consumed later in Task 7 when we thread it through).

**GET /**: Add userId filter:
```typescript
  const userId = c.get('userId') || 'standalone'
  // after fetching rows:
  rows = rows.filter(r => r.userId === userId)
```

- [ ] **Step 3: Scope videos routes**

Apply the same pattern as images to `backend/src/routes/videos.ts`:
- Add context import
- Extract userId/apiKey from context
- Filter list queries by userId

- [ ] **Step 4: Scope episodes routes**

In `backend/src/routes/episodes.ts`:

Add context import. For episode routes, ownership is validated through the parent drama:
- On create: set userId from context
- On read: verify the episode's drama belongs to the user
- On update: same ownership check

- [ ] **Step 5: Verify server starts and basic API works**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && timeout 5 npx tsx src/index.ts 2>&1 || true`
Expected: Server starts without errors

- [ ] **Step 6: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/routes/dramas.ts backend/src/routes/images.ts backend/src/routes/videos.ts backend/src/routes/episodes.ts
git commit -m "feat: add user_id scoping to all CRUD routes"
```

---

## Task 6: Storage Abstraction

**Files:**
- Modify: `backend/src/utils/storage.ts`
- Create: `backend/src/utils/cos-storage.ts`
- Create: `backend/src/utils/cos-keys.ts`

- [ ] **Step 1: Define StorageBackend interface and refactor storage.ts**

Replace the top section of `backend/src/utils/storage.ts` (lines 1-32) to add the interface and refactor `downloadFile` to use it:

```typescript
/**
 * Storage abstraction — pluggable backend (local filesystem or COS)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

/**
 * Pluggable storage backend interface.
 * All methods use relative keys (e.g. "images/abc.png") — the backend
 * decides whether that maps to local fs or cloud object storage.
 */
export interface StorageBackend {
  /** Save buffer to storage, return a URL usable by the frontend */
  save(key: string, data: Buffer, contentType: string): Promise<string>
  /** Download from remote URL and save to storage, return frontend URL */
  downloadAndSave(remoteUrl: string, key: string): Promise<string>
  /** Get a URL the frontend can use to display this asset */
  getUrl(key: string): string
  /** Get an absolute local filesystem path (download from cloud if needed). Returns [path, cleanup] */
  getLocalPath(key: string): Promise<[string, () => void]>
  /** Delete an object from storage */
  delete(key: string): Promise<void>
}

/**
 * Local filesystem storage — the default backend.
 */
class LocalStorage implements StorageBackend {
  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(STORAGE_ROOT, key)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
    return `static/${key}`
  }

  async downloadAndSave(remoteUrl: string, key: string): Promise<string> {
    const resp = await fetch(remoteUrl)
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    return this.save(key, buffer, resp.headers.get('content-type') || '')
  }

  getUrl(key: string): string {
    return `static/${key}`
  }

  async getLocalPath(key: string): Promise<[string, () => void]> {
    const filePath = path.join(STORAGE_ROOT, key)
    return [filePath, () => {}]
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(STORAGE_ROOT, key)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}

// --- Singleton storage instance ---
let _storage: StorageBackend | null = null

export function getStorage(): StorageBackend {
  if (!_storage) {
    const storageType = (process.env.STORAGE_TYPE || 'local').trim().toLowerCase()
    if (storageType === 'cos') {
      // Lazy import to avoid requiring COS deps when unused
      const { createCOSStorage } = require('./cos-storage.js')
      _storage = createCOSStorage()
    } else {
      _storage = new LocalStorage()
    }
  }
  return _storage
}

/**
 * Download remote file to local storage — backwards-compatible wrapper.
 * Existing callers (image-generation, video-generation) use this.
 */
export async function downloadFile(url: string, subDir: string): Promise<string> {
  const ext = getExtFromUrl(url)
  const key = `${subDir}/${uuid()}${ext}`
  return getStorage().downloadAndSave(url, key)
}
```

Keep the rest of storage.ts unchanged (saveUploadedFile, saveBase64Image, readImageAsDataUrl, etc.) — these work fine with local fs and are only used for reference image preprocessing, not final asset storage.

- [ ] **Step 2: Create COS key builders**

```typescript
// backend/src/utils/cos-keys.ts

function sanitize(v: string): string {
  let p = (v || '').trim().replace(/\.\./g, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return p || 'unknown'
}

export function dramaBaseKey(userId: string, dramaId: string): string {
  return `drama/${sanitize(userId)}/${sanitize(dramaId)}`
}

export function characterKey(userId: string, dramaId: string, characterId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/characters/${sanitize(characterId)}/${sanitize(filename)}`
}

export function sceneKey(userId: string, dramaId: string, sceneId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/scenes/${sanitize(sceneId)}/${sanitize(filename)}`
}

export function storyboardKey(userId: string, dramaId: string, episodeId: string, storyboardId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/episodes/${sanitize(episodeId)}/storyboards/${sanitize(storyboardId)}/${sanitize(filename)}`
}

export function episodeOutputKey(userId: string, dramaId: string, episodeId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/episodes/${sanitize(episodeId)}/output/${sanitize(filename)}`
}
```

- [ ] **Step 3: Create COS storage backend**

```typescript
// backend/src/utils/cos-storage.ts
import COS from 'cos-nodejs-sdk-v5'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { StorageBackend } from './storage.js'

export function createCOSStorage(): StorageBackend {
  const secretId = process.env.COS_SECRET_ID || ''
  const secretKey = process.env.COS_SECRET_KEY || ''
  const bucket = process.env.COS_BUCKET || ''
  const region = process.env.COS_REGION || ''
  const publicUrl = (process.env.COS_PUBLIC_URL || '').replace(/\/+$/, '')

  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error('COS storage requires COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION env vars')
  }

  const cos = new COS({ SecretId: secretId, SecretKey: secretKey })
  const cacheDir = path.join(os.tmpdir(), 'huobao-cos-cache')
  fs.mkdirSync(cacheDir, { recursive: true })

  function cosKey(key: string): string {
    return key.replace(/^\/+/, '')
  }

  return {
    async save(key: string, data: Buffer, contentType: string): Promise<string> {
      await cos.putObject({
        Bucket: bucket,
        Region: region,
        Key: cosKey(key),
        Body: data,
        ContentType: contentType || 'application/octet-stream',
      })
      return publicUrl ? `${publicUrl}/${cosKey(key)}` : cosKey(key)
    },

    async downloadAndSave(remoteUrl: string, key: string): Promise<string> {
      const resp = await fetch(remoteUrl)
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
      const buffer = Buffer.from(await resp.arrayBuffer())
      const contentType = resp.headers.get('content-type') || ''
      return this.save(key, buffer, contentType)
    },

    getUrl(key: string): string {
      return publicUrl ? `${publicUrl}/${cosKey(key)}` : cosKey(key)
    },

    async getLocalPath(key: string): Promise<[string, () => void]> {
      const hash = crypto.createHash('sha1').update(key).digest('hex')
      const localPath = path.join(cacheDir, `cos-${hash}`)

      const result = await cos.getObject({
        Bucket: bucket,
        Region: region,
        Key: cosKey(key),
      })
      fs.writeFileSync(localPath, result.Body as Buffer)
      return [localPath, () => { try { fs.unlinkSync(localPath) } catch {} }]
    },

    async delete(key: string): Promise<void> {
      await cos.deleteObject({
        Bucket: bucket,
        Region: region,
        Key: cosKey(key),
      })
    },
  }
}
```

- [ ] **Step 4: Install cos-nodejs-sdk-v5**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && npm install cos-nodejs-sdk-v5`

- [ ] **Step 5: Verify server still starts with STORAGE_TYPE=local (default)**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && timeout 5 npx tsx src/index.ts 2>&1 || true`
Expected: Server starts normally — COS code is never loaded when STORAGE_TYPE is not "cos"

- [ ] **Step 6: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/utils/storage.ts backend/src/utils/cos-storage.ts backend/src/utils/cos-keys.ts backend/package.json backend/package-lock.json
git commit -m "feat: add pluggable storage backend (local + COS)"
```

---

## Task 7: Wire Storage Into Generation Services

**Files:**
- Modify: `backend/src/services/image-generation.ts`
- Modify: `backend/src/services/video-generation.ts`
- Modify: `backend/src/services/tts-generation.ts`

- [ ] **Step 1: Update image-generation.ts**

The existing code uses `downloadFile()` which is already updated in Task 6 to route through the storage backend. **No changes needed** — `downloadFile` is the only entry point for saving images and it now uses `getStorage()` internally.

Verify by searching for direct `fs.writeFileSync` calls:

Run: `grep -n 'fs.writeFileSync\|fs.mkdirSync' /Users/g/Desktop/探索/huobao-drama-upstream/backend/src/services/image-generation.ts`
Expected: No matches (all file I/O goes through storage.ts utilities)

- [ ] **Step 2: Update tts-generation.ts**

In `backend/src/services/tts-generation.ts`, TTS saves audio with direct `fs.writeFileSync`. Replace the save logic:

Find the section that writes audio to disk (look for `fs.writeFileSync` and `fs.mkdirSync`). Replace with:

```typescript
import { getStorage } from '../utils/storage.js'

// Replace the direct fs write block with:
const audioBuffer = Buffer.from(hexAudio, 'hex')
const key = `audio/${uuid()}.mp3`
const storage = getStorage()
const url = await storage.save(key, audioBuffer, 'audio/mpeg')
```

The returned `url` is what gets stored in the database (same as before for local, or a COS URL for cloud).

- [ ] **Step 3: Verify image and video generation imports still resolve**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/backend && npx tsc --noEmit 2>&1 | grep -i 'storage\|generation' | head -10`
Expected: No new errors related to storage imports

- [ ] **Step 4: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/src/services/tts-generation.ts
git commit -m "feat: wire TTS audio save through storage abstraction"
```

---

## Task 8: Frontend Auth Composable

**Files:**
- Create: `frontend/app/composables/useAuth.ts`

- [ ] **Step 1: Create auth state composable**

```typescript
// frontend/app/composables/useAuth.ts

interface StudioAuthPayload {
  token: string
  apiKey: string
  userId: string
}

const CACHE_KEY = 'drama_auth_cache'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

function persistToSession(payload: StudioAuthPayload) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, ts: Date.now() }))
  } catch { /* quota exceeded or private mode */ }
}

function loadFromSession(): StudioAuthPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (Date.now() - cached.ts > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    if (cached.token && cached.userId) return cached
  } catch {}
  return null
}

const state = reactive({
  token: null as string | null,
  apiKey: null as string | null,
  userId: null as string | null,
  ready: false,
  standaloneMode: false,
})

export function useAuth() {
  function restoreFromCache(): boolean {
    const cached = loadFromSession()
    if (!cached) return false
    state.token = cached.token
    state.apiKey = cached.apiKey
    state.userId = cached.userId
    state.ready = true
    state.standaloneMode = false
    return true
  }

  function initFromMessage(payload: StudioAuthPayload) {
    state.token = payload.token
    state.apiKey = payload.apiKey
    state.userId = payload.userId
    state.ready = true
    state.standaloneMode = false
    persistToSession(payload)
  }

  function refresh(payload: StudioAuthPayload) {
    state.token = payload.token
    state.apiKey = payload.apiKey
    state.userId = payload.userId
    state.ready = true
    persistToSession(payload)
  }

  function initStandalone() {
    state.userId = 'standalone'
    state.token = null
    state.apiKey = null
    state.standaloneMode = true
    state.ready = true
  }

  return {
    state: readonly(state),
    restoreFromCache,
    initFromMessage,
    refresh,
    initStandalone,
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add frontend/app/composables/useAuth.ts
git commit -m "feat: add useAuth composable for Studio/standalone auth state"
```

---

## Task 9: Frontend Studio Plugin

**Files:**
- Create: `frontend/app/plugins/studio-auth.client.ts`

- [ ] **Step 1: Create the Nuxt client plugin**

```typescript
// frontend/app/plugins/studio-auth.client.ts

import { useAuth } from '~/composables/useAuth'

export default defineNuxtPlugin(() => {
  const { state, restoreFromCache, initFromMessage, refresh, initStandalone } = useAuth()
  const isInIframe = window.self !== window.top

  const DEFAULT_STUDIO_ORIGIN = 'https://studio.lsaigc.com'
  const envOrigins = (useRuntimeConfig().public.studioOrigin || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean)

  const inferredOrigin = (() => {
    if (!isInIframe || !document.referrer) return ''
    try { return new URL(document.referrer).origin } catch { return '' }
  })()

  const allowedOrigins = [...new Set([...envOrigins, inferredOrigin].filter(Boolean))]
  const isDev = process.dev
  let targetOrigin = inferredOrigin || envOrigins[0] || DEFAULT_STUDIO_ORIGIN

  const isAllowed = (origin: string) => {
    if (allowedOrigins.length === 0) return origin === DEFAULT_STUDIO_ORIGIN
    return allowedOrigins.includes(origin)
  }

  if (isInIframe) {
    document.documentElement.classList.add('iframe-mode')
    restoreFromCache()

    window.addEventListener('message', (event) => {
      const msgType = event.data?.type

      if (!isAllowed(event.origin)) {
        if (isDev && (msgType === 'STUDIO_AUTH' || msgType === 'STUDIO_AUTH_REFRESH')) {
          allowedOrigins.push(event.origin)
          targetOrigin = event.origin
        } else {
          return
        }
      }

      if (msgType === 'STUDIO_AUTH') {
        initFromMessage(event.data)
      } else if (msgType === 'STUDIO_AUTH_REFRESH' && state.ready) {
        refresh(event.data)
      } else if (msgType === 'STUDIO_THEME') {
        const theme = event.data?.theme as string
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else if (theme === 'light') {
          document.documentElement.classList.remove('dark')
        }
      }
    })

    // Send DRAMA_READY after router is set up
    const router = useRouter()
    router.isReady().then(() => {
      window.parent.postMessage({ type: 'DRAMA_READY' }, targetOrigin)
    })

    // Sync route changes to Studio
    router.afterEach((to) => {
      window.parent.postMessage({ type: 'DRAMA_ROUTE', path: to.fullPath }, targetOrigin)
    })

    // Fallback to standalone after 5s timeout
    setTimeout(() => {
      if (!state.ready) {
        console.warn('[Auth] Studio auth timeout after 5s, falling back to standalone')
        initStandalone()
      }
    }, 5000)
  } else {
    initStandalone()
  }
})
```

- [ ] **Step 2: Add studioOrigin to nuxt runtime config**

In `frontend/nuxt.config.ts`, add:

```typescript
runtimeConfig: {
  public: {
    studioOrigin: process.env.NUXT_PUBLIC_STUDIO_ORIGIN || '',
  },
},
```

- [ ] **Step 3: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add frontend/app/plugins/studio-auth.client.ts frontend/nuxt.config.ts
git commit -m "feat: add Studio postMessage auth plugin for Nuxt"
```

---

## Task 10: Frontend Auth Header Injection

**Files:**
- Modify: `frontend/app/composables/useApi.ts:3-4`

- [ ] **Step 1: Inject auth headers into the req() function**

In `frontend/app/composables/useApi.ts`, replace the `req` function (lines 3-29):

Old:
```typescript
async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
```

New:
```typescript
import { useAuth } from '~/composables/useAuth'

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Inject auth headers if available (Studio or standalone mode)
  try {
    const { state } = useAuth()
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`
    if (state.apiKey) headers['X-API-Key'] = state.apiKey
    if (state.userId) headers['X-User-ID'] = state.userId
  } catch { /* composable may be unavailable during SSR or early init */ }

  const opts: RequestInit = { method, headers }
  if (body) opts.body = JSON.stringify(body)
```

The rest of the `req` function stays the same.

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /Users/g/Desktop/探索/huobao-drama-upstream/frontend && npx nuxt build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add frontend/app/composables/useApi.ts
git commit -m "feat: inject auth headers (JWT, API key, user ID) into all API requests"
```

---

## Task 11: Environment Variables Documentation

**Files:**
- Create: `backend/.env.example`

- [ ] **Step 1: Create env example file**

```bash
# backend/.env.example

# --- Server ---
PORT=5679
CORS_ORIGINS=https://studio.lsaigc.com,https://drama.lsaigc.com

# --- Auth (leave empty for standalone mode) ---
NEXTAUTH_SECRET=

# --- Gateway (leave empty to use per-config base_url) ---
GATEWAY_URL=

# --- Storage: "local" (default) or "cos" ---
STORAGE_TYPE=local

# --- COS (only needed when STORAGE_TYPE=cos) ---
COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=
COS_PUBLIC_URL=

# --- Database ---
DB_PATH=
STORAGE_PATH=
```

- [ ] **Step 2: Commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add backend/.env.example
git commit -m "docs: add .env.example with all Studio integration env vars"
```

---

## Task 12: Integration Smoke Test

- [ ] **Step 1: Test standalone mode (no env vars)**

Run:
```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream/backend
npx tsx src/index.ts &
sleep 2
curl -s http://localhost:5679/api/v1/dramas | head -c 200
kill %1
```
Expected: Returns JSON with dramas list (userId=standalone applied silently)

- [ ] **Step 2: Test auth rejection with bad JWT**

Run:
```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream/backend
NEXTAUTH_SECRET=test123 npx tsx src/index.ts &
sleep 2
curl -s -H "Authorization: Bearer badtoken" http://localhost:5679/api/v1/dramas
kill %1
```
Expected: `{"error":"invalid or expired token"}` with 401 status

- [ ] **Step 3: Test standalone fallback when secret is not set**

Run:
```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream/backend
npx tsx src/index.ts &
sleep 2
curl -s -H "Authorization: Bearer anything" -H "X-User-ID: testuser" http://localhost:5679/api/v1/dramas | head -c 200
kill %1
```
Expected: Returns JSON (falls back to standalone since NEXTAUTH_SECRET is empty)

- [ ] **Step 4: Final commit**

```bash
cd /Users/g/Desktop/探索/huobao-drama-upstream
git add -A
git commit -m "chore: Studio platform integration complete"
```
