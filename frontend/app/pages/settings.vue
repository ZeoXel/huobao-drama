<template>
  <div class="settings-layout">
    <aside class="settings-nav">
      <div class="nav-group">
        <div class="nav-group-label">基础</div>
        <button v-for="t in baseTabs" :key="t.id" :class="['nav-item', { active: tab === t.id }]" @click="tab = t.id">
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>
      <div class="nav-advanced">
        <label class="advanced-toggle">
          <span>Agent 高级配置</span>
          <input type="checkbox" v-model="showAdvanced" />
          <span class="advanced-slider"></span>
        </label>
        <p class="advanced-note">仅展开 Agent 配置与 Skills。工作台功能和分镜字段保持默认可见。</p>
      </div>
      <div v-if="showAdvanced" class="nav-group">
        <div class="nav-group-label">高级</div>
        <button v-for="t in advancedTabs" :key="t.id" :class="['nav-item', { active: tab === t.id }]" @click="tab = t.id">
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>
    </aside>

    <div class="settings-content">

      <!-- ===== AI 服务配置 ===== -->
      <div v-if="tab === 'ai'" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">AI 服务配置</h2>
          <p class="settings-desc">选择各服务使用的模型</p>
        </div>

        <div class="model-selector-panel card">
          <label class="field" v-for="st in serviceTypeEntries" :key="st.type">
            <span class="field-label">{{ st.label }}</span>
            <BaseSelect
              :modelValue="selectedModels[st.type]"
              @update:modelValue="v => selectedModels[st.type] = v"
              :options="modelSelectOptions[st.type]"
              :placeholder="`选择${st.label}...`"
              searchable
            />
          </label>

          <div class="model-save-row">
            <button class="btn btn-primary" :disabled="saving" @click="saveModelConfigs">
              <Loader2 v-if="saving" :size="12" class="animate-spin" />
              保存配置
            </button>
          </div>
        </div>
      </div>

      <!-- ===== Agent 配置 ===== -->
      <div v-else-if="tab === 'agents'" class="settings-scroll">
        <div class="settings-head">
          <h2 class="settings-title">Agent 配置</h2>
          <p class="settings-desc">高级区只保留 Agent 运行配置。这里可以调整模型、提示词和参数，保存后立即生效。</p>
        </div>
        <div class="agent-list">
          <div v-for="a in agentDefs" :key="a.type" class="card agent-card">
            <div class="agent-card-head" @click="toggleAgentEdit(a.type)">
              <div class="agent-type-badge">{{ a.icon }}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">{{ a.label }}</div>
                <div class="dim" style="font-size:12px">{{ a.type }}</div>
              </div>
              <span v-if="getAgentCfg(a.type)" class="tag tag-success">已配置</span>
              <span v-else class="tag">默认</span>
              <ChevronDown :size="14" :style="{ transform: editingAgent === a.type ? 'rotate(180deg)' : '', transition: '0.2s' }" />
            </div>
            <div v-if="editingAgent === a.type" class="agent-card-body">
              <label class="field">
                <span class="field-label">模型 <span class="dim">(留空使用 AI 服务默认)</span></span>
                <BaseSelect v-model="agentForm.model" :options="textModelSelectOptions" placeholder="— 使用 AI 服务默认 —" searchable />
              </label>
              <div class="field-row">
                <label class="field">
                  <span class="field-label">Temperature</span>
                  <input v-model.number="agentForm.temperature" class="input" type="number" min="0" max="2" step="0.1" />
                </label>
                <label class="field">
                  <span class="field-label">Max Tokens</span>
                  <input v-model.number="agentForm.max_tokens" class="input" type="number" min="100" max="32000" />
                </label>
              </div>
              <label class="field">
                <span class="field-label">System Prompt</span>
                <textarea v-model="agentForm.system_prompt" class="textarea" rows="12" placeholder="Agent 系统提示词..." />
              </label>
              <div class="agent-card-foot">
                <button class="btn btn-ghost btn-sm" @click="resetAgentPrompt(a.type)">恢复默认</button>
                <span v-if="agentSaved === a.type" class="tag tag-success" style="margin-left:8px">
                  <Check :size="10" /> 已保存
                </span>
                <button class="btn btn-primary btn-sm ml-auto" :disabled="agentSaving" @click="saveAgentCfg(a.type)">
                  <Loader2 v-if="agentSaving" :size="12" class="animate-spin" />
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Skills 编辑 ===== -->
      <div v-else-if="tab === 'skills'" class="skills-layout">
        <!-- Agent 左侧列表 -->
        <aside class="skills-agent-list">
          <div class="skills-agent-title">Agent 列表</div>
          <button
            v-for="a in agentDefs"
            :key="a.type"
            :class="['skills-agent-item', { active: selectedAgent === a.type }]"
            @click="selectAgent(a.type)"
          >
            <span class="agent-type-badge">{{ a.icon }}</span>
            <span class="skills-agent-label">{{ a.label }}</span>
            <span v-if="agentSkillCount(a.type) > 0" class="skill-count-badge">{{ agentSkillCount(a.type) }}</span>
          </button>
        </aside>

        <!-- Skill 管理右侧主区域 -->
        <div class="settings-scroll skills-main">
          <div class="settings-head">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="agent-type-badge" style="width:32px;height:32px;font-size:16px">{{ selectedAgentIcon }}</span>
              <div>
                <h2 class="settings-title" style="margin:0">{{ selectedAgentLabel }}</h2>
                <div class="dim" style="font-size:12px">{{ selectedAgentType }} — Skills</div>
              </div>
            </div>
            <p class="settings-desc" style="margin-top:10px">Skills 仅作为 Agent 的高级提示词层使用，不影响工作台常规功能入口。</p>
            <button class="btn btn-primary btn-sm" @click="startAddSkill">
              <Plus :size="13" /> 新增 Skill
            </button>
          </div>

          <!-- 无 skill 提示 -->
          <div v-if="!currentSkills.length" class="step-empty" style="padding:48px 24px">
            <div class="empty-visual">
              <FileText :size="28" />
            </div>
            <div class="empty-title">暂无 Skill</div>
            <div class="empty-desc">点击右上角「新增 Skill」创建第一个提示词文件</div>
          </div>

          <!-- Skill 列表 -->
          <div class="skill-list" v-else>
            <div v-for="s in currentSkills" :key="s.id" class="card skill-card">
              <div class="skill-card-head" @click="toggleSkillEdit(s.id)">
                <FileText :size="14" style="color:var(--accent);flex-shrink:0" />
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:13px">{{ s.name }}</div>
                  <div class="dim" style="font-size:11px">{{ s.description }}</div>
                </div>
                <button class="btn btn-ghost btn-icon" style="margin-right:4px" @click.stop="deleteSkill(s.id)">
                  <Trash2 :size="13" />
                </button>
                <ChevronDown :size="14" :style="{ transform: editingSkill === s.id ? 'rotate(180deg)' : '', transition: '0.2s' }" />
              </div>
              <div v-if="editingSkill === s.id" class="skill-card-body">
                <textarea
                  v-model="skillContent"
                  class="textarea mono"
                  rows="20"
                  style="font-size:12px;line-height:1.6"
                  placeholder="编写 SKILL.md 内容..."
                />
                <div class="skill-card-foot">
                  <span class="dim" style="font-size:11px">skills/{{ selectedAgentType }}/{{ s.id }}/SKILL.md</span>
                  <span v-if="skillSaved === s.id" class="tag tag-success" style="margin-left:8px">
                    <Check :size="10" /> 已保存
                  </span>
                  <button class="btn btn-primary btn-sm ml-auto" :disabled="skillSaving" @click="saveSkill(s.id)">
                    <Loader2 v-if="skillSaving" :size="12" class="animate-spin" />
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Skill Dialog -->
    <div v-if="addSkillDialog" class="overlay" @click.self="addSkillDialog = false">
      <form class="modal card" @submit.prevent="confirmAddSkill">
        <h2 class="modal-title">新增 Skill — {{ selectedAgentLabel }}</h2>
        <label class="field">
          <span class="field-label">Skill 目录名 <span class="dim">(英文，唯一)</span></span>
          <input v-model="newSkillForm.id" class="input" placeholder="如 custom-extraction" />
        </label>
        <label class="field">
          <span class="field-label">名称</span>
          <input v-model="newSkillForm.name" class="input" placeholder="如 自定义提取规则" />
        </label>
        <label class="field">
          <span class="field-label">描述</span>
          <input v-model="newSkillForm.description" class="input" placeholder="简短描述此 Skill 的用途" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="addSkillDialog = false">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="!newSkillForm.id">创建</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Trash2, FileText, ChevronDown, Check, Loader2, Bot, Cpu } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import { toast } from 'vue-sonner'
