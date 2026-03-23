# Studio × 火宝短剧 iframe 集成设计

**日期**: 2026-03-23
**状态**: 待实现
**范围**: studio（Next.js）嵌入火宝短剧（Vue + Go），适配用户系统与模型接口

---

## 1. 目标与约束

### 目标
1. 在 studio `/drama` 路由下全页嵌入火宝短剧 iframe
2. studio 用户登录后无缝使用火宝，无需二次登录
3. AI 调用复用用户在 lsaigc 网关的专属 API Key，统一计费
4. 用户数据按 userId 隔离，文件存储迁移到腾讯云 COS

### 约束
- studio: `studio.lsaigc.com`，火宝: `drama.lsaigc.com`（同主域不同子域）
- 火宝后端当前无认证体系，需最小改动接入
- 火宝 AI 配置当前存 SQLite，集成后改为从请求上下文取 Key
- 现有火宝功能完整保留，不影响独立运行模式

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  studio.lsaigc.com                                       │
│                                                          │
│  /drama  (Next.js Page)                                  │
│  ① useSession() → { userId, token }                     │
│  ② useUserApiKey() → apiKey                             │
│  ③ iframe.onload → postMessage(STUDIO_AUTH)             │
│  ④ 监听 DRAMA_READY 消息（iframe 就绪信号）             │
│                                                          │
│  ┌─────────────────────────────────────────┐           │
│  │  <iframe src="drama.lsaigc.com">         │           │
│  │                                          │           │
│  │  Vue SPA (火宝短剧)                      │           │
│  │  ⑤ window.onmessage（精确 origin 匹配） │           │
│  │  ⑥ authStore（仅内存，不持久化）         │           │
│  │  ⑦ axios: Authorization + X-API-Key     │           │
│  │      + X-User-ID                        │           │
│  │                                          │           │
│  │  Go Backend (Railway)                    │           │
│  │  ⑧ auth middleware → JWT 验证 + exp     │           │
│  │  ⑨ 所有资源 CRUD 按 user_id 过滤        │           │
│  │  ⑩ AI 调用 → X-API-Key + GATEWAY_URL   │           │
│  │  ⑪ 文件存储 → COS drama/{userId}/       │           │
│  └─────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

### postMessage 协议

#### studio → 火宝（认证信息）

```typescript
// type: STUDIO_AUTH
{
  type: "STUDIO_AUTH",
  token: string,    // NextAuth JWT (HS256, 用于 Go 端验证身份和 exp)
  apiKey: string,   // lsaigc API Key (AI 调用鉴权，透传给网关)
  userId: string,   // Supabase UUID (数据隔离 key，从 JWT claims 中二次校验)
}
// 注意：gatewayUrl 不通过 postMessage 传递，由后端环境变量 GATEWAY_URL 固定
```

#### 火宝 → studio（就绪信号）

```typescript
// type: DRAMA_READY
{ type: "DRAMA_READY" }
```

#### studio → 火宝（Token 刷新）

```typescript
// type: STUDIO_AUTH_REFRESH（与 STUDIO_AUTH 格式相同）
// 触发时机：studio session 即将过期时主动推送
{ type: "STUDIO_AUTH_REFRESH", token: string, apiKey: string, userId: string }
```

---

## 3. Studio 侧改动（Next.js）

### 3.1 新增页面 `/drama`

**文件**: `src/app/(dashboard)/drama/page.tsx`

