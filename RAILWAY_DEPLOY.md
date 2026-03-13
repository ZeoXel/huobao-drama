# 🚂 Railway 后端部署指南

## 问题说明

当前 Railway 链接的是 **Postgres 数据库服务**，不是 Go 应用。需要创建新服务来部署后端。

## 🎯 快速部署步骤

### 方式 1：通过 GitHub 部署（推荐）

1. **访问 Railway**
   - 打开 https://railway.app/dashboard
   - 选择你的项目 "positive-empathy"

2. **创建新服务**
   - 点击 "+ New Service"
   - 选择 "GitHub Repo"
   - 选择 `ZeoXel/huobao-drama` 仓库

3. **配置服务**
   - Railway 会自动检测到 Go 项目
   - 构建命令：`go build -o main .`
   - 启动命令：`./main`
   - 端口：5678

4. **添加域名**
   - 点击服务 → Settings → Networking
   - 点击 "Generate Domain"
   - 复制生成的域名（例如：huobao-drama-production-xxxx.up.railway.app）

5. **更新 Vercel 配置**
   - 将新域名更新到 `vercel.json`
   - 重新部署前端

### 方式 2：通过 Railway CLI 部署

```bash
# 1. 进入项目目录
cd /Users/g/Desktop/探索/huobao-drama

# 2. 创建新服务（需要手动选择）
railway service create

# 3. 部署
railway up

# 4. 添加域名
railway domain

# 5. 查看日志
railway logs
```

## 🔧 环境变量配置（可选）

如果需要自定义配置，在 Railway 服务中添加环境变量：

```
PORT=5678
GIN_MODE=release
```

## ✅ 验证部署

部署完成后，访问：
```
https://your-railway-domain.up.railway.app/health
```

应该返回：
```json
{"status":"ok"}
```

## 📝 更新 Vercel 配置

获得 Railway 域名后，运行：

```bash
# 自动更新 vercel.json 并重新部署
./scripts/update_backend.sh your-railway-domain.up.railway.app
```

或手动编辑 `vercel.json`：
```json
{
  "rewrites": [{
    "source": "/api/:path*",
    "destination": "https://your-railway-domain.up.railway.app/api/:path*"
  }]
}
```

然后重新部署：
```bash
vercel --prod --yes
```

## 🐛 常见问题

### Q: Railway 构建失败？
A: 检查 Go 版本，确保 `go.mod` 中的版本与 Railway 支持的版本匹配。

### Q: 服务启动后立即退出？
A: 检查日志 `railway logs`，可能是端口配置问题。

### Q: 502 Bad Gateway？
A: 服务可能还在启动中，等待 1-2 分钟后重试。
