package storage

import (
	"fmt"
	"strings"

	"github.com/drama-generator/backend/pkg/config"
)

func NewStorageService(cfg *config.StorageConfig) (StorageService, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Type)) {
	case "", "local":
		return NewLocalStorage(cfg.LocalPath, cfg.BaseURL)
	case "cos":
		return NewCOSStorage(cfg)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", cfg.Type)
	}
}

