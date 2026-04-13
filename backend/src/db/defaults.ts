/**
 * 共享默认配置 — 以 userId='standalone' 的行作为"系统默认值"持有者。
 * 所有用户读取时回落到这些默认值；用户自己修改会创建/更新其专属行。
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from './index.js'
import { now } from '../utils/response.js'

export const DEFAULT_USER_ID = 'standalone'

export const HUOBAO_PRESET_SERVICES = [
  { serviceType: 'text',  label: '文本', provider: 'chatfire',   baseUrl: 'https://api.chatfire.site',           model: 'gemini-3-pro-preview',            priority: 100 },
  { serviceType: 'image', label: '图片', provider: 'gemini',     baseUrl: 'https://api.chatfire.site',           model: 'gemini-3-pro-image-preview',      priority: 99  },
  { serviceType: 'video', label: '视频', provider: 'volcengine', baseUrl: 'https://api.chatfire.site/volcengine', model: 'doubao-seedance-1-5-pro-251215',  priority: 98  },
  { serviceType: 'audio', label: '音频', provider: 'minimax',    baseUrl: 'https://api.chatfire.site/minimax',    model: 'speech-2.8-hd',                   priority: 97  },
] as const

export const HUOBAO_AGENT_DEFAULTS = [
  { agentType: 'script_rewriter',        name: '剧本改写' },
  { agentType: 'extractor',              name: '角色场景提取' },
  { agentType: 'storyboard_breaker',     name: '分镜拆解' },
  { agentType: 'voice_assigner',         name: '音色分配' },
  { agentType: 'grid_prompt_generator',  name: '图片提示词生成' },
] as const

export const HUOBAO_AGENT_MODEL = 'gemini-3-pro-preview'

/**
 * 启动时幂等播种 standalone 默认值。
 * api_key 保持空字符串，由请求头 X-API-Key 在运行时通过 applyOverrides 注入。
 */
export async function seedStandaloneDefaults() {
  const ts = now()

  for (const preset of HUOBAO_PRESET_SERVICES) {
    const [existing] = await db.select().from(schema.aiServiceConfigs).where(and(
      eq(schema.aiServiceConfigs.userId, DEFAULT_USER_ID),
      eq(schema.aiServiceConfigs.serviceType, preset.serviceType),
      eq(schema.aiServiceConfigs.provider, preset.provider),
    ))
    if (existing) continue
    await db.insert(schema.aiServiceConfigs).values({
      userId: DEFAULT_USER_ID,
      serviceType: preset.serviceType,
      provider: preset.provider,
      name: `火宝默认${preset.label}服务`,
      baseUrl: preset.baseUrl,
      apiKey: '',
      model: JSON.stringify([preset.model]),
      priority: preset.priority,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    })
  }

  for (const agent of HUOBAO_AGENT_DEFAULTS) {
    const [existing] = await db.select().from(schema.agentConfigs).where(and(
      eq(schema.agentConfigs.userId, DEFAULT_USER_ID),
      eq(schema.agentConfigs.agentType, agent.agentType),
    ))
    if (existing) continue
    await db.insert(schema.agentConfigs).values({
      userId: DEFAULT_USER_ID,
      agentType: agent.agentType,
      name: agent.name,
      description: '',
      model: HUOBAO_AGENT_MODEL,
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
