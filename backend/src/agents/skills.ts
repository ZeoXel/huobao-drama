import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Skills 目录位于仓库/镜像根：dev = repo/skills；Docker = /app/skills
// backend/src/agents → ../../../skills
export const SKILLS_ROOT = process.env.SKILLS_ROOT
  ? path.resolve(process.env.SKILLS_ROOT)
  : path.resolve(__dirname, '../../../skills')
const DEFAULT_USER_ID = 'standalone'
const AGENT_SKILL_MAP: Record<string, string[]> = {
  script_rewriter: ['script_rewriter'],
  extractor: ['extractor'],
  storyboard_breaker: ['storyboard_breaker'],
  voice_assigner: ['voice_assigner'],
  grid_prompt_generator: ['grid_prompt_generator'],
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content.trim()
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content.trim()
  return content.slice(end + 4).trim()
}

export function getUserSkillsDir(userId?: string): string {
  const uid = (userId || '').trim() || DEFAULT_USER_ID
  return path.join(SKILLS_ROOT, 'users', uid)
}

function safeReadSkillFile(dir: string, skillId: string): string {
  const skillPath = path.join(dir, skillId, 'SKILL.md')
  if (!fs.existsSync(skillPath)) return ''
  return fs.readFileSync(skillPath, 'utf-8')
}

/**
 * 用户专属 skill 优先；不存在则回退到仓库内置 skill（skills/<skillId>/SKILL.md）
 */
function readSkill(skillId: string, userId?: string): string {
  const raw = safeReadSkillFile(getUserSkillsDir(userId), skillId)
    || safeReadSkillFile(SKILLS_ROOT, skillId)
  const content = stripFrontmatter(raw)
  if (!content) return ''
  return [
    `## Skill: ${skillId}`,
    content,
  ].join('\n')
}

export function loadAgentSkills(agentType: string, userId?: string): string {
  const skillIds = AGENT_SKILL_MAP[agentType] || []
  const contents = skillIds
    .map((skillId) => readSkill(skillId, userId))
    .filter(Boolean)

  if (!contents.length) return ''

  return [
    '以下是该 Agent 专属的项目技能规范（SKILL.md）。',
    '不同 Agent 会加载不同 skill；你只需要遵守当前注入的这些技能。',
    '你必须在不违背当前工具边界的前提下优先遵守这些规范；若与用户明确要求冲突，以用户要求为准。',
    '',
    contents.join('\n\n'),
  ].join('\n')
}