```tsx
'use client'
import { useSession } from 'next-auth/react'
import { useRef, useCallback, useEffect } from 'react'
import { useUserApiKey } from '@/hooks/useUserApiKey'  // 已有 hook

const DRAMA_ORIGIN = process.env.NEXT_PUBLIC_DRAMA_ORIGIN!  // https://drama.lsaigc.com

export default function DramaPage() {
  const { data: session } = useSession()
  const { apiKey } = useUserApiKey()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const iframeReadyRef = useRef(false)

  // 双重就绪标志：DRAMA_READY 信号 + session/apiKey 数据均就绪后才发送认证
  const dramaReadyRef = useRef(false)   // iframe 已发出 DRAMA_READY
  const authReadyRef  = useRef(false)   // session + apiKey 已可用

  const trySendAuth = useCallback(() => {
    if (!dramaReadyRef.current || !authReadyRef.current) return
    if (!session?.user?.id || !apiKey) return
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'STUDIO_AUTH',
        token: (session as any)?.token as string,
        apiKey,
        userId: session.user.id,
      },
      DRAMA_ORIGIN
    )
  }, [session, apiKey])

  // session + apiKey 就绪时更新标志并尝试发送
  useEffect(() => {
    if (session?.user?.id && apiKey) {
      authReadyRef.current = true
      trySendAuth()
    }
  }, [session, apiKey, trySendAuth])

  // 监听 DRAMA_READY（listener 在 iframe src 赋值前已注册，避免信号丢失）
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== DRAMA_ORIGIN) return
      if (e.data?.type === 'DRAMA_READY') {
        dramaReadyRef.current = true
        trySendAuth()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [trySendAuth])

  return (
    <div className="w-full h-full">
      {/* src 在 listener 注册后赋值，保证 DRAMA_READY 不会丢失 */}
      <iframe
        ref={iframeRef}
        src={DRAMA_ORIGIN}
        className="w-full h-full border-0"
        title="火宝短剧"
        allow="clipboard-write; clipboard-read"
      />
    </div>
  )
}
```

### 3.2 侧边栏导航入口

在 `src/components/layout/DashboardLayout.tsx`（或对应的导航组件）新增：

```tsx
{ label: '短剧创作', href: '/drama', icon: FilmIcon }
```

### 3.3 CSP / 安全头

```typescript
// next.config.ts
headers: [
  {
    source: '/(.*)',
    headers: [
      {
        key: 'Content-Security-Policy',
        value: "frame-src 'self' https://drama.lsaigc.com",
      },
    ],
  },
]
```

### 3.4 新增环境变量

```bash
NEXT_PUBLIC_DRAMA_ORIGIN=https://drama.lsaigc.com
```

---

## 4. 火宝短剧前端改动（Vue 3）

### 4.1 新增 Auth Store（仅内存，不持久化）

**文件**: `web/src/stores/auth.ts`（新建）

```typescript
import { defineStore } from 'pinia'

interface StudioAuthPayload {
  token: string
  apiKey: string
  userId: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    apiKey: null as string | null,
    userId: null as string | null,
    ready: false,
    standaloneMode: false,
  }),
  actions: {
    initFromMessage(payload: StudioAuthPayload) {
      // 仅写入内存，绝不持久化到 localStorage/sessionStorage
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId
      this.ready = true
    },
    initStandalone() {
      // 非 iframe 模式，从本地配置读取 userId（避免多用户共享 'standalone'）
      const storedId = localStorage.getItem('standalone_user_id')
      this.userId = storedId ?? crypto.randomUUID()
      if (!storedId) localStorage.setItem('standalone_user_id', this.userId)
      this.standaloneMode = true
      this.ready = true
    },
    refresh(payload: StudioAuthPayload) {
      // 处理 studio 侧 session 刷新推送（含账号切换场景）
      this.token = payload.token
      this.apiKey = payload.apiKey
      this.userId = payload.userId  // 账号切换时 userId 也会变化
    },
  },
})
```

### 4.2 main.ts — postMessage 监听

```typescript
const STUDIO_ORIGIN = import.meta.env.VITE_STUDIO_ORIGIN || 'https://studio.lsaigc.com'
const isInIframe = window.self !== window.top

if (isInIframe) {
  // 先注册 message 监听，再发送 DRAMA_READY，避免信号丢失
  window.addEventListener('message', (event) => {
    // 精确 origin 匹配，防止 evillsaigc.com 等相似域名伪造
    if (event.origin !== STUDIO_ORIGIN) return

    if (event.data?.type === 'STUDIO_AUTH' || event.data?.type === 'STUDIO_AUTH_REFRESH') {
      const auth = useAuthStore()
      if (event.data.type === 'STUDIO_AUTH_REFRESH' && auth.ready) {
        auth.refresh(event.data)
      } else {
        auth.initFromMessage(event.data)
      }
    }
  })

  // DRAMA_READY 在 Vue 应用就绪后发送（router.isReady() 确保路由初始化完成）
  // main.ts 中 app.mount 之后调用：
  //   router.isReady().then(() => {
  //     window.parent.postMessage({ type: 'DRAMA_READY' }, STUDIO_ORIGIN)
  //   })

  // 超时降级
  setTimeout(() => {
    if (!useAuthStore().ready) {
      console.error('[Auth] Studio auth timeout after 5s')
      router.push({ path: '/error', query: { reason: 'auth_timeout' } })
    }
  }, 5000)
} else {
  useAuthStore().initStandalone()
}
```

