#!/bin/bash

# ========================================
# AI API 配置助手
# ========================================

echo "🔧 AI API 配置助手"
echo ""

# 检查数据库是否存在
if [ ! -f "data/drama_generator.db" ]; then
    echo "❌ 数据库不存在，请先启动项目：./start.sh"
    exit 1
fi

echo "请输入你的 API Key（留空跳过）："
echo ""

# OpenAI 文本生成
read -p "1️⃣  OpenAI API Key (文本生成): " OPENAI_KEY
if [ ! -z "$OPENAI_KEY" ]; then
    sqlite3 data/drama_generator.db <<EOF
INSERT OR REPLACE INTO ai_service_configs (
    id, service_type, provider, name, base_url, api_key, model,
    endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    1, 'text', 'openai', 'OpenAI GPT-4',
    'https://api.openai.com/v1', '$OPENAI_KEY', '["gpt-4","gpt-4-turbo","gpt-3.5-turbo"]',
    '/chat/completions', 1, 1, 1, datetime('now'), datetime('now')
);
EOF
    echo "✅ OpenAI 文本配置已保存"
fi

# OpenAI 图片生成
read -p "2️⃣  OpenAI API Key (图片生成，可与上面相同): " IMAGE_KEY
if [ -z "$IMAGE_KEY" ] && [ ! -z "$OPENAI_KEY" ]; then
    IMAGE_KEY=$OPENAI_KEY
fi
if [ ! -z "$IMAGE_KEY" ]; then
    sqlite3 data/drama_generator.db <<EOF
INSERT OR REPLACE INTO ai_service_configs (
    id, service_type, provider, name, base_url, api_key, model,
    endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    2, 'image', 'openai', 'OpenAI DALL-E',
    'https://api.openai.com/v1', '$IMAGE_KEY', '["dall-e-3","dall-e-2"]',
    '/images/generations', 1, 1, 1, datetime('now'), datetime('now')
);
EOF
    echo "✅ OpenAI 图片配置已保存"
fi

# 豆包视频生成
read -p "3️⃣  豆包/火山引擎 API Key (视频生成): " DOUBAO_KEY
if [ ! -z "$DOUBAO_KEY" ]; then
    sqlite3 data/drama_generator.db <<EOF
INSERT OR REPLACE INTO ai_service_configs (
    id, service_type, provider, name, base_url, api_key, model,
    endpoint, query_endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    3, 'video', 'doubao', '豆包视频生成',
    'https://ark.cn-beijing.volces.com/api/v3', '$DOUBAO_KEY', '["doubao-video-pro"]',
    '/video/submit', '/video/query', 1, 1, 1, datetime('now'), datetime('now')
);
EOF
    echo "✅ 豆包视频配置已保存"
fi

echo ""
echo "🎉 配置完成！"
echo ""
echo "📋 查看当前配置："
sqlite3 data/drama_generator.db "SELECT id, service_type, name, provider FROM ai_service_configs WHERE deleted_at IS NULL;"
echo ""
echo "💡 提示："
echo "   - 可以在 Web 界面中修改配置"
echo "   - 重新运行此脚本可更新配置"
