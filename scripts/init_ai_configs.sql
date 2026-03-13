-- ========================================
-- 默认 AI 配置初始化脚本
-- 使用方法：项目首次启动后执行此脚本
-- ========================================

-- 清空现有配置（可选）
-- DELETE FROM ai_service_configs;

-- 1. 文本生成配置（OpenAI GPT-4）
INSERT INTO ai_service_configs (
    service_type, provider, name, base_url, api_key, model,
    endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    'text',
    'openai',
    'OpenAI GPT-4',
    'https://api.openai.com/v1',
    'sk-your-openai-api-key-here',
    '["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"]',
    '/chat/completions',
    1,
    1,
    1,
    datetime('now'),
    datetime('now')
);

-- 2. 图片生成配置（OpenAI DALL-E）
INSERT INTO ai_service_configs (
    service_type, provider, name, base_url, api_key, model,
    endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    'image',
    'openai',
    'OpenAI DALL-E',
    'https://api.openai.com/v1',
    'sk-your-openai-api-key-here',
    '["dall-e-3", "dall-e-2"]',
    '/images/generations',
    1,
    1,
    1,
    datetime('now'),
    datetime('now')
);

-- 3. 视频生成配置（豆包/火山引擎）
INSERT INTO ai_service_configs (
    service_type, provider, name, base_url, api_key, model,
    endpoint, query_endpoint, priority, is_default, is_active, created_at, updated_at
) VALUES (
    'video',
    'doubao',
    '豆包视频生成',
    'https://ark.cn-beijing.volces.com/api/v3',
    'your-doubao-api-key-here',
    '["doubao-video-pro"]',
    '/video/submit',
    '/video/query',
    1,
    1,
    1,
    datetime('now'),
    datetime('now')
);
