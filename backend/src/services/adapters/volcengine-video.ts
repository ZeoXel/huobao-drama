/**
 * 火山引擎 Seedance 视频生成 Adapter
 * Gateway mode: /v1/video/generations (OpenAI-compatible)
 * Direct Ark mode: /api/v3/contents/generations/tasks
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

const isGateway = () => !!process.env.GATEWAY_URL?.trim()

export class VolcEngineVideoAdapter implements VideoProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'doubao-seedance-1-5-pro-251215'

    if (isGateway()) {
      // Gateway: OpenAI-compatible format (/v1/video/generations)
      const body: any = {
        model,
        prompt: record.prompt || '',
        duration: this.normalizeDuration(record.duration),
        aspect_ratio: record.aspectRatio || '16:9',
      }

      // Reference images
      const images: string[] = []
      const metadata: any = { watermark: false, generate_audio: true }

      if (record.referenceMode === 'single' && record.imageUrl) {
        images.push(record.imageUrl)
      } else if (record.referenceMode === 'first_last') {
        if (record.firstFrameUrl) images.push(record.firstFrameUrl)
        if (record.lastFrameUrl) images.push(record.lastFrameUrl)
        metadata.image_roles = []
        if (record.firstFrameUrl) metadata.image_roles.push('first_frame')
        if (record.lastFrameUrl) metadata.image_roles.push('last_frame')
      } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
        try { images.push(...JSON.parse(record.referenceImageUrls)) } catch {}
      }

      if (images.length) body.images = images
      body.metadata = metadata

      return {
        url: joinProviderUrl(config.baseUrl, '/v1', '/video/generations'),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body,
      }
    }

    // Direct Ark: native format (/api/v3/contents/generations/tasks)
    const content: any[] = [{ type: 'text', text: record.prompt || '' }]
    if (record.referenceMode === 'single' && record.imageUrl) {
      content.push({ type: 'image_url', image_url: { url: record.imageUrl } })
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: record.firstFrameUrl }, role: 'first_frame' })
      if (record.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: record.lastFrameUrl }, role: 'last_frame' })
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try { for (const url of JSON.parse(record.referenceImageUrls)) content.push({ type: 'image_url', image_url: { url } }) } catch {}
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: { model, content, generate_audio: true, ratio: record.aspectRatio || 'adaptive', duration: this.normalizeDuration(record.duration), watermark: false },
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.id || result.task_id
    if (taskId) return { isAsync: true, taskId }
    const videoUrl = result.video_url || result.content?.video_url || result.data?.video_url
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No task_id or video_url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    if (isGateway()) {
      return {
        url: joinProviderUrl(config.baseUrl, '/v1', `/video/generations/${taskId}`),
        method: 'GET',
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        body: undefined,
      }
    }
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.status
    if (status === 'succeeded' || status === 'completed') {
      const videoUrl = result.video_url || result.content?.video_url || result.data?.video_url
        || result.output?.video_url || result.results?.[0]?.url
      return { status: 'completed', videoUrl }
    }
    if (status === 'failed') {
      return { status: 'failed', error: result.error || 'Video generation failed' }
    }
    return { status: status || 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_url || result.content?.video_url || result.data?.video_url || null
  }

  private normalizeDuration(duration?: number | null): number {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return 5
    return Math.min(12, Math.max(4, parsed))
  }
}
