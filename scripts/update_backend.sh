#!/bin/bash

# ========================================
# 更新后端地址并重新部署前端
# ========================================

if [ -z "$1" ]; then
    echo "用法: ./scripts/update_backend.sh <railway-domain>"
    echo "示例: ./scripts/update_backend.sh huobao-drama-production-xxxx.up.railway.app"
    exit 1
fi

BACKEND_URL=$1

# 移除协议前缀
BACKEND_URL=$(echo $BACKEND_URL | sed 's|https://||' | sed 's|http://||')

echo "🔧 更新后端地址: $BACKEND_URL"

# 更新 vercel.json
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
echo ""
echo "🚀 重新部署到 Vercel..."

vercel --prod --yes

echo ""
echo "✅ 部署完成！"
echo "   后端: https://$BACKEND_URL"
