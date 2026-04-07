import type { MiddlewareHandler } from 'hono'
import './context.js'

/**
 * Auth middleware — dual mode:
 * 1. Studio mode: Bearer JWT → validate with NEXTAUTH_SECRET, extract userId from claims
 * 2. Standalone mode: no Authorization header → userId from X-User-ID or 'standalone'
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = (c.req.header('Authorization') || '').trim()

  // Always extract X-API-Key (Studio passes it regardless of auth mode)
  const apiKey = (c.req.header('X-API-Key') || '').trim()

  // Standalone mode: no auth header
  if (!authHeader) {
    const userId = c.req.header('X-User-ID')?.trim() || 'standalone'
    c.set('userId', userId)
    c.set('apiKey', apiKey)
    return next()
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'invalid authorization header' }, 401)
  }

  const secret = process.env.NEXTAUTH_SECRET || ''
  if (!secret) {
    // Secret not configured — fall back to standalone but keep apiKey
    const userId = c.req.header('X-User-ID')?.trim() || 'standalone'
    c.set('userId', userId)
    c.set('apiKey', apiKey)
    return next()
  }

  const tokenStr = authHeader.slice(7).trim()
  try {
    const { jwtVerify } = await import('jose')
    const secretKey = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(tokenStr, secretKey, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    })

    const userId = (payload.id as string) || (payload.sub as string) || ''
    if (!userId) {
      return c.json({ error: 'missing user id in token' }, 401)
    }

    c.set('userId', userId)
    c.set('apiKey', apiKey)
    return next()
  } catch {
    return c.json({ error: 'invalid or expired token' }, 401)
  }
}
