package database

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/drama-generator/backend/domain/models"
	"github.com/drama-generator/backend/pkg/config"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func NewDatabase(cfg config.DatabaseConfig) (*gorm.DB, error) {
	dsn := cfg.DSN()

	if cfg.Type == "sqlite" {
		dbDir := filepath.Dir(dsn)
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create database directory: %w", err)
		}
	}

	gormConfig := &gorm.Config{
		Logger: NewCustomLogger(),
	}

	var db *gorm.DB
	var err error

	switch cfg.Type {
	case "sqlite":
		// 使用 modernc.org/sqlite 纯 Go 驱动（无需 CGO）
		dsnWithParams := dsn + "?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&cache=shared"
		db, err = gorm.Open(sqlite.Dialector{
			DriverName: "sqlite",
			DSN:        dsnWithParams,
		}, gormConfig)
	case "postgres":
		db, err = gorm.Open(postgres.Open(dsn), gormConfig)
	default:
		db, err = gorm.Open(mysql.Open(dsn), gormConfig)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	// 连接池配置
	if cfg.Type == "sqlite" {
		sqlDB.SetMaxIdleConns(1)
		sqlDB.SetMaxOpenConns(1) // SQLite 单写入，限制为 1
	} else {
		maxIdle := cfg.MaxIdle
		if maxIdle <= 0 {
			maxIdle = 5
		}
		maxOpen := cfg.MaxOpen
		if maxOpen <= 0 {
			maxOpen = 20
		}
		sqlDB.SetMaxIdleConns(maxIdle)
		sqlDB.SetMaxOpenConns(maxOpen)
	}
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		// 核心模型
		&models.Drama{},
		&models.Episode{},
		&models.Character{},
		&models.Scene{},
		&models.Storyboard{},
		&models.FramePrompt{},
		&models.Prop{},

		// 生成相关
		&models.ImageGeneration{},
		&models.VideoGeneration{},
		&models.VideoMerge{},

		// AI配置
		&models.AIServiceConfig{},
		&models.AIServiceProvider{},

		// 资源管理
		&models.Asset{},
		&models.CharacterLibrary{},

		// 任务管理
		&models.AsyncTask{},
	); err != nil {
		return err
	}

	return backfillUserIDs(db)
}

func backfillUserIDs(db *gorm.DB) error {
	tables := []string{
		"dramas",
		"character_libraries",
		"image_generations",
		"video_generations",
		"video_merges",
		"assets",
	}

	for _, table := range tables {
		if err := db.Table(table).
			Where("user_id IS NULL OR user_id = ''").
			Update("user_id", "standalone").Error; err != nil {
			return fmt.Errorf("failed to backfill user_id for %s: %w", table, err)
		}
	}

	return nil
}

// InitDefaultAIConfigs 初始化默认 AI 配置（从环境变量读取）
func InitDefaultAIConfigs(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.AIServiceConfig{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	openaiKey := os.Getenv("OPENAI_API_KEY")
	geminiKey := os.Getenv("GEMINI_API_KEY")
	chatfireKey := os.Getenv("CHATFIRE_API_KEY")
	volcesKey := os.Getenv("VOLCES_API_KEY")

	if openaiKey == "" && geminiKey == "" && chatfireKey == "" && volcesKey == "" {
		return nil
	}

	configs := []models.AIServiceConfig{}

	// 文本生成 - Gemini
	if geminiKey != "" {
		configs = append(configs, models.AIServiceConfig{
			ServiceType: "text",
			Provider:    "gemini",
			Name:        "Google Gemini",
			BaseURL:     getEnv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
			APIKey:      geminiKey,
			Model:       models.ModelField{"gemini-3-flash-preview", "gemini-2.5-pro"},
			Endpoint:    "/models/gemini-3-flash-preview:generateContent",
			Priority:    1,
			IsDefault:   true,
			IsActive:    true,
		})
	}

	// 图片生成 - Chatfire (nano-banana-pro)
	if chatfireKey != "" {
		configs = append(configs, models.AIServiceConfig{
			ServiceType: "image",
			Provider:    "chatfire",
			Name:        "Chatfire Image",
			BaseURL:     getEnv("CHATFIRE_BASE_URL", "https://api.chatfire.site/v1"),
			APIKey:      chatfireKey,
			Model:       models.ModelField{"nano-banana-pro"},
			Endpoint:    "/images/generations",
			Priority:    1,
			IsDefault:   true,
			IsActive:    true,
		})
	}

	// 视频生成 - 火山引擎 (seedance-1.5-pro)
	if volcesKey != "" {
		configs = append(configs, models.AIServiceConfig{
			ServiceType:   "video",
			Provider:      "volces",
			Name:          "火山引擎视频",
			BaseURL:       getEnv("VOLCES_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
			APIKey:        volcesKey,
			Model:         models.ModelField{"doubao-seedance-1-5-pro-251215"},
			Endpoint:      "/video/submit",
			QueryEndpoint: "/video/query",
			Priority:      1,
			IsDefault:     true,
			IsActive:      true,
		})
	}
	if len(configs) > 0 {
		return db.Create(&configs).Error
	}
	return nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