import { aiConfigAPI, agentConfigAPI, skillsAPI } from '~/composables/useApi'

const tab = ref('ai')
const showAdvanced = ref(false)
const baseTabs = [
  { id: 'ai', label: 'AI 服务', icon: Cpu },
]
const advancedTabs = [
  { id: 'agents', label: 'Agent 配置', icon: Bot },
  { id: 'skills', label: 'Skills', icon: FileText },
]
watch(showAdvanced, (v) => {
  if (!v && tab.value !== 'ai') tab.value = 'ai'
})

// ===== Model Options =====
// Gateway base URLs per provider — adapter adds its own prefix (e.g. /v1, /api/v3)
const GATEWAY = 'https://api.lsaigc.com'
const gatewayBaseUrl: Record<string, string> = {
  chatfire: GATEWAY,         // adapter adds /v1 → /v1/chat/completions
  openai: GATEWAY,           // adapter adds /v1 → /v1/chat/completions
  gemini: GATEWAY,           // adapter adds /v1beta → /v1beta/models/...
  volcengine: `${GATEWAY}/volcengine`,  // adapter adds /api/v3 → /volcengine/api/v3/...
  minimax: `${GATEWAY}/minimax`,        // adapter adds /v1 → /minimax/v1/t2a_v2
  vidu: `${GATEWAY}/vidu`,
  ali: `${GATEWAY}/ali`,
}

