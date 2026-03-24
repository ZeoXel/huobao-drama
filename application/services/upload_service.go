package services

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/drama-generator/backend/infrastructure/storage"
	"github.com/drama-generator/backend/pkg/config"
	"github.com/drama-generator/backend/pkg/logger"
	"github.com/google/uuid"
)

type UploadService struct {
	baseURL        string
	storageService storage.StorageService
	log            *logger.Logger
}

func NewUploadService(cfg *config.Config, storageService storage.StorageService, log *logger.Logger) (*UploadService, error) {
	if storageService == nil {
		return nil, fmt.Errorf("storage service is required")
	}

	return &UploadService{
		baseURL:        cfg.Storage.BaseURL,
		storageService: storageService,
		log:            log,
	}, nil
}

// UploadResult 上传结果
type UploadResult struct {
	URL       string // 完整访问URL
	LocalPath string // 相对路径（相对于 storage 根目录）
}

// UploadFile 上传文件到统一对象存储
func (s *UploadService) UploadFile(file io.Reader, fileName, contentType string, category string) (*UploadResult, error) {
	// 生成唯一文件名
	ext := filepath.Ext(fileName)
	if ext == "" {
		ext = ".bin"
	}
	uniqueID := uuid.New().String()
	timestamp := time.Now().Format("20060102_150405")
	newFileName := fmt.Sprintf("%s_%s%s", timestamp, uniqueID, ext)
	objectKey := filepath.ToSlash(filepath.Join(category, newFileName))
	fileURL, err := s.storageService.SaveReader(context.Background(), objectKey, file, contentType)
	if err != nil {
		s.log.Errorw("Failed to upload file", "error", err, "object_key", objectKey)
		return nil, fmt.Errorf("上传文件失败: %w", err)
	}

	s.log.Infow("File uploaded successfully", "url", fileURL, "local_path", objectKey)
	return &UploadResult{
		URL:       fileURL,
		LocalPath: objectKey,
	}, nil
}

// UploadCharacterImage 上传角色图片
func (s *UploadService) UploadCharacterImage(file io.Reader, fileName, contentType string) (*UploadResult, error) {
	return s.UploadFile(file, fileName, contentType, "characters")
}

// DeleteFile 删除文件
func (s *UploadService) DeleteFile(fileURL string) error {
	objectKey := s.extractObjectKey(fileURL)
	if objectKey == "" {
		return fmt.Errorf("invalid file URL")
	}

	err := s.storageService.Delete(context.Background(), objectKey)
	if err != nil {
		s.log.Errorw("Failed to delete file", "error", err, "object_key", objectKey)
		return fmt.Errorf("删除文件失败: %w", err)
	}

	s.log.Infow("File deleted successfully", "object_key", objectKey)
	return nil
}

// extractObjectKey 从 URL 或对象路径中提取 object key
func (s *UploadService) extractObjectKey(fileURL string) string {
	trimmed := strings.TrimSpace(fileURL)
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
		return strings.Trim(trimmed, "/")
	}
	base := strings.TrimRight(strings.TrimSpace(s.baseURL), "/")
	if base != "" && strings.HasPrefix(trimmed, base+"/") {
		return strings.TrimPrefix(trimmed, base+"/")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	return strings.Trim(parsed.Path, "/")
}

// GetPresignedURL 返回可访问 URL（COS 模式为签名 URL，本地模式为静态 URL）
func (s *UploadService) GetPresignedURL(objectName string, expiry time.Duration) (string, error) {
	_ = expiry
	return s.storageService.GetURL(context.Background(), objectName)
}
