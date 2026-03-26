<template>
  <el-dialog
    v-model="visible"
    :title="$t('aiConfig.title')"
    width="480px"
    :close-on-click-modal="true"
    destroy-on-close
    class="model-select-dialog"
  >
    <div class="model-select-panel">
      <!-- Empty state -->
      <div v-if="!loading && noConfigs" class="empty-hint">
        <el-icon :size="32" color="var(--text-muted)"><Warning /></el-icon>
        <p>尚未配置 AI 服务</p>
        <p class="sub">请在设置页面添加模型配置后使用</p>
      </div>

      <template v-else>
        <!-- Text Model -->
        <div class="model-section" :class="{ 'is-loading': loading }">
          <div class="section-header">
            <span class="section-icon">📝</span>
            <span class="section-label">文本模型</span>
          </div>
          <el-skeleton v-if="loading" :rows="0" animated>
            <template #template>
              <el-skeleton-item variant="rect" class="skeleton-select" />
            </template>
          </el-skeleton>
          <template v-else>
            <el-select
              v-model="selectedText"
              placeholder="选择文本生成模型"
              style="width: 100%"
              :disabled="textModels.length === 0"
            >
              <el-option
                v-for="m in textModels"
                :key="m.modelName"
                :label="m.modelName"
                :value="m.modelName"
              >
                <div class="model-option">
                  <span>{{ m.modelName }}</span>
                  <span class="model-provider">{{ m.configName }}</span>
                </div>
              </el-option>
            </el-select>
            <span v-if="textModels.length === 0" class="no-model">暂无可用模型</span>
          </template>
        </div>

        <!-- Image Model -->
        <div class="model-section" :class="{ 'is-loading': loading }">
          <div class="section-header">
            <span class="section-icon">🎨</span>
            <span class="section-label">图片模型</span>
          </div>
          <el-skeleton v-if="loading" :rows="0" animated>
            <template #template>
              <el-skeleton-item variant="rect" class="skeleton-select" />
            </template>
          </el-skeleton>
          <template v-else>
            <el-select
              v-model="selectedImage"
              placeholder="选择图片生成模型"
              style="width: 100%"
              :disabled="imageModels.length === 0"
            >
              <el-option
                v-for="m in imageModels"
                :key="m.modelName"
                :label="m.modelName"
                :value="m.modelName"
              >
                <div class="model-option">
                  <span>{{ m.modelName }}</span>
                  <span class="model-provider">{{ m.configName }}</span>
                </div>
              </el-option>
            </el-select>
            <span v-if="imageModels.length === 0" class="no-model">暂无可用模型</span>
          </template>
        </div>

        <!-- Video Model -->
        <div class="model-section" :class="{ 'is-loading': loading }">
          <div class="section-header">
            <span class="section-icon">🎬</span>
            <span class="section-label">视频模型</span>
          </div>
          <el-skeleton v-if="loading" :rows="0" animated>
            <template #template>
              <el-skeleton-item variant="rect" class="skeleton-select" />
            </template>
          </el-skeleton>
          <template v-else>
            <el-select
              v-model="selectedVideo"
              placeholder="选择视频生成模型"
              style="width: 100%"
              disabled
            >
              <el-option
                v-for="m in videoModels"
                :key="m.modelName"
                :label="m.modelName"
                :value="m.modelName"
              >
                <div class="model-option">
                  <span>{{ m.modelName }}</span>
                  <span class="model-provider">{{ m.configName }}</span>
                </div>
              </el-option>
            </el-select>
          </template>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :disabled="noConfigs">
          确认
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import type { AIServiceConfig } from '@/types/ai'

