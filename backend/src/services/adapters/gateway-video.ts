/**
 * Gateway 视频生成 Adapter
 * 适配 OpenAI 兼容网关（如 lsaigc / chatfire）的视频生成接口
 * 生成端点: /v1/video/generations
 * 轮询端点: /v1/video/generations/{taskId}
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class GatewayVideoAdapter implements VideoProviderAdapter {
  provider = 'gateway'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    // Gateway Seedance 格式（参考 studio/src/services/providers/seedance.ts gatewayBody）
    // 端点: /v1/video/generations
    // 顶层: { model, prompt, images, duration }
    // metadata: { ratio, image_roles, ... }
    const images: string[] = []
    const imageRoles: string[] = []

    if (record.referenceMode === 'single' && record.imageUrl) {
      images.push(record.imageUrl)
      imageRoles.push('first_frame')
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) { images.push(record.firstFrameUrl); imageRoles.push('first_frame') }
      if (record.lastFrameUrl)  { images.push(record.lastFrameUrl);  imageRoles.push('last_frame')  }
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs: string[] = JSON.parse(record.referenceImageUrls)
        for (const url of refs) { images.push(url); imageRoles.push('reference_image') }
      } catch {}
    }

    const metadata: any = {}
    if (imageRoles.length) metadata.image_roles = imageRoles
    if (record.aspectRatio) metadata.ratio = record.aspectRatio

    const body: any = {
      model: record.model || config.model,
      prompt: record.prompt || '',
    }
    if (images.length) body.images = images
    if (record.duration) body.duration = record.duration
    if (Object.keys(metadata).length) body.metadata = metadata

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/video/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.task_id || result.id || result.data?.task_id || result.data?.id
    if (!taskId) {
      const videoUrl = result.video_url || result.data?.video_url || result.content?.video_url
      if (videoUrl) {
        return { isAsync: false, videoUrl }
      }
      throw new Error('No task_id or video_url in gateway response')
    }
    return { isAsync: true, taskId }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/video/generations/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    // 网关响应格式: {code, data: {status, data: {status, video_url}}}
    const outer = result.data || result
    const inner = outer.data || {}

    const status = (outer.status || inner.status || '').toUpperCase()

    if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(status)) {
      const videoUrl = inner.video_url || outer.video_url || result.video_url
        || inner.output?.video_url || inner.output?.video_urls?.[0]
      return { status: 'completed', videoUrl }
    }

    if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
      const error = outer.fail_reason || inner.error || result.error?.message || 'Video generation failed'
      return { status: 'failed', error }
    }

    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const outer = result.data || result
    const inner = outer.data || {}
    return inner.video_url || outer.video_url || result.video_url || null
  }
}
