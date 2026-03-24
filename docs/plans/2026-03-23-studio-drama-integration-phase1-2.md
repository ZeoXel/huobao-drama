# Studio × 火宝短剧（Phase 1-2）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 打通 studio iframe 到火宝前后端的基础通信与认证链路（不含数据隔离/COS）。

**Architecture:** studio 在 `/drama` 页面通过 `postMessage` 下发 `{token, apiKey, userId}`；火宝前端内存态接收并注入请求头；火宝后端中间件校验 JWT 并将用户身份写入上下文供后续服务使用。保持 standalone 模式兼容。

**Tech Stack:** Next.js 16 + NextAuth、Vue3 + Pinia + Axios、Gin + JWT(v5)

---

### Task 1: Studio `/drama` 页面与 token 下发

**Files:**
- Create: `src/app/(dashboard)/drama/page.tsx`
- Create: `src/app/api/auth/drama-token/route.ts`
- Create: `src/hooks/useUserApiKey.ts`
- Modify: `src/components/dashboard/DashboardSidebar.tsx`
- Modify: `next.config.ts`
- Modify: `.env.example`

**Step 1: 写最小行为校验（构建/类型检查作为回归验证）**
Run: `npm run build`（在 studio）
Expected: 当前代码可构建（作为改动前基线）

**Step 2: 实现最小功能**
- 新增 `/drama` 页面，监听 `DRAMA_READY` 后发送 `STUDIO_AUTH`。
- 新增 `/api/auth/drama-token`，基于 server session 返回短期 JWT（HS256，含 `id/sub/exp`）。
- 新增 `useUserApiKey` hook 封装现有 key 拉取逻辑。
- 侧栏新增“短剧创作”入口。
- next headers 添加 `frame-src` CSP。

**Step 3: 验证**
Run: `npm run build`（在 studio）
Expected: build 通过。

### Task 2: 火宝前端握手、鉴权头注入与守卫

**Files:**
- Create: `web/src/stores/auth.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/utils/request.ts`
- Modify: `web/src/router/index.ts`

**Step 1: 写最小行为校验（类型构建基线）**
Run: `npm run build:check`（在 `web`）
Expected: 当前代码可构建。

**Step 2: 实现最小功能**
- iframe 模式监听 `STUDIO_AUTH` / `STUDIO_AUTH_REFRESH`。
- app ready 后向父窗口发送 `DRAMA_READY`。
- axios 自动注入三种 header。
- 路由守卫等待 `auth.ready`（超时放行或错误路由）。

**Step 3: 验证**
Run: `npm run build:check`（在 `web`）
Expected: build 通过。

### Task 3: 火宝后端 JWT 中间件与路由接入

**Files:**
- Create: `api/middlewares/context_keys.go`
- Create: `api/middlewares/auth.go`
- Create: `api/middlewares/auth_test.go`
- Modify: `api/middlewares/cors.go`
- Modify: `api/routes/routes.go`
- Modify: `pkg/config/config.go`
- Modify: `configs/config.example.yaml`

**Step 1: 写失败测试（RED）**
Run: `go test ./api/middlewares -run TestAuthMiddleware -v`
Expected: 因中间件未实现而失败。

**Step 2: 实现最小功能（GREEN）**
- 中间件支持 standalone 与 studio 两模式。
- studio 模式校验 Bearer JWT + exp，userId 来源 claims。
- 注入 `user_id` 与 `api_key` 到 gin context，并支持转标准 context。
- 路由组接入中间件。
- CORS 允许 `X-API-Key`、`X-User-ID`。

**Step 3: 验证**
Run: `go test ./api/middlewares -run TestAuthMiddleware -v && go test ./...`
Expected: 新增测试通过，全项目测试不回归。

### Task 4: 端到端回归验证

**Files:**
- N/A（命令验证）

**Step 1: Studio 构建验证**
Run: `npm run build`（studio）
Expected: PASS

**Step 2: 火宝前端构建验证**
Run: `npm run build:check`（huobao-drama/web）
Expected: PASS

**Step 3: 火宝后端验证**
Run: `go test ./...`（huobao-drama）
Expected: PASS
