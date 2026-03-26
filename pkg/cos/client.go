package cos

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/drama-generator/backend/pkg/config"
	coslib "github.com/tencentyun/cos-go-sdk-v5"
)

func NewClient(cfg *config.StorageConfig) (*coslib.Client, error) {
	if strings.TrimSpace(cfg.COSBucket) == "" || strings.TrimSpace(cfg.COSRegion) == "" {
		return nil, fmt.Errorf("cos bucket/region not configured")
	}

	// API 操作必须使用真实的 COS Bucket URL，不能用 CDN/自定义域名
	bucketURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", strings.TrimSpace(cfg.COSBucket), strings.TrimSpace(cfg.COSRegion))

	u, err := url.Parse(bucketURL)
	if err != nil {
		return nil, fmt.Errorf("invalid cos bucket url: %w", err)
	}

	return coslib.NewClient(
		&coslib.BaseURL{BucketURL: u},
		&http.Client{
			Transport: &coslib.AuthorizationTransport{
				SecretID:  strings.TrimSpace(cfg.COSSecretID),
				SecretKey: strings.TrimSpace(cfg.COSSecretKey),
			},
		},
	), nil
}

// PublicURL 返回配置的公开访问 URL（CDN 域名），如果未配置则返回空字符串
func PublicURL(cfg *config.StorageConfig) string {
	return strings.TrimRight(strings.TrimSpace(cfg.COSPublicURL), "/")
}

