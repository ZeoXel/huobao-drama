import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import { success, badRequest } from '../utils/response.js'
import { SKILLS_ROOT, getUserSkillsDir } from '../agents/skills.js'
import '../middleware/context.js'

const app = new Hono()
const DEFAULT_USER = 'standalone'
const uid = (c: any) => (c.get('userId') || '').trim() || DEFAULT_USER

function userDir(c: any) {
  const dir = getUserSkillsDir(uid(c))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 校验 skill id，防止路径遍历（../../etc/passwd）写出用户目录
 * 合法字符：字母、数字、下划线、连字符、斜杠（用于嵌套）
 */
function sanitizeSkillId(id: string): string | null {
  const trimmed = (id || '').trim()
  if (!trimmed) return null
  if (trimmed.includes('..')) return null
  if (trimmed.startsWith('/') || trimmed.includes('\\')) return null
  if (!/^[a-zA-Z0-9_\-/]+$/.test(trimmed)) return null
  return trimmed
}

interface SkillItem {
  id: string
  name: string
  description: string
  source: 'user' | 'builtin'
}

function parseMeta(content: string) {
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() || ''
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  return { name, description }
}

function scanSkills(root: string, source: 'user' | 'builtin'): SkillItem[] {
  if (!fs.existsSync(root)) return []
  const items: SkillItem[] = []
  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // 跳过 users/* 目录（避免在 builtin 扫描时把用户目录混入）
      if (!prefix && entry.name === 'users') continue
      const fullPath = path.join(dir, entry.name)
      const skillPath = path.join(fullPath, 'SKILL.md')
      const id = prefix ? `${prefix}/${entry.name}` : entry.name
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, 'utf-8')
        const meta = parseMeta(content)
        items.push({ id, name: meta.name || entry.name, description: meta.description, source })
      }
      walk(fullPath, id)
    }
  }
  walk(root, '')
  return items
}

// GET /skills — 合并用户 + 内置 skills，按 id 去重，用户覆盖内置
app.get('/', async (c) => {
  const builtin = scanSkills(SKILLS_ROOT, 'builtin')
  const user = scanSkills(userDir(c), 'user')
  const merged = new Map<string, SkillItem>()
  for (const item of builtin) merged.set(item.id, item)
  for (const item of user) merged.set(item.id, item) // 用户覆盖内置
  return success(c, Array.from(merged.values()))
})

// GET /skills/:id — 用户目录优先，回退到内置
app.get('/*', async (c) => {
  const id = sanitizeSkillId(c.req.path.slice('/api/v1/skills/'.length))
  if (!id) return badRequest(c, 'Invalid skill id')
  const userPath = path.join(userDir(c), id, 'SKILL.md')
  const builtinPath = path.join(SKILLS_ROOT, id, 'SKILL.md')
  const target = fs.existsSync(userPath) ? userPath : (fs.existsSync(builtinPath) ? builtinPath : '')
  if (!target) return badRequest(c, 'Skill not found')
  const content = fs.readFileSync(target, 'utf-8')
  return success(c, { id, content, source: target === userPath ? 'user' : 'builtin' })
})

// PUT /skills/:id — 写入总是落到用户目录（建立用户覆盖层）
app.put('/*', async (c) => {
  const id = sanitizeSkillId(c.req.path.slice('/api/v1/skills/'.length))
  if (!id) return badRequest(c, 'Invalid skill id')
  const body = await c.req.json()
  const skillDir = path.join(userDir(c), id)
  if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body.content ?? '', 'utf-8')
  return success(c)
})

// POST /skills — 新建 skill（写入用户目录）
app.post('/', async (c) => {
  const body = await c.req.json()
  const id = sanitizeSkillId(body.id)
  if (!id) return badRequest(c, 'Invalid skill id (only letters/digits/_/-/ allowed)')
  const { name, description } = body

  const skillDir = path.join(userDir(c), id)
  if (fs.existsSync(skillDir)) return badRequest(c, 'Skill already exists')

  fs.mkdirSync(skillDir, { recursive: true })
  const content = `---
name: ${name || id}
description: ${description || ''}
---

# ${name || id}

Write your skill content here.
`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
  return success(c, { id, name: name || id, description: description || '', source: 'user' })
})

// DELETE /skills/:id — 只允许删除用户自己的 skill（内置 skill 不可删）
app.delete('/*', async (c) => {
  const id = sanitizeSkillId(c.req.path.slice('/api/v1/skills/'.length))
  if (!id) return badRequest(c, 'Invalid skill id')
  const skillDir = path.join(userDir(c), id)
  if (!fs.existsSync(skillDir)) return badRequest(c, 'User skill not found (内置 skill 不可删除)')
  fs.rmSync(skillDir, { recursive: true, force: true })
  return success(c)
})

export default app
