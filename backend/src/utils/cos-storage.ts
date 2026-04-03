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
