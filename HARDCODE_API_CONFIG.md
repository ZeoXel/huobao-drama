# 🔐 写死 API 配置部署指南

## 方案说明

通过 Railway 环境变量 + 后端自动初始化，实现 API 配置写死，无需前端手动配置。

## 📋 步骤

### 1. 在 Railway 设置环境变量

访问 Railway Dashboard：
1. 打开 https://railway.app/dashboard
2. 选择你的 Go 应用服务
3. 进入 **Variables** 标签
4. 添加以下环境变量：

```bash
# OpenAI 配置（必需）
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# 豆包视频配置（可选）
DOUBAO_API_KEY=your-doubao-key-here
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

### 2. 提交代码并部署

```bash
# 提交修改
git add .
git commit -m "feat: 自动初始化 AI 配置"
git push origin master

# Railway 会自动重新部署
```

### 3. 验证配置

```bash
# 检查 AI 配置是否自动创建
curl https://huobao-drama-production-d66c.up.railway.app/api/v1/ai-configs
```

应该返回自动创建的配置列表。

## 🎯 工作原理

1. **后端启动时**：读取 Railway 环境变量
2. **检查数据库**：如果没有 AI 配置，自动插入
3. **前端使用**：直接调用后端 API，无需手动配置

## 🔧 可选：隐藏前端 AI 配置页面

如果不想让用户看到 AI 配置管理界面：

编辑 `web/src/router/index.ts`，注释掉 AI 配置路由：

```typescript
// {
//   path: '/ai-config',
//   name: 'AIConfig',
//   component: () => import('@/views/settings/AIConfig.vue')
// },
```

## 📝 环境变量说明

| 变量名 | 必需 | 说明 | 默认值 |
|--------|------|------|--------|
| OPENAI_API_KEY | ✅ | OpenAI API Key | - |
| OPENAI_BASE_URL | ❌ | OpenAI API 地址 | https://api.openai.com/v1 |
| DOUBAO_API_KEY | ❌ | 豆包 API Key | - |
| DOUBAO_BASE_URL | ❌ | 豆包 API 地址 | https://ark.cn-beijing.volces.com/api/v3 |

## ✅ 优势

- ✅ 无需前端手动配置
- ✅ 配置集中管理（Railway Dashboard）
- ✅ 支持多环境（开发/生产）
- ✅ 安全（API Key 不暴露在前端）
- ✅ 自动初始化（首次启动自动创建）

## 🔄 更新配置

修改 Railway 环境变量后，重启服务：
```bash
railway restart
```

或通过 Railway Dashboard 点击 "Restart"。
