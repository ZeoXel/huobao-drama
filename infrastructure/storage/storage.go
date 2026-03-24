package storage

import (
	"context"
	"io"
)

// StorageService defines unified object storage operations for local/COS.
type StorageService interface {
	Save(ctx context.Context, key string, data []byte, contentType string) (string, error)
	SaveReader(ctx context.Context, key string, reader io.Reader, contentType string) (string, error)
	DownloadAndSave(ctx context.Context, remoteURL string, key string) (string, error)
	GetURL(ctx context.Context, key string) (string, error)
	GetLocalPath(ctx context.Context, key string) (localPath string, cleanup func(), err error)
	Delete(ctx context.Context, key string) error
}

