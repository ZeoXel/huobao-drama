package image

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type VolcEngineImageClient struct {
	BaseURL       string
	APIKey        string
	Model         string
	Endpoint      string
	QueryEndpoint string
	HTTPClient    *http.Client
}

type VolcEngineImageRequest struct {
	Model                     string   `json:"model"`
	Prompt                    string   `json:"prompt"`
	Image                     []string `json:"image,omitempty"`
	SequentialImageGeneration string   `json:"sequential_image_generation,omitempty"`
	Size                      string   `json:"size,omitempty"`
	Watermark                 bool     `json:"watermark,omitempty"`
}

type VolcEngineImageResponse struct {
	Model   string `json:"model"`
	Created int64  `json:"created"`
	Data    []struct {
		URL  string `json:"url"`
		Size string `json:"size"`
	} `json:"data"`
	Usage struct {
		GeneratedImages int `json:"generated_images"`
		OutputTokens    int `json:"output_tokens"`
		TotalTokens     int `json:"total_tokens"`
	} `json:"usage"`
	Error interface{} `json:"error,omitempty"`
}

func NewVolcEngineImageClient(baseURL, apiKey, model, endpoint, queryEndpoint string) *VolcEngineImageClient {
	if endpoint == "" {
		endpoint = "/api/v3/images/generations"
	}
	if queryEndpoint == "" {
		queryEndpoint = endpoint
	}
	return &VolcEngineImageClient{
		BaseURL:       baseURL,
		APIKey:        apiKey,
		Model:         model,
		Endpoint:      endpoint,
		QueryEndpoint: queryEndpoint,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Minute,
		},
	}
}

func (c *VolcEngineImageClient) GenerateImage(prompt string, opts ...ImageOption) (*ImageResult, error) {
	options := &ImageOptions{
		Size:    "1920x1920",
		Quality: "standard",
	}

	for _, opt := range opts {
		opt(options)
	}

	model := c.Model
	if options.Model != "" {
		model = options.Model
	}

	promptText := prompt
	if options.NegativePrompt != "" {
		promptText += fmt.Sprintf(". Negative: %s", options.NegativePrompt)
	}

	size := seedreamSizeForModel(model, options.Size)

	reqBody := VolcEngineImageRequest{
		Model:                     model,
		Prompt:                    promptText,
		Image:                     options.ReferenceImages,
		SequentialImageGeneration: "disabled",
		Size:                      size,
		Watermark:                 false,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.BaseURL + c.Endpoint
	fmt.Printf("[VolcEngine Image] Request URL: %s\n", url)
	fmt.Printf("[VolcEngine Image] Request Body: %s\n", string(jsonData))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	fmt.Printf("VolcEngine Image API Response: %s\n", string(body))

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result VolcEngineImageResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if result.Error != nil {
		return nil, fmt.Errorf("volcengine error: %v", result.Error)
	}

	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no image generated")
	}

	return &ImageResult{
		Status:    "completed",
		ImageURL:  result.Data[0].URL,
		Completed: true,
	}, nil
}

func (c *VolcEngineImageClient) GetTaskStatus(taskID string) (*ImageResult, error) {
	return nil, fmt.Errorf("not supported for VolcEngine Seedream (synchronous generation)")
}

// seedreamSizeForModel 根据模型名称返回合适的 size 参数
// seedream API 接受 "1K"/"2K"/"3K"/"4K" 格式，不接受像素尺寸如 "2560x1440"
func seedreamSizeForModel(model string, requestedSize string) string {
	// 如果已经是档位格式（1K/2K/3K/4K），直接使用
	if requestedSize == "1K" || requestedSize == "2K" || requestedSize == "3K" || requestedSize == "4K" {
		return requestedSize
	}

	// 根据模型选择默认档位
	switch {
	case strings.Contains(model, "seedream-5-0"):
		return "3K" // 5.0-lite 默认 3K 高分辨率
	case strings.Contains(model, "seedream-4-5"):
		return "2K" // 4.5 默认 2K
	case strings.Contains(model, "seedream-3-0"):
		return "1K" // 3.0 系列默认 1K
	default:
		return "2K"
	}
}
