/**
 * Storage abstraction — pluggable backend (local filesystem or COS)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

/**
 * Pluggable storage backend interface.
 * Keys are relative (e.g. "images/abc.png"). The backend decides local fs or cloud.
 */
export interface StorageBackend {
  save(key: string, data: Buffer, contentType: string): Promise<string>
  downloadAndSave(remoteUrl: string, key: string): Promise<string>
  getUrl(key: string): string
  getLocalPath(key: string): Promise<[string, () => void]>
  delete(key: string): Promise<void>
}

class LocalStorage implements StorageBackend {
  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(STORAGE_ROOT, key)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
    return `static/${key}`
  }

  async downloadAndSave(remoteUrl: string, key: string): Promise<string> {
    const resp = await fetch(remoteUrl)
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    return this.save(key, buffer, resp.headers.get('content-type') || '')
  }

  getUrl(key: string): string {
    return `static/${key}`
  }

  async getLocalPath(key: string): Promise<[string, () => void]> {
    const filePath = path.join(STORAGE_ROOT, key)
    return [filePath, () => {}]
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(STORAGE_ROOT, key)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}

// --- Singleton storage instance ---
let _storage: StorageBackend | null = null

export function getStorage(): StorageBackend {
  if (!_storage) {
    const storageType = (process.env.STORAGE_TYPE || 'local').trim().toLowerCase()
    if (storageType === 'cos') {
      const { createCOSStorage } = require('./cos-storage.js')
      _storage = createCOSStorage()
    } else {
      _storage = new LocalStorage()
    }
  }
  return _storage
}

/**
 * Download remote file — backwards-compatible wrapper.
 * Routes through the active storage backend.
 */
export async function downloadFile(url: string, subDir: string): Promise<string> {
  const ext = getExtFromUrl(url)
  const key = `${subDir}/${uuid()}${ext}`
  return getStorage().downloadAndSave(url, key)
}

// --- Everything below stays unchanged from original ---

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  fs.writeFileSync(filePath, Buffer.from(data))
  return `static/${subDir}/${filename}`
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return '.bin'
}

/**
 * 获取本地文件的绝对路径
 */
export function getAbsolutePath(relativePath: string): string {
  if (relativePath.startsWith('static/')) {
    return path.join(STORAGE_ROOT, '..', relativePath)
  }
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 保存 Base64 编码的图片数据到本地存储
 */
export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)

  return `static/${subDir}/${filename}`
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const filePath = getAbsolutePath(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(filePath).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const mimeType = 'image/jpeg'
  return `data:${mimeType};base64,${output.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}
