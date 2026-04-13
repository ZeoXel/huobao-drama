import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { getAbsolutePath } from '../utils/storage.js'

const DATA_DIR = getAbsolutePath('grid-cells')

interface SplitResult {
  index: number
  localPath: string
}

async function resolveImageInput(imagePath: string): Promise<Buffer | string> {
  // Remote URL — fetch into memory (适配 COS 等远端存储)
  if (/^https?:\/\//i.test(imagePath)) {
    const resp = await fetch(imagePath)
    if (!resp.ok) throw new Error(`Download grid image failed: ${resp.status}`)
    return Buffer.from(await resp.arrayBuffer())
  }
  // 已是绝对路径
  if (imagePath.startsWith('/')) return imagePath
  // 相对路径（static/... 或裸 key）
  return getAbsolutePath(imagePath)
}

export async function splitGridImage(
  imagePath: string,
  rows: number,
  cols: number,
): Promise<SplitResult[]> {
  const input = await resolveImageInput(imagePath)

  const image = sharp(input)
  const meta = await image.metadata()
  if (!meta.width || !meta.height) throw new Error('Cannot read image dimensions')

  const cellW = Math.floor(meta.width / cols)
  const cellH = Math.floor(meta.height / rows)

  const outDir = DATA_DIR
  fs.mkdirSync(outDir, { recursive: true })

  const results: SplitResult[] = []
  const ts = Date.now()

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      const fileName = `cell_${ts}_${index}.png`
      const outPath = path.join(outDir, fileName)

      await sharp(input)
        .extract({ left: c * cellW, top: r * cellH, width: cellW, height: cellH })
        .toFile(outPath)

      results.push({
        index,
        localPath: `static/grid-cells/${fileName}`,
      })
    }
  }

  return results
}
