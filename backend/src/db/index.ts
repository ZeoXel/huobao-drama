import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATABASE_TYPE = (process.env.DATABASE_TYPE || 'sqlite').toLowerCase()

let db: any
let schema: any

if (DATABASE_TYPE === 'postgres') {
  // PostgreSQL mode — connect to existing Supabase/PG database
  const pg = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const pgSchema = await import('./schema-pg.js')

  const DATABASE_URL = process.env.DATABASE_URL || ''
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required when DATABASE_TYPE=postgres')

  const client = pg.default(DATABASE_URL)
  db = drizzle(client, { schema: pgSchema })
  schema = pgSchema

  // Add new columns if missing (safe for existing tables)
  const ensureColumns = [
    // Storyboard new fields from TS version
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS first_frame_image TEXT`,
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS last_frame_image TEXT`,
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS reference_images TEXT`,
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS tts_audio_url TEXT`,
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS subtitle_url TEXT`,
    `ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS composed_video_url TEXT`,
    // Episode fields
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS content TEXT`,
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS image_config_id INTEGER`,
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS video_config_id INTEGER`,
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS audio_config_id INTEGER`,
    // User ID columns (may already exist from Go version)
    `ALTER TABLE dramas ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE video_merges ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE ai_service_configs ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    `ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'standalone'`,
    // Character voice fields
    `ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_sample_url TEXT`,
    `ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_provider TEXT`,
    // Junction table columns (Go GORM created without id/created_at)
    `ALTER TABLE episode_characters ADD COLUMN IF NOT EXISTS id SERIAL`,
    `ALTER TABLE episode_characters ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT ''`,
    // Create episode_scenes if missing (Go version used scene.episode_id instead)
    `CREATE TABLE IF NOT EXISTS episode_scenes (
      id SERIAL PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id ON episode_scenes(episode_id)`,
    `CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id ON episode_scenes(scene_id)`,
    // New tables added by TS version (not in Go version)
    `CREATE TABLE IF NOT EXISTS agent_configs (
      id SERIAL PRIMARY KEY,
      agent_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      model TEXT,
      system_prompt TEXT,
      temperature REAL,
      max_tokens INTEGER,
      max_iterations INTEGER,
      is_active BOOLEAN DEFAULT true,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_voices (
      id SERIAL PRIMARY KEY,
      voice_id TEXT NOT NULL UNIQUE,
      voice_name TEXT NOT NULL,
      description TEXT,
      language TEXT,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    )`,
  ]
  for (const sql of ensureColumns) {
    try { await client.unsafe(sql) } catch {}
  }

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_dramas_user_id ON dramas(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON episodes(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_image_generations_user_id ON image_generations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_video_generations_user_id ON video_generations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_video_merges_user_id ON video_merges(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_ai_service_configs_user_id ON ai_service_configs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_agent_configs_user_id ON agent_configs(user_id)',
    // 唯一索引：保障 copy-on-write 并发安全
    'CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_service_configs_user_type_provider ON ai_service_configs(user_id, service_type, provider)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_configs_user_type ON agent_configs(user_id, agent_type) WHERE deleted_at IS NULL',
  ]
  for (const sql of indexes) {
    try { await client.unsafe(sql) } catch {}
  }

  console.log('🐘 Connected to PostgreSQL')
} else {
  // SQLite mode — local development
  const Database = (await import('better-sqlite3')).default
  const { drizzle: drizzleSqlite } = await import('drizzle-orm/better-sqlite3')
  const sqliteSchema = await import('./schema.js')

  const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../../data/huobao_drama.db')
  const sqlite = new Database(DB_PATH, { timeout: 30000 })
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 30000')

  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dramas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style TEXT DEFAULT 'realistic',
    total_episodes INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    script_content TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INTEGER,
    video_config_id INTEGER,
    audio_config_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    personality TEXT,
    voice_style TEXT,
    image_url TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INTEGER,
    local_path TEXT,
    voice_sample_url TEXT,
    voice_provider TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_id INTEGER,
    location TEXT NOT NULL,
    time TEXT NOT NULL,
    prompt TEXT NOT NULL,
    storyboard_count INTEGER DEFAULT 1,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS storyboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER NOT NULL,
    title TEXT,
    location TEXT,
    time TEXT,
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    action TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    dialogue TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    tts_audio_url TEXT,
    subtitle_url TEXT,
    composed_video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episode_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episode_characters_episode_id
    ON episode_characters (episode_id);
  CREATE INDEX IF NOT EXISTS idx_episode_characters_character_id
    ON episode_characters (character_id);

  CREATE TABLE IF NOT EXISTS episode_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id
    ON episode_scenes (episode_id);
  CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id
    ON episode_scenes (scene_id);

  CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_storyboard_characters_storyboard_id
    ON storyboard_characters (storyboard_id);
  CREATE INDEX IF NOT EXISTS idx_storyboard_characters_character_id
    ON storyboard_characters (character_id);

  CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    settings TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voice_id TEXT NOT NULL UNIQUE,
    voice_name TEXT NOT NULL,
    description TEXT,
    language TEXT,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    model TEXT,
    system_prompt TEXT,
    temperature REAL,
    max_tokens INTEGER,
    max_iterations INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS image_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storyboard_id INTEGER,
    drama_id INTEGER,
    scene_id INTEGER,
    character_id INTEGER,
    prop_id INTEGER,
    image_type TEXT,
    frame_type TEXT,
    provider TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    model TEXT,
    size TEXT,
    quality TEXT,
    style TEXT,
    steps INTEGER,
    cfg_scale REAL,
    seed INTEGER,
    image_url TEXT,
    minio_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'pending',
    task_id TEXT,
    error_msg TEXT,
    width INTEGER,
    height INTEGER,
    reference_images TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storyboard_id INTEGER,
    drama_id INTEGER,
    provider TEXT,
    prompt TEXT,
    model TEXT,
    image_gen_id INTEGER,
    reference_mode TEXT,
    image_url TEXT,
    first_frame_url TEXT,
    last_frame_url TEXT,
    reference_image_urls TEXT,
    duration INTEGER,
    fps INTEGER,
    resolution TEXT,
    aspect_ratio TEXT,
    style TEXT,
    motion_level INTEGER,
    camera_motion TEXT,
    seed INTEGER,
    video_url TEXT,
    minio_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'pending',
    task_id TEXT,
    error_msg TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER,
    drama_id INTEGER,
    title TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INTEGER,
    task_id TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_id INTEGER,
    storyboard_id INTEGER,
    storyboard_num INTEGER,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    format TEXT,
    image_gen_id INTEGER,
    video_gen_id INTEGER,
    is_favorite INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
`)

  // ensureColumn helper for SQLite
  function ensureColumn(table: string, column: string, definition: string) {
    const tableExists = sqlite.prepare(
      `SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    ).get(table) as { ok: number } | undefined
    if (!tableExists) return
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(col => col.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  ensureColumn('episodes', 'image_config_id', 'INTEGER')
  ensureColumn('episodes', 'video_config_id', 'INTEGER')
  ensureColumn('episodes', 'audio_config_id', 'INTEGER')

  // --- User isolation columns ---
  const userIdTables = ['dramas', 'episodes', 'image_generations', 'video_generations', 'video_merges', 'assets', 'ai_service_configs', 'agent_configs']
  for (const table of userIdTables) {
    ensureColumn(table, 'user_id', "TEXT NOT NULL DEFAULT 'standalone'")
  }
  // Create indexes for user_id filtering
  for (const table of userIdTables) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`)
  }
  // 唯一索引：保障 copy-on-write 并发安全，防止同 user 重复 (service_type, provider) / (agent_type)
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_service_configs_user_type_provider
    ON ai_service_configs(user_id, service_type, provider)`)
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_configs_user_type
    ON agent_configs(user_id, agent_type) WHERE deleted_at IS NULL`)

  db = drizzleSqlite(sqlite, { schema: sqliteSchema })
  schema = sqliteSchema

  console.log('📦 Connected to SQLite')
}

export { db, schema }
export type DB = typeof db
