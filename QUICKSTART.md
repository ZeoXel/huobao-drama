# 🚀 快速开始指南

## 本地启动（3 步）

### 1. 一键启动
```bash
./start.sh
```

### 2. 配置 API Key
```bash
./scripts/setup_api.sh
```

### 3. 访问应用
打开浏览器：http://localhost:3012

---

## Vercel 部署

### 前端部署
```bash
vercel --prod
```

### 后端部署
推荐使用 Railway：
1. 访问 https://railway.app
2. 导入此仓库
3. 自动部署完成

### 连接前后端
编辑 `vercel.json`，将后端地址改为你的 Railway 地址：
```json
{
  "rewrites": [{
    "source": "/api/:path*",
    "destination": "https://your-app.railway.app/api/:path*"
  }]
}
```

---

## 写死的 API 配置

已创建默认配置文件：
- `scripts/init_ai_configs.sql` - SQL 初始化脚本
- `scripts/setup_api.sh` - 交互式配置工具

修改 `init_ai_configs.sql` 中的 API Key，然后：
```bash
sqlite3 data/drama_generator.db < scripts/init_ai_configs.sql
```

---

## 获取 API Key

- **OpenAI**: https://platform.openai.com/api-keys
- **豆包**: https://console.volcengine.com/ark
- **国内镜像**: https://api.chatfire.site/models

---

详细文档见 [DEPLOYMENT.md](DEPLOYMENT.md)
