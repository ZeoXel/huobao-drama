package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App      AppConfig      `mapstructure:"app"`
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Storage  StorageConfig  `mapstructure:"storage"`
	AI       AIConfig       `mapstructure:"ai"`
	Auth     AuthConfig     `mapstructure:"auth"`
}

type AppConfig struct {
	Name     string `mapstructure:"name"`
	Version  string `mapstructure:"version"`
	Debug    bool   `mapstructure:"debug"`
	Language string `mapstructure:"language"` // zh 或 en
}

type ServerConfig struct {
	Port         int      `mapstructure:"port"`
	Host         string   `mapstructure:"host"`
	CORSOrigins  []string `mapstructure:"cors_origins"`
	ReadTimeout  int      `mapstructure:"read_timeout"`
	WriteTimeout int      `mapstructure:"write_timeout"`
}

type DatabaseConfig struct {
	Type     string `mapstructure:"type"` // sqlite, mysql, postgres
	Path     string `mapstructure:"path"` // SQLite数据库文件路径
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Database string `mapstructure:"database"`
	Charset  string `mapstructure:"charset"`
	SSLMode  string `mapstructure:"sslmode"` // Postgres SSL 模式
	MaxIdle  int    `mapstructure:"max_idle"`
	MaxOpen  int    `mapstructure:"max_open"`
}

type StorageConfig struct {
	Type       string `mapstructure:"type"`        // local, cos
	LocalPath  string `mapstructure:"local_path"`  // 本地存储路径
	BaseURL    string `mapstructure:"base_url"`    // 访问URL前缀
	COSSecretID  string `mapstructure:"cos_secret_id"`
	COSSecretKey string `mapstructure:"cos_secret_key"`
	COSBucket    string `mapstructure:"cos_bucket"`
	COSRegion    string `mapstructure:"cos_region"`
	COSPublicURL string `mapstructure:"cos_public_url"`
}

type AIConfig struct {
	DefaultTextProvider  string `mapstructure:"default_text_provider"`
	DefaultImageProvider string `mapstructure:"default_image_provider"`
	DefaultVideoProvider string `mapstructure:"default_video_provider"`
}

type AuthConfig struct {
	NextAuthSecret string `mapstructure:"nextauth_secret"`
}

func LoadConfig() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath(".")

	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// 显式绑定嵌套配置的环境变量（Unmarshal 不会自动触发 AutomaticEnv 查找）
	// Database
	viper.BindEnv("database.type", "DATABASE_TYPE")
	viper.BindEnv("database.host", "DATABASE_HOST")
	viper.BindEnv("database.port", "DATABASE_PORT")
	viper.BindEnv("database.user", "DATABASE_USER")
	viper.BindEnv("database.password", "DATABASE_PASSWORD")
	viper.BindEnv("database.database", "DATABASE_NAME")
	viper.BindEnv("database.sslmode", "DATABASE_SSLMODE")
	viper.BindEnv("database.max_idle", "DATABASE_MAX_IDLE")
	viper.BindEnv("database.max_open", "DATABASE_MAX_OPEN")
	// Storage
	viper.BindEnv("storage.type", "STORAGE_TYPE")
	viper.BindEnv("storage.cos_secret_id", "COS_SECRET_ID")
	viper.BindEnv("storage.cos_secret_key", "COS_SECRET_KEY")
	viper.BindEnv("storage.cos_bucket", "COS_BUCKET")
	viper.BindEnv("storage.cos_region", "COS_REGION")
	viper.BindEnv("storage.cos_public_url", "COS_PUBLIC_URL")
	// Server
	viper.BindEnv("server.port", "SERVER_PORT")
	// Auth
	viper.BindEnv("auth.nextauth_secret", "NEXTAUTH_SECRET")
	// App
	viper.BindEnv("app.debug", "APP_DEBUG")
	// AI Gateway
	viper.BindEnv("ai.gateway_url", "GATEWAY_URL")
	// CORS
	viper.BindEnv("server.studio_origin", "STUDIO_ORIGIN")

	if err := viper.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &config, nil
}

func (c *DatabaseConfig) DSN() string {
	if c.Type == "sqlite" {
		return c.Path
	}
	if c.Type == "postgres" {
		sslmode := c.SSLMode
		if sslmode == "" {
			sslmode = "require"
		}
		return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
			c.Host, c.Port, c.User, c.Password, c.Database, sslmode)
	}
	// MySQL DSN
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=True&loc=Local",
		c.User,
		c.Password,
		c.Host,
		c.Port,
		c.Database,
		c.Charset,
	)
}
