#!/bin/bash

# ========================================
# Huobao Drama 本地一键启动脚本
# ========================================

set -e

echo "🎬 Huobao Drama 启动中..."

# 检查 FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ 错误：未安装 FFmpeg"
    echo "请先安装 FFmpeg："
    echo "  macOS: brew install ffmpeg"
    echo "  Ubuntu: sudo apt install ffmpeg"
    exit 1
fi

# 检查 Go
if ! command -v go &> /dev/null; then
    echo "❌ 错误：未安装 Go"
    echo "请从 https://golang.org/dl/ 下载安装"
    exit 1
fi

# 创建配置文件（如果不存在）
if [ ! -f "configs/config.yaml" ]; then
    echo "📝 创建默认配置文件..."
    cp configs/config.example.yaml configs/config.yaml
fi

# 创建数据目录
mkdir -p data/storage

# 安装 Go 依赖
echo "📦 安装 Go 依赖..."
go mod download

# 安装前端依赖
if [ ! -d "web/node_modules" ]; then
    echo "📦 安装前端依赖..."
    cd web
    npm install
    cd ..
fi

# 启动后端
echo "🚀 启动后端服务..."
go run main.go &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 初始化 AI 配置（如果数据库为空）
if [ -f "scripts/init_ai_configs.sql" ]; then
    echo "🔧 初始化 AI 配置..."
    sqlite3 data/drama_generator.db < scripts/init_ai_configs.sql 2>/dev/null || true
fi

# 启动前端
echo "🎨 启动前端服务..."
cd web
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ 启动成功！"
echo ""
echo "📍 访问地址："
echo "   前端: http://localhost:3012"
echo "   后端: http://localhost:5678"
echo ""
echo "⚠️  首次使用请在 Web 界面配置 AI API Key"
echo "   或编辑 scripts/init_ai_configs.sql 后重新运行"
echo ""
echo "按 Ctrl+C 停止服务"

# 等待用户中断
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
