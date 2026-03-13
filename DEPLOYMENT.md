# 🚀 部署指南

## 📋 目录

- [本地启动](#本地启动)
- [Vercel 部署前端](#vercel-部署前端)
- [后端部署选项](#后端部署选项)
- [写死 API 配置](#写死-api-配置)

---

## 🏠 本地启动

### 方式一：一键启动（推荐）

```bash
./start.sh
```

访问：http://localhost:3012

### 方式二：手动启动

```bash
# 终端1：启动后端
go run main.go

# 终端2：启动前端
cd web
npm run dev
```

---

## ☁️ Vercel 部署前端

### 前提条件

⚠️ **重要**：Vercel 只能部署前端，后端需要部署到其他服务（见下方）

### 步骤 1：准备后端 API 地址

先部署后端到以下任一平台：
- Railway (推荐)
- Render
- Fly.io
- 自己的服务器

获得后端 API 地址，例如：`https://your-app.railway.app`

### 步骤 2：修改 Vercel 配置

编辑 `vercel.json`，替换后端地址：

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend-api.com/api/:path*"
    }
  ]
}
```

### 步骤 3：部署到 Vercel

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel --prod
```

或通过 Vercel Dashboard：
1. 导入 GitHub 仓库
2. 设置构建命令：`cd web && npm install && npm run build`
3. 设置输出目录：`web/dist`
4. 部署

---

## 🖥️ 后端部署选项

### 选项 1：Railway（推荐，最简单）

1. 访问 https://railway.app
2. 连接 GitHub 仓库
3. 添加环境变量（可选）
4. 自动部署

Railway 会自动识别 Go 项目并构建。

### 选项 2：Docker 部署

```bash
# 构建镜像
docker build -t huobao-drama .

# 运行容器
docker run -d \
  -p 5678:5678 \
  -v $(pwd)/data:/app/data \
  --name huobao-drama \
  huobao-drama
```

### 选项 3：传统服务器部署

```bash
# 1. 构建
./build.sh

# 2. 上传到服务器
scp huobao-drama user@server:/opt/huobao-drama/
scp configs/config.yaml user@server:/opt/huobao-drama/configs/

# 3. 服务器上运行
ssh user@server
cd /opt/huobao-drama
./huobao-drama
```

---

## 🔧 写死 API 配置

### 方法 1：SQL 脚本初始化（推荐）

编辑 `scripts/init_ai_configs.sql`，填入你的 API Key：

```sql
-- 文本生成
INSERT INTO ai_service_configs (...) VALUES (
    'text', 'openai', 'OpenAI GPT-4',
    'https://api.openai.com/v1',
    'sk-your-real-api-key-here',  -- 👈 修改这里
    ...
);
```

然后执行：

```bash
sqlite3 data/drama_generator.db < scripts/init_ai_configs.sql
```

### 方法 2：直接修改数据库

```bash
sqlite3 data/drama_generator.db

-- 查看现有配置
SELECT id, name, provider, api_key FROM ai_service_configs;

-- 更新 API Key
UPDATE ai_service_configs
SET api_key = 'sk-your-new-key'
WHERE id = 1;
```

### 方法 3：通过 Web 界面配置

1. 启动项目后访问 http://localhost:3012
2. 进入"AI 配置"页面
3. 添加/编辑配置
4. 配置会自动保存到数据库

---

## 🔑 获取 API Key

### OpenAI
- 官网：https://platform.openai.com/api-keys
- 国内镜像：https://api.chatfire.site/models

### 豆包/火山引擎
- 官网：https://console.volcengine.com/ark

### Gemini
- 官网：https://makersuite.google.com/app/apikey

---

## ✅ 验证部署

### 检查后端

```bash
curl http://localhost:5678/health
# 应返回：{"status":"ok"}
```

### 检查前端

访问 http://localhost:3012，应该能看到界面

### 检查 AI 配置

```bash
curl http://localhost:5678/api/v1/ai-configs
# 应返回配置列表
```

---

## 🐛 常见问题

### Q: Vercel 部署后 API 请求失败？
A: 检查 `vercel.json` 中的后端地址是否正确，确保后端已部署并可访问。

### Q: 数据库权限错误？
A: 确保 `data` 目录有写权限：
```bash
chmod -R 755 data
```

### Q: FFmpeg 未找到？
A:
- macOS: `brew install ffmpeg`
- Ubuntu: `sudo apt install ffmpeg`
- Docker: 已内置，无需安装

---

## 📞 技术支持

- GitHub Issues: https://github.com/chatfire-AI/huobao-drama/issues
- Email: 18550175439@163.com
