/**
 * Auth context keys — injected by auth middleware, consumed by route handlers.
 */
export interface AuthContext {
  userId: string
  apiKey: string
}

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    apiKey: string
  }
}
