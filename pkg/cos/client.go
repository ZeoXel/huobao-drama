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

	baseURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", strings.TrimSpace(cfg.COSBucket), strings.TrimSpace(cfg.COSRegion))
	if strings.TrimSpace(cfg.COSPublicURL) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(cfg.COSPublicURL), "/")
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid cos base url: %w", err)
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