const modelOptions = {
  text: [
    { label: 'Gemini 3 Pro', value: 'gemini-3-pro-preview', provider: 'chatfire' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash-preview', provider: 'chatfire' },
    { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini', provider: 'openai' },
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514', provider: 'openai' },
  ],
  image: [
    { label: 'SeedDream 5.0', value: 'doubao-seedream-5-0-t2i-250428', provider: 'volcengine' },
    { label: 'SeedDream 4.5', value: 'doubao-seedream-4-5-251128', provider: 'volcengine' },
    { label: 'DALL-E 3', value: 'dall-e-3', provider: 'openai' },
  ],
  video: [
    { label: 'Seedance 1.5 Pro', value: 'doubao-seedance-1-5-pro-251215', provider: 'volcengine' },
    { label: 'Seedance 1.5 Lite', value: 'doubao-seedance-1-5-lite-250428', provider: 'volcengine' },
    { label: 'Vidu Q3 Turbo', value: 'viduq3-turbo', provider: 'vidu' },
    { label: 'WAN 2.6 Flash', value: 'wan2.6-i2v-flash', provider: 'ali' },
  ],
  audio: [
    { label: 'MiniMax Speech 02 HD', value: 'speech-02-hd', provider: 'minimax' },
    { label: 'MiniMax Speech 01 HD', value: 'speech-01-hd', provider: 'minimax' },
  ],
}

const serviceTypeEntries = [
  { type: 'text', label: '文本模型' },
  { type: 'image', label: '图片模型' },
  { type: 'video', label: '视频模型' },
  { type: 'audio', label: '音频模型' },
]

const priorityMap = { text: 100, image: 99, video: 98, audio: 97 }

const modelSelectOptions = computed(() => {
  const result = {}
  for (const [type, options] of Object.entries(modelOptions)) {
    result[type] = options.map(o => ({ label: `${o.label} (${o.value})`, value: o.value }))
  }
  return result
})

const defaultModels = { text: 'gemini-3-flash-preview', image: 'doubao-seedream-5-0-t2i-250428', video: 'doubao-seedance-1-5-pro-251215', audio: 'speech-02-hd' }
const selectedModels = reactive({ ...defaultModels })
const saving = ref(false)

// ===== AI Service Configs =====
const cfgs = ref([])

async function loadCfgs() {
  try {
    cfgs.value = await aiConfigAPI.list()
    // Pre-select current active model for each type
    for (const st of serviceTypeEntries) {
      const activeCfg = cfgs.value
        .filter(c => c.service_type === st.type && c.is_active)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
      if (activeCfg) {
        const model = Array.isArray(activeCfg.model) ? activeCfg.model[0] : activeCfg.model
        // Only pre-select if this model is in our options list
        const inOptions = modelOptions[st.type].some(o => o.value === model)
        if (inOptions) {
          selectedModels[st.type] = model
        }
      }
    }
  } catch (e) {
    toast.error(e.message)
  }
}

function findModelOption(type, modelValue) {
  return modelOptions[type]?.find(o => o.value === modelValue)
}

async function saveModelConfigs() {
  saving.value = true
  try {
    for (const st of serviceTypeEntries) {
      const modelValue = selectedModels[st.type]
      if (!modelValue) continue

      const opt = findModelOption(st.type, modelValue)
      if (!opt) continue

      // Find existing config for this service_type + provider combo
      const existing = cfgs.value.find(
        c => c.service_type === st.type && c.provider === opt.provider
      )

      if (existing) {
        // Update existing config
        await aiConfigAPI.update(existing.id, {
          model: [modelValue],
          name: opt.label,
          is_active: true,
          priority: priorityMap[st.type],
        })
      } else {
        // Create new config
        await aiConfigAPI.create({
          service_type: st.type,
          provider: opt.provider,
          name: opt.label,
          base_url: gatewayBaseUrl[opt.provider] || GATEWAY,
          api_key: 'from-studio',
          model: [modelValue],
          priority: priorityMap[st.type],
          is_active: true,
        })
      }
    }
    await loadCfgs()
    toast.success('模型配置已保存')
  } catch (e) {
    toast.error(e.message)
  } finally {
    saving.value = false
  }
}

// ===== Agent Configs =====
const agentCfgs = ref([])
const editingAgent = ref(null)
const agentSaving = ref(false)
const agentSaved = ref(null)
const agentForm = reactive({ model: '', temperature: 0.7, max_tokens: 4096, system_prompt: '' })

const agentDefs = [
  { type: 'script_rewriter', label: '剧本改写', icon: '📝' },
  { type: 'extractor', label: '角色场景提取', icon: '🔍' },
  { type: 'storyboard_breaker', label: '分镜拆解', icon: '🎬' },
  { type: 'voice_assigner', label: '音色分配', icon: '🎙' },
  { type: 'grid_prompt_generator', label: '图片提示词生成', icon: '🖼' },
]

const defaultPrompts = {
  script_rewriter: `你是专业编剧，擅长将小说改编为短剧剧本。

工作流程：
1. 调用 read_episode_script 读取原始内容
2. 根据读取到的内容，自己进行改写（输出格式化剧本格式）
3. 调用 save_script 保存改写后的完整剧本

格式化剧本格式：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容`,
  extractor: `你是制片助理，擅长从剧本中提取角色和场景信息，并在提取时与项目已有数据进行智能去重。

工作流程：
1. 调用 read_script_for_extraction 读取格式化剧本
2. 调用 read_existing_characters 读取项目中已存在的角色列表（用于去重）
3. 调用 read_existing_scenes 读取项目中已存在的场景列表（用于去重）
4. 分析剧本内容，提取所有角色信息
5. 对每个角色：若同名已存在则合并更新，若不存在则新增
6. 调用 save_dedup_characters 保存角色（去重合并，自动处理新增和更新）
7. 分析剧本内容，提取所有场景信息
8. 对每个场景：若同地点+时间段已存在则复用，若不存在则新增
9. 调用 save_dedup_scenes 保存场景（去重合并，自动处理新增和复用）

去重规则：
- 角色：按名字精确匹配，同名保留现有（合并信息）
- 场景：按【地点+时间段】精确匹配；同地点不同时段视为新场景

提取要求：
- 角色要包含完整的外貌特征描述（发型、服装、体态等）
- 场景要包含光线、色调、氛围等视觉信息
- 不要遗漏任何有台词或重要动作的角色`,
  storyboard_breaker: `你是资深影视分镜师，擅长将剧本拆解为分镜方案。

工作流程：
1. 调用 read_storyboard_context 读取剧本、角色列表、场景列表
2. 将剧本拆解为镜头序列（每个镜头 10-15 秒）
3. 为每个镜头生成视频提示词（video_prompt）
4. 调用 save_storyboards 保存所有分镜`,
  voice_assigner: `你是配音导演，擅长为角色选择合适的音色。

工作流程：
1. 调用 list_voices 获取可用音色列表
2. 调用 get_characters 获取所有角色信息
3. 根据每个角色的性别、性格、年龄、角色定位，选择最匹配的音色
4. 对每个角色调用 assign_voice 分配音色，并说明选择理由

注意：每个角色都必须分配音色，不要遗漏。`,
  grid_prompt_generator: `你是专业的 AI 图像提示词工程师，擅长为角色、场景和宫格图生成高质量的英文提示词。

你将收到用户的请求，告知要生成哪种类型的提示词：
- "角色" → 生成角色图片提示词
- "场景" → 生成场景图片提示词
- "宫格" → 生成宫格图提示词

## 角色图片提示词

工作流程：
1. 调用 read_characters 读取所有角色信息
2. 根据角色外貌特征（appearance）、性格（personality）、定位（role）生成英文提示词
3. 提示词结构：[外貌描述]，[性格/气质]，[角色定位]，[电影感]，[高质量]，[无文字水印]

## 场景图片提示词

工作流程：
1. 调用 read_scenes 读取所有场景信息
2. 根据场景地点（location）、时间段（time）、已有描述（prompt）生成英文提示词
3. 提示词结构：[地点]，[时间/光线/氛围]，[已有描述]，[电影感场景]，[高质量]，[无文字水印]

## 宫格图提示词（参考 skills/grid-image-generator/SKILL.md）

工作流程：
1. 调用 read_shots_for_grid 读取选中镜头的详细信息
2. 根据 mode 调用 generate_grid_prompt：
   - first_frame 模式：每格=一个镜头的首帧，NxN 风格统一
   - first_last 模式：每个镜头占2格（左首右尾），同一行风格连续
   - multi_ref 模式：所有格子都是同一镜头的不同参考角度
3. 返回 grid_prompt（整体提示词）和 cell_prompts（每格提示词）

提示词规范：
- 使用英文提示词
- 必须包含 "consistent art style" 保持风格统一
- 必须包含 "cinematic quality"
- 避免出现文字或水印`,
}

function getAgentCfg(type) {
  return agentCfgs.value.find(a => a.agent_type === type)
}

const textModelSelectOptions = computed(() => {
  // Use text model options as agent model choices
  return modelOptions.text.map(o => ({ label: `${o.label} (${o.value})`, value: o.value }))
})

async function loadAgents() {
  try { agentCfgs.value = await agentConfigAPI.list() }
  catch (e) { toast.error(e.message) }
}

function toggleAgentEdit(type) {
  if (editingAgent.value === type) { editingAgent.value = null; return }
  const cfg = getAgentCfg(type)
  agentForm.model = cfg?.model || ''
  agentForm.temperature = cfg?.temperature ?? 0.7
  agentForm.max_tokens = cfg?.max_tokens ?? 4096
  agentForm.system_prompt = cfg?.system_prompt || defaultPrompts[type] || ''
  agentSaved.value = null
  editingAgent.value = type
}

function resetAgentPrompt(type) {
  agentForm.system_prompt = defaultPrompts[type] || ''
  toast.info('已恢复默认提示词，点击保存生效')
}

async function saveAgentCfg(type) {
  agentSaving.value = true
  agentSaved.value = null
  try {
    const existing = getAgentCfg(type)
    const data = {
      agent_type: type,
      name: agentDefs.find(a => a.type === type)?.label || type,
      model: agentForm.model,
      temperature: agentForm.temperature,
      max_tokens: agentForm.max_tokens,
      system_prompt: agentForm.system_prompt,
    }
    if (existing) {
      await agentConfigAPI.update(existing.id, data)
    } else {
      await agentConfigAPI.create(data)
    }
    await loadAgents()
    agentSaved.value = type
    toast.success(`${agentDefs.find(a => a.type === type)?.label} 配置已保存`)
    setTimeout(() => { if (agentSaved.value === type) agentSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    agentSaving.value = false
  }
}

// ===== Skills =====
const selectedAgent = ref('script_rewriter')
const allSkills = ref([])
const editingSkill = ref(null)
const skillContent = ref('')
const skillSaving = ref(false)
const skillSaved = ref(null)
const addSkillDialog = ref(false)
const newSkillForm = reactive({ id: '', name: '', description: '' })

const selectedAgentType = computed(() => selectedAgent.value)
const selectedAgentLabel = computed(() => agentDefs.find(a => a.type === selectedAgent.value)?.label || '')
const selectedAgentIcon = computed(() => agentDefs.find(a => a.type === selectedAgent.value)?.icon || '')

function agentSkillCount(type) {
  return allSkills.value.filter(s => s.id === type || s.id.startsWith(type + '/')).length
}

const currentSkills = computed(() =>
  allSkills.value.filter(s => s.id === selectedAgent.value || s.id.startsWith(selectedAgent.value + '/'))
)

async function loadAllSkills() {
  try { allSkills.value = await skillsAPI.list() }
  catch (e) { toast.error(e.message) }
}

async function selectAgent(type) {
  selectedAgent.value = type
  editingSkill.value = null
}

function startAddSkill() {
  newSkillForm.id = ''
  newSkillForm.name = ''
  newSkillForm.description = ''
  addSkillDialog.value = true
}

async function confirmAddSkill() {
  if (!newSkillForm.id) return
  const skillId = `${selectedAgent.value}/${newSkillForm.id}`
  try {
    await skillsAPI.create({ id: skillId, name: newSkillForm.name, description: newSkillForm.description })
    addSkillDialog.value = false
    await loadAllSkills()
    toast.success('Skill 创建成功')
  } catch (e) {
    toast.error(e.message)
  }
}

async function deleteSkill(id) {
  if (!confirm(`确定删除 Skill「${id}」？`)) return
  try {
    await skillsAPI.del(id)
    if (editingSkill.value === id) editingSkill.value = null
    await loadAllSkills()
    toast.success('已删除')
  } catch (e) {
    toast.error(e.message)
  }
}

async function toggleSkillEdit(id) {
  if (editingSkill.value === id) { editingSkill.value = null; return }
  try {
    const res = await skillsAPI.get(id)
    skillContent.value = res.content
    skillSaved.value = null
    editingSkill.value = id
  } catch (e) { toast.error(e.message) }
}

async function saveSkill(id) {
  skillSaving.value = true
  skillSaved.value = null
  try {
    await skillsAPI.update(id, skillContent.value)
    await loadAllSkills()
    skillSaved.value = id
    toast.success(`已保存`)
    setTimeout(() => { if (skillSaved.value === id) skillSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    skillSaving.value = false
  }
}

onMounted(() => { loadCfgs(); loadAgents(); loadAllSkills() })
</script>

<style scoped>
.settings-layout { display: flex; height: 100%; background: var(--bg-base); }

.settings-nav {
  width: 220px; flex-shrink: 0; padding: 16px 10px; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 14px; background: var(--bg-1);
}
.nav-group { display: flex; flex-direction: column; gap: 4px; }
.nav-group-label {
  font-size: 10px; font-weight: 700; color: var(--text-3);
  letter-spacing: 0.12em; text-transform: uppercase; padding: 0 10px 4px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px;
  border: none; background: none; color: var(--text-2); cursor: pointer;
  border-radius: var(--radius); transition: all 0.12s; text-align: left; width: 100%;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-0); }
.nav-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; box-shadow: var(--shadow-card); }
.nav-advanced {
  padding: 12px 8px;
  border-top: 1px solid rgba(27, 41, 64, 0.08);
  border-bottom: 1px solid rgba(27, 41, 64, 0.08);
}
.advanced-toggle {
  display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
  font-size: 12px; color: var(--text-2);
}
.advanced-toggle input { display: none; }
.advanced-slider {
  position: relative; width: 38px; height: 22px; border-radius: 999px;
  background: rgba(27, 41, 64, 0.12); transition: background 0.18s ease;
}
.advanced-slider::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(18, 24, 38, 0.18); transition: transform 0.18s ease;
}
.advanced-toggle input:checked + .advanced-slider { background: var(--accent); }
.advanced-toggle input:checked + .advanced-slider::after { transform: translateX(16px); }
.advanced-note {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-3);
}

.settings-content { flex: 1; overflow: hidden; }
.settings-scroll { height: 100%; overflow-y: auto; padding: 36px 48px; max-width: 840px; margin: 0 auto; animation: fadeUp 0.3s var(--ease-out); }
.settings-head { margin-bottom: 24px; }
.settings-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.settings-desc { font-size: 13px; color: var(--text-2); margin-top: 4px; }

/* Model Selector */
.model-selector-panel {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.model-save-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

/* Agent */
.agent-list { display: flex; flex-direction: column; gap: 8px; }
.agent-card { overflow: hidden; }
.agent-card-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; transition: background 0.1s; }
.agent-card-head:hover { background: var(--bg-hover); }
.agent-type-badge { width: 36px; height: 36px; border-radius: var(--radius); background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.agent-card-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--border); padding-top: 16px; }
.agent-card-foot { display: flex; align-items: center; gap: 8px; padding-top: 8px; }

/* Skills 布局 */
.skills-layout { display: flex; height: 100%; overflow: hidden; }
.skills-agent-list {
  width: 200px; flex-shrink: 0; border-right: 1px solid var(--border);
  background: var(--bg-1); display: flex; flex-direction: column;
  overflow-y: auto;
}
.skills-agent-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-3); padding: 14px 14px 8px;
}
.skills-agent-item {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; font-size: 13px; cursor: pointer;
  border: none; background: none; color: var(--text-2);
  transition: all 0.12s; width: 100%; text-align: left;
  border-radius: 0;
}
.skills-agent-item:hover { background: var(--bg-hover); color: var(--text-0); }
.skills-agent-item.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }
.skills-agent-label { flex: 1; }
.skill-count-badge {
  font-size: 10px; font-weight: 700; font-family: var(--font-mono);
  background: var(--accent-bg); color: var(--accent-text);
  padding: 1px 5px; border-radius: 99px;
}
.skills-agent-item.active .skill-count-badge { background: rgba(255,255,255,0.2); color: inherit; }
.skills-main { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.skills-main .settings-scroll { max-width: 900px; }

/* Skill */
.skill-list { display: flex; flex-direction: column; gap: 8px; }
.skill-card { overflow: hidden; }
.skill-card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; transition: background 0.1s; }
.skill-card-head:hover { background: var(--bg-hover); }
.skill-card-body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
.skill-card-foot { display: flex; align-items: center; gap: 8px; }

/* Shared */
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 12px; font-weight: 500; color: var(--text-1); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.overlay { position: fixed; inset: 0; background: rgba(34,45,66,0.32); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.18s var(--ease-out); }
.modal { padding: 28px; width: 420px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-elevated); }
.modal-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px; }
</style>
