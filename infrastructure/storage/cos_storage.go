package storage

import (
	"bytes"
	"context"
	"crypto/sha1"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/drama-generator/backend/pkg/config"
	cospkg "github.com/drama-generator/backend/pkg/cos"
	coslib "github.com/tencentyun/cos-go-sdk-v5"
)

type COSStorage struct {
	client    *coslib.Client
	localPath string
	publicURL string // CDN/自定义域名，用于生成访问 URL
}

func NewCOSStorage(cfg *config.StorageConfig) (*COSStorage, error) {
	client, err := cospkg.NewClient(cfg)
	if err != nil {
		return nil, err
	}
	localPath := strings.TrimSpace(cfg.LocalPath)
	if localPath == "" {
		localPath = filepath.Join(os.TempDir(), "drama-storage-cache")
	}
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create local cache dir: %w", err)
	}
	return &COSStorage{
		client:    client,
		localPath: localPath,
		publicURL: cospkg.PublicURL(cfg),
	}, nil
}

func (s *COSStorage) Save(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	return s.SaveReader(ctx, key, bytes.NewReader(data), contentType)
}

func (s *COSStorage) SaveReader(ctx context.Context, key string, reader io.Reader, contentType string) (string, error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", fmt.Errorf("empty storage key")
	}
	_, err := s.client.Object.Put(ctx, cleanKey, reader, &coslib.ObjectPutOptions{
		ObjectPutHeaderOptions: &coslib.ObjectPutHeaderOptions{ContentType: contentType},
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload to cos: %w", err)
	}
	return s.GetURL(ctx, cleanKey)
}

func (s *COSStorage) DownloadAndSave(ctx context.Context, remoteURL string, key string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to download remote resource: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download remote resource: HTTP %d", resp.StatusCode)
	}
	return s.SaveReader(ctx, key, resp.Body, resp.Header.Get("Content-Type"))
}

func (s *COSStorage) GetURL(ctx context.Context, key string) (string, error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", fmt.Errorf("empty storage key")
	}
	// 如果配置了 CDN/自定义域名，直接拼接公开访问 URL
	if s.publicURL != "" {
		return fmt.Sprintf("%s/%s", s.publicURL, cleanKey), nil
	}
	// 否则生成签名 URL
	presigned, err := s.client.Object.GetPresignedURL(ctx, http.MethodGet, cleanKey, "", "", time.Hour, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create cos signed url: %w", err)
	}
	return presigned.String(), nil
}

func (s *COSStorage) GetLocalPath(ctx context.Context, key string) (string, func(), error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", nil, fmt.Errorf("empty storage key")
	}
	hash := fmt.Sprintf("%x", sha1.Sum([]byte(cleanKey)))
	localPath := filepath.Join(s.localPath, "cos-cache-"+hash)
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return "", nil, err
	}
	resp, err := s.client.Object.Get(ctx, cleanKey, nil)
	if err != nil {
		return "", nil, fmt.Errorf("failed to download cos object: %w", err)
	}
	defer resp.Body.Close()
	file, err := os.Create(localPath)
	if err != nil {
		return "", nil, err
	}
	if _, err := io.Copy(file, resp.Body); err != nil {
		file.Close()
		return "", nil, err
	}
	if err := file.Close(); err != nil {
		return "", nil, err
	}
	return localPath, func() { _ = os.Remove(localPath) }, nil
}

func (s *COSStorage) Delete(ctx context.Context, key string) error {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return fmt.Errorf("empty storage key")
	}
	_, err := s.client.Object.Delete(ctx, cleanKey)
	return err
}