### 4.3 Axios 拦截器

**文件**: `web/src/utils/request.ts`

```typescript
import { useAuthStore } from '@/stores/auth'

request.interceptors.request.use((config) => {
  const auth = useAuthStore()
  if (!auth.standaloneMode && auth.apiKey) {
    config.headers['Authorization'] = `Bearer ${auth.token}`   // NextAuth JWT
    config.headers['X-API-Key']     = auth.apiKey              // lsaigc API Key
    config.headers['X-User-ID']     = auth.userId
  }
  return config
})
```

### 4.4 路由守卫

```typescript
import { useAuthStore } from '@/stores/auth'
import { watch } from 'vue'

router.beforeEach(async () => {
  const auth = useAuthStore()
  if (!auth.ready) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => auth.ready, (ready) => {
        if (ready) { stop(); resolve() }
      })
      setTimeout(resolve, 5000)
    })
  }
})
```

### 4.5 新增环境变量

```bash
# web/.env
VITE_STUDIO_ORIGIN=https://studio.lsaigc.com
```

---

## 5. 火宝短剧后端改动（Go）

### 5.1 Auth 中间件

**文件**: `api/middlewares/auth.go`（新建）

```go
package middlewares

import (
    "strings"
    "time"
    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
)

const (
    CtxUserID = "user_id"
    CtxAPIKey = "api_key"
)

// AuthMiddleware 验证 NextAuth HS256 JWT
// standalone 模式（无 Authorization header）：user_id 取 X-User-ID header 值，允许通过
// studio 模式：验证 JWT 签名 + exp，从 claims 提取 userId（不信任 X-User-ID header）
func AuthMiddleware(nextAuthSecret string) gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")

        // standalone 模式
        if authHeader == "" {
            userID := c.GetHeader("X-User-ID")
            if userID == "" {
                userID = "standalone"
            }
            c.Set(CtxUserID, userID)
            c.Set(CtxAPIKey, "")
            c.Next()
            return
        }

        // studio 模式：验 JWT
        tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
        claims := jwt.MapClaims{}
        _, err := jwt.ParseWithClaims(
            tokenStr,
            claims,
            func(t *jwt.Token) (interface{}, error) {
                // 确认算法为 HS256
                if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                    return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
                }
                return []byte(nextAuthSecret), nil
            },
            jwt.WithExpirationRequired(),          // 强制校验 exp
            jwt.WithLeeway(30 * time.Second),      // 允许 30s 时钟偏差
        )
        if err != nil {
            c.JSON(401, gin.H{"error": "invalid or expired token"})
            c.Abort()
            return
        }

        // 从 JWT claims 提取 userId（不信任客户端传的 X-User-ID）
        userID, _ := claims["id"].(string)  // NextAuth 的 id claim
        if userID == "" {
            userID, _ = claims["sub"].(string)
        }
        if userID == "" {
            c.JSON(401, gin.H{"error": "missing user id in token"})
            c.Abort()
            return
        }

        apiKey := c.GetHeader("X-API-Key")  // lsaigc API Key，透传给网关

        c.Set(CtxUserID, userID)
        c.Set(CtxAPIKey, apiKey)
        c.Next()
    }
}
```

### 5.2 路由注册

**文件**: `api/routes/routes.go`

```go
// 在所有路由前全局注册
r.Use(middlewares.AuthMiddleware(cfg.Auth.NextAuthSecret))

// ai-configs 路由：集成模式下通过 middleware 保护（user_id 隔离），无需禁用
// standalone 模式下保持现有行为不变
```

### 5.3 CORS 更新（含自定义 Header）

**文件**: `api/middlewares/cors.go`

```go
AllowOrigins: []string{
    "http://localhost:3012",
    "https://*.vercel.app",
    "https://studio.lsaigc.com",
    "https://drama.lsaigc.com",
},
// 必须包含所有自定义 header，否则 OPTIONS preflight 会失败
AllowHeaders: []string{
    "Content-Type",
    "Authorization",
    "X-API-Key",      // lsaigc API Key
    "X-User-ID",      // 用户 ID（standalone 模式使用）
},
```

