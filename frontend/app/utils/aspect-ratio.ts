// 画面比例工具：统一短剧镜头/视频生成时的比例选择
// 前端保持单一概念 AspectRatio，调用图像生成时转成 size="WxH"，调用视频生成时直接作为 aspect_ratio 字符串

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9'

export interface AspectRatioOption {
  value: AspectRatio
  label: string
  size: string // WxH 格式，用于图像生成 API
}

export const ASPECT_RATIOS: readonly AspectRatioOption[] = [
  { value: '16:9', label: '16:9 横屏', size: '1920x1080' },
  { value: '9:16', label: '9:16 竖屏', size: '1080x1920' },
  { value: '1:1',  label: '1:1 方形',  size: '1024x1024' },
  { value: '4:3',  label: '4:3 传统',  size: '1440x1080' },
  { value: '21:9', label: '21:9 宽屏', size: '2560x1080' },
] as const

export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9'

const RATIO_TO_SIZE: Record<AspectRatio, string> = ASPECT_RATIOS.reduce(
  (acc, item) => ({ ...acc, [item.value]: item.size }),
  {} as Record<AspectRatio, string>,
)

/** 将比例字符串 (如 "16:9") 转为图像生成 API 使用的 size ("1920x1080") */
export function ratioToSize(ratio: AspectRatio | string | undefined | null): string {
  if (!ratio) return RATIO_TO_SIZE[DEFAULT_ASPECT_RATIO]
  return RATIO_TO_SIZE[ratio as AspectRatio] ?? RATIO_TO_SIZE[DEFAULT_ASPECT_RATIO]
}

/** 判断字符串是否为已知的 AspectRatio 值 */
export function isAspectRatio(v: unknown): v is AspectRatio {
  return typeof v === 'string' && (ASPECT_RATIOS.some(item => item.value === v))
}