interface ModelOption {
  modelName: string
  configName: string
  configId: number
  priority: number
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'config-updated': []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const loading = ref(true)
const textModels = ref<ModelOption[]>([])
const imageModels = ref<ModelOption[]>([])
const selectedText = ref('')
const selectedImage = ref('')
const selectedVideo = ref('doubao-seedance-1-5-pro-251215')

// Video: only seedance 1.5 pro for now
const videoModels: ModelOption[] = [
  { modelName: 'doubao-seedance-1-5-pro-251215', configName: 'Seedance 1.5 Pro', configId: 0, priority: 100 },
]

const noConfigs = computed(() =>
  textModels.value.length === 0 &&
  imageModels.value.length === 0
)

/** Extract unique models from configs, sorted by priority desc */
function extractModels(configs: AIServiceConfig[]): ModelOption[] {
  const active = configs.filter((c) => c.is_active)
  const all = active
    .flatMap((config) => {
      const models = Array.isArray(config.model) ? config.model : [config.model]
      return models.map((modelName) => ({
        modelName,
        configName: config.name,
        configId: config.id,
        priority: config.priority || 0,
      }))
    })
    .sort((a, b) => b.priority - a.priority)

  const map = new Map<string, ModelOption>()
  all.forEach((m) => {
    if (!map.has(m.modelName)) map.set(m.modelName, m)
  })
  return Array.from(map.values())
}

/** Load saved selection from localStorage */
function loadSaved() {
  selectedText.value = localStorage.getItem('ai_selected_text_model') || ''
  selectedImage.value = localStorage.getItem('ai_selected_image_model') || ''
  selectedVideo.value = localStorage.getItem('ai_selected_video_model') || ''
}

/** Pick default if current selection is invalid */
function ensureSelection(
  models: ModelOption[],
  current: string,
  preferKeyword?: string,
): string {
  if (current && models.some((m) => m.modelName === current)) return current
  if (models.length === 0) return ''
  if (preferKeyword) {
    const preferred = models.find((m) =>
      m.modelName.toLowerCase().includes(preferKeyword),
    )
    if (preferred) return preferred.modelName
  }
  return models[0].modelName
}

async function loadModels() {
  loading.value = true
  try {
    const [textList, imageList] = await Promise.all([
      aiAPI.list('text'),
      aiAPI.list('image'),
    ])

    textModels.value = extractModels(textList)
    imageModels.value = extractModels(imageList)

    loadSaved()
    selectedText.value = ensureSelection(textModels.value, selectedText.value)
    selectedImage.value = ensureSelection(imageModels.value, selectedImage.value, 'nano')
    // Video is fixed, just restore saved or use default
    selectedVideo.value = 'doubao-seedance-1-5-pro-251215'
  } catch (error: any) {
    console.error('加载AI配置失败:', error)
  } finally {
    loading.value = false
  }
}

function handleSave() {
  if (selectedText.value) localStorage.setItem('ai_selected_text_model', selectedText.value)
  if (selectedImage.value) localStorage.setItem('ai_selected_image_model', selectedImage.value)
  if (selectedVideo.value) localStorage.setItem('ai_selected_video_model', selectedVideo.value)

  ElMessage.success('模型配置已保存')
  visible.value = false
  emit('config-updated')
}

watch(visible, (val) => {
  if (val) loadModels()
})
</script>

<style scoped>
.model-select-dialog :deep(.el-dialog__header) {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-primary);
  margin-right: 0;
}

.model-select-dialog :deep(.el-dialog__body) {
  padding: 20px;
}

.model-select-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 120px;
}

/* Section */
.model-section {
  padding: 14px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  transition: opacity 0.2s ease;
}

.model-section.is-loading {
  opacity: 0.7;
}

.skeleton-select {
  width: 100%;
  height: 32px;
  border-radius: 6px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.section-icon {
  font-size: 14px;
  line-height: 1;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.no-model {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

/* Dropdown option */
.model-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.model-provider {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 12px;
}

/* Empty */
.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.empty-hint p {
  margin: 0;
}

.empty-hint .sub {
  font-size: 12px;
}

/* Footer */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Dark mode */
.dark .model-select-dialog :deep(.el-dialog) {
  background: var(--bg-card);
}

.dark .model-section {
  background: var(--bg-primary);
}

.dark :deep(.el-input__wrapper) {
  background: var(--bg-secondary);
  box-shadow: 0 0 0 1px var(--border-primary) inset;
}

.dark :deep(.el-input__inner) {
  color: var(--text-primary);
}

.dark :deep(.el-select .el-input__wrapper) {
  background: var(--bg-secondary);
}
</style>