### 5.4 需要加 user_id 的数据模型

以下模型均为顶级资源，需直接加 `UserID` 字段：

| 模型 | 文件 | 说明 |
|------|------|------|
| `Drama` | `domain/models/drama.go` | 核心资源，所有 Episode/Scene/Character 通过此关联 |
| `CharacterLibrary` | `domain/models/character_library.go` | 独立于 Drama 的角色库 |
| `ImageGeneration` | `domain/models/image_generation.go` | 独立图片生成任务 |
| `VideoGeneration` | `domain/models/video_generation.go` | 独立视频生成任务 |
| `VideoMerge` | `domain/models/video_merge.go` | 视频合并任务 |
| `Asset` | `domain/models/asset.go` | 资产管理 |

```go
// 以 Drama 为例，其他表同理
type Drama struct {
    // ... 已有字段
    UserID string `json:"user_id" gorm:"index;not null;default:'standalone'"`
}
```

存量数据默认值 `'standalone'`，不影响现有数据。

所有 Service 层查询加 user_id 过滤（以 Drama 为例）：

```go
func (s *DramaService) ListByUser(ctx context.Context, userID string) ([]*models.Drama, error) {
    return s.repo.FindAll(ctx, map[string]interface{}{"user_id": userID})
}
```

### 5.5 AI 服务 context 注入

**改造范围**：`application/services/` 下所有调用 AI 的 service（约 10 个），统一为方法签名加 `ctx context.Context` 参数。

```go
// application/services/ai_service.go
func (s *AIService) GetOpenAIClient(ctx context.Context) *openai.Client {
    // 优先使用请求级 API Key（studio 模式）
    // 使用 comma-ok 断言，避免 nil 值 panic
    apiKey, _ := ctx.Value(middlewares.CtxAPIKey).(string)
    if apiKey != "" {
        return openai.NewClient(
            option.WithAPIKey(apiKey),
            option.WithBaseURL(os.Getenv("GATEWAY_URL")),  // 后端环境变量，不信任客户端
        )
    }
    // 回退到数据库配置（standalone 模式）
    return s.getClientFromDB(ctx)
}
```

Handler 层将 gin.Context 中的值注入到 `context.Context` 后传入 Service。

**Context key 使用私有类型**（避免 `go vet SA1029` 警告，防止包间碰撞）：

```go
// api/middlewares/context_keys.go（新建）
type contextKey string

const (
    CtxUserID contextKey = "user_id"
    CtxAPIKey contextKey = "api_key"
)

// InjectToContext 提取 gin context 中的认证信息注入到标准 context
func InjectToContext(c *gin.Context) context.Context {
    ctx := c.Request.Context()
    ctx = context.WithValue(ctx, CtxUserID, c.GetString(string(CtxUserID)))
    ctx = context.WithValue(ctx, CtxAPIKey, c.GetString(string(CtxAPIKey)))
    return ctx
}
```

Handler 调用方式（约 10 个 handler 统一用辅助函数）：

```go
// api/handlers/image_generation.go（其他 handler 同理）
func (h *ImageHandler) Generate(c *gin.Context) {
    ctx := middlewares.InjectToContext(c)
    result, err := h.imageService.Generate(ctx, req)
    // ...
}
```

**Phase 4 改造范围提示**：`application/services/` 下所有涉及 AI 调用的 service 方法均需加 `ctx context.Context` 参数（约 10 个 service × 若干方法），属于破坏性重构，Phase 4 需全量回归测试。

### 5.6 静态文件路由（本地 fallback）

`/static` 路由当前完全公开。集成模式下文件通过 COS URL 访问（带签名），无需 `/static`。本地 standalone 模式保持现有行为，但路径结构对齐 COS 路径约定：

```
{localPath}/drama/{userId}/{dramaId}/{category}/{filename}
```

### 5.7 新增环境变量

```bash
# Railway 环境变量
NEXTAUTH_SECRET=<与 studio 完全一致的 secret>  # JWT 验签共享密钥
GATEWAY_URL=https://api.lsaigc.com/v1          # AI 网关地址（后端固定，不由客户端传）
STUDIO_ORIGIN=https://studio.lsaigc.com        # 允许的 postMessage 来源
```

> **NEXTAUTH_SECRET 分发**：通过 Railway Dashboard 的环境变量管理界面手动设置，值与 studio 的 Vercel 环境变量保持一致。不在 git 代码库中存储。

