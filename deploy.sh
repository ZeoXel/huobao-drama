#!/bin/bash

# ========================================
# 完整部署流程
# ========================================

set -e

echo "🚀 Huobao Drama 部署助手"
echo ""

# ==================== 步骤 1: 登录检查 ====================
echo "📋 步骤 1: 检查登录状态"
echo ""

# 检查 Vercel 登录
echo "检查 Vercel..."
if vercel whoami &>/dev/null; then
    VERCEL_USER=$(vercel whoami)
    echo "✅ Vercel 已登录: $VERCEL_USER"
else
    echo "❌ Vercel 未登录"
    echo "请运行: vercel login"
    read -p "现在登录 Vercel? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        vercel login
    else
        echo "跳过 Vercel 部署"
        SKIP_VERCEL=1
    fi
fi

# 检查 Railway 登录
echo ""
echo "检查 Railway..."
if railway whoami &>/dev/null; then
    RAILWAY_USER=$(railway whoami)
    echo "✅ Railway 已登录: $RAILWAY_USER"
else
    echo "❌ Railway 未登录"
    echo "请运行: railway login"
    read -p "现在登录 Railway? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        railway login
    else
        echo "跳过 Railway 部署"
        SKIP_RAILWAY=1
    fi
fi

echo ""
echo "=========================================="
echo ""

# ==================== 步骤 2: 部署后端到 Railway ====================
if [ -z "$SKIP_RAILWAY" ]; then
    echo "📦 步骤 2: 部署后端到 Railway"
    echo ""

    # 检查是否已链接项目
    if [ -f "railway.json" ] || railway status &>/dev/null; then
        echo "检测到已有 Railway 项目"
        read -p "重新部署到现有项目? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            railway up
        fi
    else
        echo "创建新的 Railway 项目..."
        railway init
        railway up
    fi

    echo ""
    echo "获取后端 URL..."
    BACKEND_URL=$(railway domain 2>/dev/null || echo "")

    if [ -z "$BACKEND_URL" ]; then
        echo "⚠️  未检测到域名，请手动添加："
        echo "   railway domain"
        read -p "请输入 Railway 域名 (例: your-app.railway.app): " BACKEND_URL
    fi

    echo "✅ 后端部署完成: https://$BACKEND_URL"
    echo ""
else
    read -p "请输入后端 API 地址 (例: your-app.railway.app): " BACKEND_URL
fi

echo "=========================================="
echo ""

# ==================== 步骤 3: 更新 Vercel 配置 ====================
echo "📝 步骤 3: 更新 Vercel 配置"
echo ""

if [ ! -z "$BACKEND_URL" ]; then
    # 移除协议前缀
    BACKEND_URL=$(echo $BACKEND_URL | sed 's|https://||' | sed 's|http://||')

    cat > vercel.json <<EOF
{
  "buildCommand": "cd web && npm install && npm run build",
  "outputDirectory": "web/dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://$BACKEND_URL/api/:path*"
    },
    {
      "source": "/static/:path*",
      "destination": "https://$BACKEND_URL/static/:path*"
    }
  ]
}
EOF
    echo "✅ vercel.json 已更新"
    echo "   后端地址: https://$BACKEND_URL"
fi

echo ""
echo "=========================================="
echo ""

# ==================== 步骤 4: 部署前端到 Vercel ====================
if [ -z "$SKIP_VERCEL" ]; then
    echo "🎨 步骤 4: 部署前端到 Vercel"
    echo ""

    read -p "开始部署到 Vercel? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        vercel --prod
        echo ""
        echo "✅ 前端部署完成"
    fi
fi

echo ""
echo "=========================================="
echo "🎉 部署完成！"
echo ""
echo "📍 访问地址："
if [ ! -z "$BACKEND_URL" ]; then
    echo "   后端: https://$BACKEND_URL"
fi
echo "   前端: 查看上方 Vercel 输出的 URL"
echo ""
echo "⚠️  别忘了配置 API Key："
echo "   访问前端 -> AI 配置页面 -> 添加配置"
echo "=========================================="
