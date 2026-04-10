/**
 * 火山引擎 Seedream 图片生成 Adapter
 * Gateway mode: /v1/images/generations (OpenAI-compatible)
 * Direct Ark mode: /api/v3/images/generations
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

const isGateway = () => !!process.env.GATEWAY_URL?.trim()

export class VolcEngineImageAdapter implements ImageProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'doubao-seedream-5-0-260128'

    if (isGateway()) {
      // Gateway: OpenAI-compatible format (/v1/images/generations)
      // Seedream 5.0 requires minimum 3686400 pixels (~1920x1920)
      // 按比例等比放大到满足最小像素要求，而不是强制改成正方形（会吃掉非 1:1 比例）
      let size = record.size || '2048x2048'
      const [w, h] = size.split('x').map(Number)
      if (w && h && w * h < 3686400) {
        const scale = Math.sqrt(3686400 / (w * h))
        // 向上取整到 64 的倍数，保证最终像素数仍 >= 最小要求且符合 API 对齐要求
        const scaledW = Math.ceil((w * scale) / 64) * 64
        const scaledH = Math.ceil((h * scale) / 64) * 64
        size = `${scaledW}x${scaledH}`
      }
      const body: any = { model, prompt: record.prompt, size }
      if (record.referenceImages) {
        try {
          const refs = JSON.parse(record.referenceImages)
          if (Array.isArray(refs) && refs.length) body.image = refs
        } catch {}
      }
      return {
        url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body,
      }
    }

    // Direct Ark: native format (/api/v3/images/generations)
    const body: any = { model, prompt: record.prompt }
    if (record.size) {
      const [w, h] = record.size.split('x')
      if (w && h) { body.width = parseInt(w); body.height = parseInt(h) }
    }
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/images/generations'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    const imageUrl = result.data?.[0]?.url || result.data?.[0]?.b64_json || result.url
    if (imageUrl) return { isAsync: false, imageUrl }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const prefix = isGateway() ? '/v1' : '/api/v3'
    return {
      url: joinProviderUrl(config.baseUrl, prefix, `/images/generations/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = result.status
    if (status === 'succeeded' || status === 'completed') {
      return { status: 'completed', imageUrl: result.data?.[0]?.url || result.image_url }
    }
    if (status === 'failed') {
      return { status: 'failed', error: result.error || 'Generation failed' }
    }
    return { status: status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) return { data: b64, mimeType: 'image/png' }
    return null
  }
}