---

## 6. COS 存储集成（Go 后端）

### 6.1 StorageService 接口

**文件**: `infrastructure/storage/storage.go`（新建接口文件）

```go
type StorageService interface {
    // 上传文件，返回访问 URL
    Save(ctx context.Context, key string, data []byte, contentType string) (string, error)

    // 从远程 URL 下载并保存（AI 生成结果下载）
    DownloadAndSave(ctx context.Context, remoteURL string, key string) (string, error)

    // 获取文件访问 URL（COS 时返回带签名 URL，本地时返回 /static 路径）
    GetURL(ctx context.Context, key string) (string, error)

    // 获取本地绝对路径（ffmpeg 视频合并用，COS 模式下先下载到临时目录）
    // 约定：调用方负责用 defer os.Remove(path) 清理临时文件
    // 并发安全：COS 实现使用 key hash 作为临时文件名，同 key 并发调用可复用已下载文件
    GetLocalPath(ctx context.Context, key string) (localPath string, cleanup func(), err error)

    // 删除文件
    Delete(ctx context.Context, key string) error
}
```

### 6.2 存储路径约定

```
drama/{userId}/{dramaId}/
├── characters/{characterId}/{timestamp}.jpg
├── scenes/{sceneId}/{timestamp}.jpg
├── episodes/{episodeId}/
│   ├── storyboards/{storyboardId}/
│   │   ├── frame_{index}.jpg
│   │   └── video_{index}.mp4
│   └── audio/{timestamp}.mp3
└── output/final_{timestamp}.mp4
```

路径生成统一通过 `pkg/cos/keys.go` 函数：

```go
func DramaBaseKey(userID, dramaID string) string {
    return fmt.Sprintf("drama/%s/%s", userID, dramaID)
}
func CharacterKey(userID, dramaID, charID, filename string) string {
    return fmt.Sprintf("drama/%s/%s/characters/%s/%s", userID, dramaID, charID, filename)
}
// 其他类型同理...
```

### 6.3 实现切换

通过 `STORAGE_TYPE` 环境变量在初始化时选择实现：

```go
// infrastructure/storage/factory.go
func NewStorageService(cfg *config.StorageConfig) StorageService {
    switch cfg.Type {
    case "cos":
        return NewCOSStorage(cfg)
    default:
        return NewLocalStorage(cfg)
    }
}
```

### 6.4 新增环境变量

```bash
STORAGE_TYPE=cos          # local | cos
COS_SECRET_ID=xxx
COS_SECRET_KEY=xxx
COS_BUCKET=drama-xxx
COS_REGION=ap-guangzhou
```

---

## 7. 安全设计

| 风险点 | 防护措施 |
|--------|---------|
| postMessage 伪造 | 精确字符串匹配 `event.origin === VITE_STUDIO_ORIGIN`（环境变量注入） |
| JWT 篡改/过期 | Go 中间件：HS256 算法验签 + 强制校验 `exp` claim |
| userId 伪造 | userId 从已验证 JWT claims 中提取，不信任 `X-User-ID` header（studio 模式下） |
| gatewayUrl 注入攻击 | 网关地址由后端 `GATEWAY_URL` 环境变量固定，不接受客户端传入 |
| API Key 泄漏 | apiKey 仅存 Vue Pinia 内存，不写 localStorage/cookie/sessionStorage |
| COS 数据越界 | 所有 key 含 userId 前缀，Service 层校验 key 归属 |
| iframe 点击劫持 | 火宝后端响应头加 `Content-Security-Policy: frame-ancestors 'self' https://studio.lsaigc.com`（`X-Frame-Options: ALLOW-FROM` 已废弃，现代浏览器仅支持 CSP frame-ancestors）|
| JWT 重放攻击 | 强制 exp 校验，建议 NextAuth token 有效期 ≤ 1 小时（生产环境配置） |
| CORS 绕过 | AllowHeaders 明确列出所有自定义 header，防止 preflight 绕过 |

---

## 8. 部署配置更新

### studio（Vercel）

```bash
# 新增
NEXT_PUBLIC_DRAMA_ORIGIN=https://drama.lsaigc.com
```

```typescript
// next.config.ts - CSP 允许 iframe
"frame-src 'self' https://drama.lsaigc.com"
```

### 火宝前端（Vercel，drama.lsaigc.com）

