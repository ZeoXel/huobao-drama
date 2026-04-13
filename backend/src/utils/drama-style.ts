import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

const DEFAULT_STYLE = 'cinematic'

export async function getDramaStyle(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return DEFAULT_STYLE
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return (drama?.style || '').trim() || DEFAULT_STYLE
}

export function appendStyle(prompt: string, style: string): string {
  const tag = `${style} art style, consistent art style`
  const trimmed = (prompt || '').trim()
  if (!trimmed) return tag
  return new RegExp(`${style}\\s+art\\s+style`, 'i').test(trimmed)
    ? trimmed
    : `${trimmed}, ${tag}`
}
