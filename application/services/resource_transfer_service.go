package services

import (
	"github.com/drama-generator/backend/pkg/logger"
	"gorm.io/gorm"
)

type ResourceTransferService struct {
	db  *gorm.DB
	log *logger.Logger
}

func NewResourceTransferService(db *gorm.DB, log *logger.Logger) *ResourceTransferService {
	return &ResourceTransferService{
		db:  db,
		log: log,
	}
}

// BatchTransferImagesToMinio is kept for backward compatibility.
// MinIO transfer has been removed, so this method is now a no-op.
func (s *ResourceTransferService) BatchTransferImagesToMinio(dramaID string, limit int) (int, error) {
	if s.log != nil {
		s.log.Warnw("BatchTransferImagesToMinio is disabled", "drama_id", dramaID, "limit", limit)
	}
	return 0, nil
}

// BatchTransferVideosToMinio is kept for backward compatibility.
// MinIO transfer has been removed, so this method is now a no-op.
func (s *ResourceTransferService) BatchTransferVideosToMinio(dramaID string, limit int) (int, error) {
	if s.log != nil {
		s.log.Warnw("BatchTransferVideosToMinio is disabled", "drama_id", dramaID, "limit", limit)
	}
	return 0, nil
}