```bash
# web/.env.production
VITE_STUDIO_ORIGIN=https://studio.lsaigc.com
```

### 火宝后端（Railway）

```bash
NEXTAUTH_SECRET=<与 studio 完全一致>
GATEWAY_URL=https://api.lsaigc.com/v1
STUDIO_ORIGIN=https://studio.lsaigc.com
STORAGE_TYPE=cos
COS_SECRET_ID=xxx
COS_SECRET_KEY=xxx
COS_BUCKET=drama-xxx
COS_REGION=ap-guangzhou
```

---

## 9. 实现顺序

| 阶段 | 内容 | 估时 | 验收 |
|------|------|------|------|
| **Phase 1** 基础通信层 | 火宝 authStore、postMessage 监听、axios 拦截器；studio `/drama` 页面 | 1-2天 | 打开 /drama，console 收到 STUDIO_AUTH，axios 请求带正确 headers |
| **Phase 2** 后端认证 | Go auth middleware（JWT 验证 + exp）、CORS 更新 | 1天 | curl 带合法 JWT 返回 200，不带返回 401，过期 JWT 返回 401 |
| **Phase 3** 数据隔离 | 6 张表加 user_id、Service 层 scoped 查询、migration | 2天 | 不同 userId 的请求互相看不到对方数据 |
| **Phase 4** AI 接口切换 | AIService.GetOpenAIClient(ctx)、Handler 传入 ctx | 1-2天 | 生成请求走 lsaigc gateway（查网关日志确认） |
| **Phase 5** COS 存储 | StorageService interface、COS 实现、路径改造 | 2-3天 | 上传文件出现在 COS 对应路径，URL 可访问 |

---

## 10. 不在本期范围内

- 火宝独立域访问时的登录 UI（本期 iframe 超时直接报错）
- studio 与火宝双向数据同步（如把短剧视频导入 canvas 节点）
- 存量数据迁移到 COS（存量保持 local/standalone，新数据走 COS）
- `/static` 路由的访问控制（本期 standalone 模式维持现状）
- studio session 主动刷新推送（本期 token 有效期内不刷新）

---

## 11. 核心文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `studio/.../drama/page.tsx` | 新增 | iframe 页面 + postMessage 发送 |
| `studio/.../DashboardLayout.tsx` | 修改 | 添加短剧导航入口 |
| `studio/next.config.ts` | 修改 | CSP frame-src |
| `web/src/stores/auth.ts` | 新增 | 认证状态（仅内存） |
| `web/src/main.ts` | 修改 | postMessage 监听 |
| `web/src/utils/request.ts` | 修改 | axios 注入 3 个 headers |
| `web/src/router/index.ts` | 修改 | 路由守卫等待 auth.ready |
| `api/middlewares/auth.go` | 新增 | JWT 验证（HS256 + exp） |
| `api/middlewares/cors.go` | 修改 | AllowHeaders 加自定义 header |
| `api/routes/routes.go` | 修改 | 全局注册 auth middleware |
| `domain/models/drama.go` | 修改 | 加 user_id |
| `domain/models/character_library.go` | 修改 | 加 user_id |
| `domain/models/image_generation.go` | 修改 | 加 user_id |
| `domain/models/video_generation.go` | 修改 | 加 user_id |
| `domain/models/video_merge.go` | 修改 | 加 user_id |
| `domain/models/asset.go` | 修改 | 加 user_id |
| `application/services/drama_service.go` | 修改 | scoped 查询 |
| `application/services/image_generation_service.go` | 修改 | scoped 查询 + ctx 注入 |
| `application/services/video_generation_service.go` | 修改 | scoped 查询 + ctx 注入 |
| `application/services/ai_service.go` | 修改 | GetOpenAIClient(ctx) |
| `infrastructure/storage/storage.go` | 新增 | StorageService interface |
| `infrastructure/storage/cos_storage.go` | 新增 | COS 实现 |
| `infrastructure/storage/local_storage.go` | 修改 | 实现完整 interface，路径加 userId |
| `infrastructure/storage/factory.go` | 新增 | 按 STORAGE_TYPE 选择实现 |
| `pkg/cos/client.go` | 新增 | COS 客户端 |
| `pkg/cos/keys.go` | 新增 | 路径生成工具函数 |
| `configs/config.yaml` | 修改 | auth + storage 新节 |
