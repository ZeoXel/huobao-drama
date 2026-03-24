package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type LocalStorage struct {
	basePath string
	baseURL  string
}

func NewLocalStorage(basePath, baseURL string) (*LocalStorage, error) {
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	return &LocalStorage{
		basePath: basePath,
		baseURL:  baseURL,
	}, nil
}

func (s *LocalStorage) Save(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	return s.SaveReader(ctx, key, bytes.NewReader(data), contentType)
}

func (s *LocalStorage) SaveReader(ctx context.Context, key string, reader io.Reader, contentType string) (string, error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", fmt.Errorf("empty storage key")
	}
	absPath := filepath.Join(s.basePath, filepath.FromSlash(cleanKey))
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return "", fmt.Errorf("failed to create key directory: %w", err)
	}
	dst, err := os.Create(absPath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %w", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, reader); err != nil {
		return "", fmt.Errorf("failed to save file: %w", err)
	}
	return s.GetURL(ctx, cleanKey)
}

func (s *LocalStorage) DownloadAndSave(ctx context.Context, remoteURL string, key string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download file: HTTP %d", resp.StatusCode)
	}
	return s.SaveReader(ctx, key, resp.Body, resp.Header.Get("Content-Type"))
}

func (s *LocalStorage) GetURL(ctx context.Context, key string) (string, error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", fmt.Errorf("empty storage key")
	}
	return fmt.Sprintf("%s/%s", strings.TrimRight(s.baseURL, "/"), cleanKey), nil
}

func (s *LocalStorage) GetLocalPath(ctx context.Context, key string) (string, func(), error) {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return "", nil, fmt.Errorf("empty storage key")
	}
	localPath := filepath.Join(s.basePath, filepath.FromSlash(cleanKey))
	return localPath, func() {}, nil
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	cleanKey := strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
	if cleanKey == "" {
		return fmt.Errorf("empty storage key")
	}
	return os.Remove(filepath.Join(s.basePath, filepath.FromSlash(cleanKey)))
}

func (s *LocalStorage) Upload(file io.Reader, filename string, category string) (string, error) {
	dir := filepath.Join(s.basePath, category)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create category directory: %w", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	newFilename := fmt.Sprintf("%s_%s", timestamp, filename)
	filePath := filepath.Join(dir, newFilename)

	dst, err := os.Create(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return "", fmt.Errorf("failed to save file: %w", err)
	}

	url := fmt.Sprintf("%s/%s/%s", s.baseURL, category, newFilename)
	return url, nil
}

func (s *LocalStorage) DeleteLegacy(url string) error {
	return nil
}

// DownloadResult 下载结果，包含URL和相对路径
type DownloadResult struct {
	URL          string // 完整的访问URL
	RelativePath string // 相对于basePath的路径，用于保存到数据库
	AbsolutePath string // 绝对文件路径
}

// DownloadFromURL 从远程URL下载文件到本地存储
func (s *LocalStorage) DownloadFromURL(url, category string) (string, error) {
	result, err := s.DownloadFromURLWithPath(url, category)
	if err != nil {
		return "", err
	}
	return result.URL, nil
}

// DownloadFromURLWithPath 从远程URL下载文件到本地存储，返回详细信息
func (s *LocalStorage) DownloadFromURLWithPath(url, category string) (*DownloadResult, error) {
	// CRITICAL FIX: Add HTTP client with timeout to prevent hanging indefinitely
	// Without timeout, the download can hang forever if the remote server is unresponsive
	// 5 minute timeout is reasonable for large video/image files
	client := &http.Client{
		Timeout: 5 * time.Minute,
	}
	// 发送HTTP请求下载文件
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download file: HTTP %d", resp.StatusCode)
	}

	// 从URL或Content-Type推断文件扩展名
	ext := getFileExtension(url, resp.Header.Get("Content-Type"))

	// 创建目录
	dir := filepath.Join(s.basePath, category)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create category directory: %w", err)
	}

	// 生成唯一文件名（时间戳 + UUID 前8位）
	timestamp := time.Now().Format("20060102_150405")
	uniqueID := uuid.New().String()[:8]
	filename := fmt.Sprintf("%s_%s%s", timestamp, uniqueID, ext)
	filePath := filepath.Join(dir, filename)

	// 保存文件
	dst, err := os.Create(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create file: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, resp.Body); err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	// 返回详细信息
	relativePath := filepath.Join(category, filename)
	localURL := fmt.Sprintf("%s/%s/%s", s.baseURL, category, filename)
	
	return &DownloadResult{
		URL:          localURL,
		RelativePath: relativePath,
		AbsolutePath: filePath,
	}, nil
}

// GetAbsolutePath 根据相对路径获取绝对路径
func (s *LocalStorage) GetAbsolutePath(relativePath string) string {
	return filepath.Join(s.basePath, relativePath)
}

// getFileExtension 从URL或Content-Type推断文件扩展名
func getFileExtension(url, contentType string) string {
	// 首先尝试从URL获取扩展名
	if idx := strings.LastIndex(url, "."); idx != -1 {
		ext := url[idx:]
		// 只取扩展名部分，忽略查询参数
		if qIdx := strings.Index(ext, "?"); qIdx != -1 {
			ext = ext[:qIdx]
		}
		if len(ext) <= 5 { // 合理的扩展名长度
			return ext
		}
	}

	// 根据Content-Type推断扩展名
	switch {
	case strings.Contains(contentType, "image/jpeg"):
		return ".jpg"
	case strings.Contains(contentType, "image/png"):
		return ".png"
	case strings.Contains(contentType, "image/gif"):
		return ".gif"
	case strings.Contains(contentType, "image/webp"):
		return ".webp"
	case strings.Contains(contentType, "video/mp4"):
		return ".mp4"
	case strings.Contains(contentType, "video/webm"):
		return ".webm"
	case strings.Contains(contentType, "video/quicktime"):
		return ".mov"
	default:
		return ".bin"
	}
}
