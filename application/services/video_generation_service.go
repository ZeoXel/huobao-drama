package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	models "github.com/drama-generator/backend/domain/models"
	"github.com/drama-generator/backend/infrastructure/external/ffmpeg"
	"github.com/drama-generator/backend/infrastructure/storage"
	cospkg "github.com/drama-generator/backend/pkg/cos"
	"github.com/drama-generator/backend/pkg/logger"
	"github.com/drama-generator/backend/pkg/utils"
	"github.com/drama-generator/backend/pkg/video"
	"gorm.io/gorm"
)

type VideoGenerationService struct {
	db              *gorm.DB
	transferService *ResourceTransferService
	log             *logger.Logger
	localStorage    *storage.LocalStorage
	storageService  storage.StorageService
	aiService       *AIService
	ffmpeg          *ffmpeg.FFmpeg
	promptI18n      *PromptI18n
}

func NewVideoGenerationService(db *gorm.DB, transferService *ResourceTransferService, localStorage *storage.LocalStorage, storageService storage.StorageService, aiService *AIService, log *logger.Logger, promptI18n *PromptI18n) *VideoGenerationService {
	service := &VideoGenerationService{
		db:              db,
		localStorage:    localStorage,
		storageService:  storageService,
		transferService: transferService,
		aiService:       aiService,
		log:             log,
		ffmpeg:          ffmpeg.NewFFmpeg(log),
		promptI18n:      promptI18n,
	}

	go service.RecoverPendingTasks()

	return service
}

type GenerateVideoRequest struct {
	StoryboardID *uint  `json:"storyboard_id"`
	DramaID      string `json:"drama_id" binding:"required"`
	ImageGenID   *uint  `json:"image_gen_id"`

	// 参考图模式：single, first_last, multiple, none
	ReferenceMode string `json:"reference_mode"`

	// 单图模式
	ImageURL       string  `json:"image_url"`
	ImageLocalPath *string `json:"image_local_path"` // 单图模式的本地路径

	// 首尾帧模式
	FirstFrameURL       *string `json:"first_frame_url"`
	FirstFrameLocalPath *string `json:"first_frame_local_path"` // 首帧本地路径
	LastFrameURL        *string `json:"last_frame_url"`
	LastFrameLocalPath  *string `json:"last_frame_local_path"` // 尾帧本地路径

	// 多图模式
	ReferenceImageURLs []string `json:"reference_image_urls"`

	Prompt       string  `json:"prompt" binding:"required,min=5,max=2000"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Duration     *int    `json:"duration"`
	FPS          *int    `json:"fps"`
	AspectRatio  *string `json:"aspect_ratio"`
	Style        *string `json:"style"`
	MotionLevel  *int    `json:"motion_level"`
	CameraMotion *string `json:"camera_motion"`
	Seed         *int64  `json:"seed"`
}

func (s *VideoGenerationService) GenerateVideo(userID string, apiKey string, request *GenerateVideoRequest) (*models.VideoGeneration, error) {
	userID = normalizeUserID(userID)
	if request.StoryboardID != nil {
		var storyboard models.Storyboard
		if err := s.db.Preload("Episode").
			Joins("JOIN episodes ON episodes.id = storyboards.episode_id").
			Joins("JOIN dramas ON dramas.id = episodes.drama_id").
			Where("storyboards.id = ? AND dramas.user_id = ?", *request.StoryboardID, userID).
			First(&storyboard).Error; err != nil {
			return nil, fmt.Errorf("storyboard not found")
		}
		if fmt.Sprintf("%d", storyboard.Episode.DramaID) != request.DramaID {
			return nil, fmt.Errorf("storyboard does not belong to drama")
		}
	}

	if request.ImageGenID != nil {
		var imageGen models.ImageGeneration
		if err := s.db.Where("id = ? AND user_id = ?", *request.ImageGenID, userID).First(&imageGen).Error; err != nil {
			return nil, fmt.Errorf("image generation not found")
		}
	}

	var drama models.Drama
	if err := s.db.Where("id = ? AND user_id = ?", request.DramaID, userID).First(&drama).Error; err != nil {
		return nil, fmt.Errorf("drama not found")
	}

	provider := request.Provider
	if provider == "" {
		provider = "doubao"
	}

	dramaID, _ := strconv.ParseUint(request.DramaID, 10, 32)

	videoGen := &models.VideoGeneration{
		UserID:       userID,
		StoryboardID: request.StoryboardID,
		DramaID:      uint(dramaID),
		ImageGenID:   request.ImageGenID,
		Provider:     provider,
		Prompt:       request.Prompt,
		Model:        request.Model,
		Duration:     request.Duration,
		FPS:          request.FPS,
		AspectRatio:  request.AspectRatio,
		Style:        request.Style,
		MotionLevel:  request.MotionLevel,
		CameraMotion: request.CameraMotion,
		Seed:         request.Seed,
		Status:       models.VideoStatusPending,
	}

	// 根据参考图模式处理不同的参数
	if request.ReferenceMode != "" {
		videoGen.ReferenceMode = &request.ReferenceMode
	}

	switch request.ReferenceMode {
	case "single":
		// 单图模式 - 优先使用 local_path
		if request.ImageLocalPath != nil && *request.ImageLocalPath != "" {
			videoGen.ImageURL = request.ImageLocalPath
		} else if request.ImageURL != "" {
			videoGen.ImageURL = &request.ImageURL
		}
	case "first_last":
		// 首尾帧模式 - 优先使用 local_path
		if request.FirstFrameLocalPath != nil && *request.FirstFrameLocalPath != "" {
			videoGen.FirstFrameURL = request.FirstFrameLocalPath
		} else if request.FirstFrameURL != nil {
			videoGen.FirstFrameURL = request.FirstFrameURL
		}
		if request.LastFrameLocalPath != nil && *request.LastFrameLocalPath != "" {
			videoGen.LastFrameURL = request.LastFrameLocalPath
		} else if request.LastFrameURL != nil {
			videoGen.LastFrameURL = request.LastFrameURL
		}
	case "multiple":
		// 多图模式
		if len(request.ReferenceImageURLs) > 0 {
			referenceImagesJSON, err := json.Marshal(request.ReferenceImageURLs)
			if err == nil {
				referenceImagesStr := string(referenceImagesJSON)
				videoGen.ReferenceImageURLs = &referenceImagesStr
			}
		}
	case "none":
		// 无参考图，纯文本生成
	default:
		// 向后兼容：如果没有指定模式，根据提供的参数自动判断
		if request.ImageURL != "" {
			videoGen.ImageURL = &request.ImageURL
			mode := "single"
			videoGen.ReferenceMode = &mode
		} else if request.FirstFrameURL != nil || request.LastFrameURL != nil {
			videoGen.FirstFrameURL = request.FirstFrameURL
			videoGen.LastFrameURL = request.LastFrameURL
			mode := "first_last"
			videoGen.ReferenceMode = &mode
		} else if len(request.ReferenceImageURLs) > 0 {
			referenceImagesJSON, err := json.Marshal(request.ReferenceImageURLs)
			if err == nil {
				referenceImagesStr := string(referenceImagesJSON)
				videoGen.ReferenceImageURLs = &referenceImagesStr
				mode := "multiple"
				videoGen.ReferenceMode = &mode
			}
		}
	}

	if err := s.db.Create(videoGen).Error; err != nil {
		return nil, fmt.Errorf("failed to create record: %w", err)
	}

	// Start background goroutine to process video generation asynchronously
	// This allows the API to return immediately while video generation happens in background
	// CRITICAL: The goroutine will handle all video generation logic including API calls and polling
	go s.ProcessVideoGeneration(videoGen.ID, apiKey)

	return videoGen, nil
}

func (s *VideoGenerationService) ProcessVideoGeneration(videoGenID uint, apiKey string) {
	var videoGen models.VideoGeneration
	if err := s.db.First(&videoGen, videoGenID).Error; err != nil {
		s.log.Errorw("Failed to load video generation", "error", err, "id", videoGenID)
		return
	}

	// 获取drama的style信息
	var drama models.Drama
	if err := s.db.First(&drama, videoGen.DramaID).Error; err != nil {
		s.log.Warnw("Failed to load drama for style", "error", err, "drama_id", videoGen.DramaID)
	}

	s.db.Model(&videoGen).Update("status", models.VideoStatusProcessing)

	client, err := s.getVideoClient(videoGen.Provider, videoGen.Model, apiKey)
	if err != nil {
		s.log.Errorw("Failed to get video client", "error", err, "provider", videoGen.Provider, "model", videoGen.Model)
		s.updateVideoGenError(videoGenID, err.Error())
		return
	}

	s.log.Infow("Starting video generation", "id", videoGenID, "prompt", videoGen.Prompt, "provider", videoGen.Provider)

	var opts []video.VideoOption
	if videoGen.Model != "" {
		opts = append(opts, video.WithModel(videoGen.Model))
	}
	if videoGen.Duration != nil {
		opts = append(opts, video.WithDuration(*videoGen.Duration))
	}
	if videoGen.FPS != nil {
		opts = append(opts, video.WithFPS(*videoGen.FPS))
	}
	if videoGen.AspectRatio != nil {
		opts = append(opts, video.WithAspectRatio(*videoGen.AspectRatio))
	}
	if videoGen.Style != nil {
		opts = append(opts, video.WithStyle(*videoGen.Style))
	}
	if videoGen.MotionLevel != nil {
		opts = append(opts, video.WithMotionLevel(*videoGen.MotionLevel))
	}
	if videoGen.CameraMotion != nil {
		opts = append(opts, video.WithCameraMotion(*videoGen.CameraMotion))
	}
	if videoGen.Seed != nil {
		opts = append(opts, video.WithSeed(*videoGen.Seed))
	}

	// 根据参考图模式添加相应的选项，并将本地图片转换为base64
	if videoGen.ReferenceMode != nil {
		switch *videoGen.ReferenceMode {
		case "first_last":
			// 首尾帧模式 - 转换本地图片为base64
			if videoGen.FirstFrameURL != nil {
				firstFrameBase64, err := s.convertImageToBase64(*videoGen.FirstFrameURL)
				if err != nil {
					s.log.Warnw("Failed to convert first frame to base64, using original URL", "error", err)
					opts = append(opts, video.WithFirstFrame(*videoGen.FirstFrameURL))
				} else {
					opts = append(opts, video.WithFirstFrame(firstFrameBase64))
				}
			}
			if videoGen.LastFrameURL != nil {
				lastFrameBase64, err := s.convertImageToBase64(*videoGen.LastFrameURL)
				if err != nil {
					s.log.Warnw("Failed to convert last frame to base64, using original URL", "error", err)
					opts = append(opts, video.WithLastFrame(*videoGen.LastFrameURL))
				} else {
					opts = append(opts, video.WithLastFrame(lastFrameBase64))
				}
			}
		case "multiple":
			// 多图模式 - 转换本地图片为base64
			if videoGen.ReferenceImageURLs != nil {
				var imageURLs []string
				if err := json.Unmarshal([]byte(*videoGen.ReferenceImageURLs), &imageURLs); err == nil {
					var base64Images []string
					for _, imgURL := range imageURLs {
						base64Img, err := s.convertImageToBase64(imgURL)
						if err != nil {
							s.log.Warnw("Failed to convert reference image to base64, using original URL", "error", err, "url", imgURL)
							base64Images = append(base64Images, imgURL)
						} else {
							base64Images = append(base64Images, base64Img)
						}
					}
					opts = append(opts, video.WithReferenceImages(base64Images))
				}
			}
		}
	}

	// 构造imageURL参数（单图模式使用，其他模式传空字符串）
	// 如果是本地图片，转换为base64
	imageURL := ""
	if videoGen.ImageURL != nil {
		base64Image, err := s.convertImageToBase64(*videoGen.ImageURL)
		if err != nil {
			s.log.Warnw("Failed to convert image to base64, using original URL", "error", err)
			imageURL = *videoGen.ImageURL
		} else {
			imageURL = base64Image
		}
	}

	// 构建完整的提示词：风格提示词 + 约束提示词 + 用户提示词
	prompt := videoGen.Prompt

	// 2. 添加视频约束提示词
	// 根据参考图模式选择对应的约束提示词
	referenceMode := "single" // 默认单图模式
	if videoGen.ReferenceMode != nil {
		referenceMode = *videoGen.ReferenceMode
	}

	// 如果是单图模式，需要检查图片是否为动作序列图
	if referenceMode == "single" && videoGen.ImageGenID != nil {
		var imageGen models.ImageGeneration
		if err := s.db.First(&imageGen, *videoGen.ImageGenID).Error; err == nil {
			// 如果图片的frame_type是action，使用动作序列约束提示词
			if imageGen.FrameType != nil && *imageGen.FrameType == "action" {
				referenceMode = "action_sequence"
				s.log.Infow("Detected action sequence image in single mode",
					"id", videoGenID,
					"image_gen_id", *videoGen.ImageGenID,
					"frame_type", *imageGen.FrameType)
			}
		}
	}

	constraintPrompt := s.promptI18n.GetVideoConstraintPrompt(referenceMode)
	if constraintPrompt != "" {
		prompt = constraintPrompt + "\n\n" + prompt
		s.log.Infow("Added constraint prompt to video generation",
			"id", videoGenID,
			"reference_mode", referenceMode,
			"constraint_prompt_length", len(constraintPrompt))
	}

	// 打印完整的提示词信息
	s.log.Infow("Video generation prompts",
		"id", videoGenID,
		"user_prompt", videoGen.Prompt,
		"constraint_prompt", constraintPrompt,
		"final_prompt", prompt)

	result, err := client.GenerateVideo(imageURL, prompt, opts...)
	if err != nil {
		s.log.Errorw("Video generation API call failed", "error", err, "id", videoGenID)
		s.updateVideoGenError(videoGenID, err.Error())
		return
	}

	// CRITICAL FIX: Validate TaskID before starting polling goroutine
	// Empty TaskID would cause polling to fail silently or cause issues
	if result.TaskID != "" {
		s.db.Model(&videoGen).Updates(map[string]interface{}{
			"task_id": result.TaskID,
			"status":  models.VideoStatusProcessing,
		})
		// Start background goroutine to poll task status
		// This allows the API to return immediately while video generation continues asynchronously
		// The goroutine will poll until completion, failure, or timeout (max 300 attempts * 10s = 50 minutes)
		go s.pollTaskStatus(videoGenID, result.TaskID, videoGen.Provider, videoGen.Model, apiKey)
		return
	}

	if result.VideoURL != "" {
		s.completeVideoGeneration(videoGenID, result.VideoURL, &result.Duration, &result.Width, &result.Height, nil)
		return
	}

	s.updateVideoGenError(videoGenID, "no task ID or video URL returned")
}

func (s *VideoGenerationService) pollTaskStatus(videoGenID uint, taskID string, provider string, model string, apiKey string) {
	// CRITICAL FIX: Validate taskID parameter to prevent invalid API calls
	// Empty taskID would cause unnecessary API calls and potential errors
	if taskID == "" {
		s.log.Errorw("Invalid empty taskID for polling", "video_gen_id", videoGenID)
		s.updateVideoGenError(videoGenID, "invalid task ID for polling")
		return
	}

	client, err := s.getVideoClient(provider, model, apiKey)
	if err != nil {
		s.log.Errorw("Failed to get video client for polling", "error", err)
		s.updateVideoGenError(videoGenID, "failed to get video client")
		return
	}

	// Polling configuration: max 300 attempts with 10 second intervals
	// Total maximum polling time: 300 * 10s = 50 minutes
	// This prevents infinite polling if the task never completes
	maxAttempts := 300
	interval := 10 * time.Second

	for attempt := 0; attempt < maxAttempts; attempt++ {
		// Sleep before each poll attempt to avoid overwhelming the API
		// First iteration sleeps before the first check (after 0 attempts)
		time.Sleep(interval)

		var videoGen models.VideoGeneration
		if err := s.db.First(&videoGen, videoGenID).Error; err != nil {
			s.log.Errorw("Failed to load video generation", "error", err, "id", videoGenID)
			return
		}

		// CRITICAL FIX: Check if status was manually changed (e.g., cancelled by user)
		// If status is no longer "processing", stop polling to avoid unnecessary API calls
		// This prevents polling when the task has been cancelled or failed externally
		if videoGen.Status != models.VideoStatusProcessing {
			s.log.Infow("Video generation status changed, stopping poll", "id", videoGenID, "status", videoGen.Status)
			return
		}

		// Poll the video generation API for task status
		// Continue polling on transient errors (network issues, temporary API failures)
		// Only stop on permanent errors or task completion
		result, err := client.GetTaskStatus(taskID)
		if err != nil {
			s.log.Errorw("Failed to get task status", "error", err, "task_id", taskID, "attempt", attempt+1)
			// Continue polling on error - might be transient network issue
			// Will eventually timeout after maxAttempts if error persists
			continue
		}

		// Check if task completed successfully
		// CRITICAL FIX: Validate that video URL exists when task is marked as completed
		// Some APIs may mark task as completed but fail to provide the video URL
		if result.Completed {
			if result.VideoURL != "" {
				// Successfully completed with video URL - download and update database
				s.completeVideoGeneration(videoGenID, result.VideoURL, &result.Duration, &result.Width, &result.Height, nil)
				return
			}
			// Task marked as completed but no video URL - this is an error condition
			s.updateVideoGenError(videoGenID, "task completed but no video URL")
			return
		}

		// Check if task failed with an error message
		if result.Error != "" {
			s.updateVideoGenError(videoGenID, result.Error)
			return
		}

		// Task still in progress - log and continue polling
		s.log.Infow("Video generation in progress", "id", videoGenID, "attempt", attempt+1, "max_attempts", maxAttempts)
	}

	// CRITICAL FIX: Handle polling timeout gracefully
	// After maxAttempts (50 minutes), mark task as failed if still not completed
	// This prevents indefinite polling and resource waste
	s.updateVideoGenError(videoGenID, fmt.Sprintf("polling timeout after %d attempts (%.1f minutes)", maxAttempts, float64(maxAttempts*int(interval))/60.0))
}

func (s *VideoGenerationService) completeVideoGeneration(videoGenID uint, videoURL string, duration *int, width *int, height *int, firstFrameURL *string) {
	var videoGen models.VideoGeneration
	if err := s.db.First(&videoGen, videoGenID).Error; err != nil {
		s.log.Errorw("Failed to load video generation for completion", "error", err, "id", videoGenID)
		return
	}

	storedVideoURL := videoURL
	var localVideoPath *string

	// 优先写入统一对象存储
	if s.storageService != nil && videoURL != "" && (strings.HasPrefix(videoURL, "http://") || strings.HasPrefix(videoURL, "https://")) {
		key := s.buildVideoStorageKey(&videoGen, videoURL)
		if key != "" {
			if objectURL, err := s.storageService.DownloadAndSave(context.Background(), videoURL, key); err == nil {
				localVideoPath = &key
				storedVideoURL = objectURL
				s.log.Infow("Video stored via storage service", "id", videoGenID, "key", key)
			} else {
				s.log.Warnw("Failed to store video via storage service", "id", videoGenID, "error", err)
			}
		}
	} else if s.localStorage != nil && videoURL != "" {
		downloadResult, err := s.localStorage.DownloadFromURLWithPath(videoURL, "videos")
		if err != nil {
			s.log.Warnw("Failed to download video to local storage",
				"error", err,
				"id", videoGenID,
				"original_url", videoURL)
		} else {
			localVideoPath = &downloadResult.RelativePath
			storedVideoURL = downloadResult.URL
			s.log.Infow("Video downloaded to local storage",
				"id", videoGenID,
				"original_url", videoURL,
				"local_path", downloadResult.RelativePath)
		}
	}

	// 探测时长：统一通过 storageService.GetLocalPath 获取本地文件路径
	if localVideoPath != nil && s.ffmpeg != nil {
		localProbePath := ""
		cleanup := func() {}
		if s.storageService != nil {
			if path, fn, err := s.storageService.GetLocalPath(context.Background(), *localVideoPath); err == nil {
				localProbePath = path
				cleanup = fn
			}
		}
		if localProbePath == "" && s.localStorage != nil {
			localProbePath = s.localStorage.GetAbsolutePath(*localVideoPath)
		}
		defer cleanup()

		if localProbePath != "" {
			if probedDuration, err := s.ffmpeg.GetVideoDuration(localProbePath); err == nil {
				durationInt := int(probedDuration + 0.5)
				if duration == nil || *duration == 0 || durationInt != *duration {
					duration = &durationInt
					s.log.Infow("Using probed video duration", "id", videoGenID, "duration_seconds", durationInt)
				}
			} else if duration == nil || *duration == 0 {
				s.log.Errorw("Failed to probe video duration", "error", err, "id", videoGenID, "local_path", localProbePath)
			}
		}
	}

	// 数据库中保存 URL 和对象 key
	updates := map[string]interface{}{
		"status":     models.VideoStatusCompleted,
		"video_url":  storedVideoURL,
		"local_path": localVideoPath,
	}
	// 只有当 duration 大于 0 时才保存，避免保存无效的 0 值
	if duration != nil && *duration > 0 {
		updates["duration"] = *duration
	}
	if width != nil {
		updates["width"] = *width
	}
	if height != nil {
		updates["height"] = *height
	}
	if firstFrameURL != nil {
		updates["first_frame_url"] = *firstFrameURL
	}

	if err := s.db.Model(&models.VideoGeneration{}).Where("id = ?", videoGenID).Updates(updates).Error; err != nil {
		s.log.Errorw("Failed to update video generation", "error", err, "id", videoGenID)
		return
	}

	if videoGen.StoryboardID != nil {
		storyboardUpdates := map[string]interface{}{
			"video_url": storedVideoURL,
		}
		if duration != nil && *duration > 0 {
			storyboardUpdates["duration"] = *duration
		}
		if err := s.db.Model(&models.Storyboard{}).Where("id = ?", *videoGen.StoryboardID).Updates(storyboardUpdates).Error; err != nil {
			s.log.Warnw("Failed to update storyboard", "storyboard_id", *videoGen.StoryboardID, "error", err)
		} else {
			s.log.Infow("Updated storyboard with video info", "storyboard_id", *videoGen.StoryboardID, "duration", duration)
		}
	}

	s.log.Infow("Video generation completed", "id", videoGenID, "url", storedVideoURL, "duration", duration)
}

func videoExtFromURL(urlStr string) string {
	parsed, err := url.Parse(urlStr)
	if err == nil {
		ext := strings.ToLower(filepath.Ext(parsed.Path))
		if ext != "" {
			return ext
		}
	}
	return ".mp4"
}

func (s *VideoGenerationService) buildVideoStorageKey(videoGen *models.VideoGeneration, videoURL string) string {
	if videoGen == nil {
		return ""
	}
	userID := normalizeUserID(videoGen.UserID)
	dramaID := fmt.Sprintf("%d", videoGen.DramaID)
	filename := fmt.Sprintf("video_%d%s", time.Now().Unix(), videoExtFromURL(videoURL))

	if videoGen.StoryboardID != nil {
		var storyboard models.Storyboard
		if err := s.db.Select("id, episode_id").Where("id = ?", *videoGen.StoryboardID).First(&storyboard).Error; err == nil {
			return cospkg.StoryboardKey(userID, dramaID, fmt.Sprintf("%d", storyboard.EpisodeID), fmt.Sprintf("%d", *videoGen.StoryboardID), filename)
		}
	}
	if videoGen.ImageGenID != nil {
		return cospkg.EpisodeOutputKey(userID, dramaID, "misc", filename)
	}
	return cospkg.EpisodeOutputKey(userID, dramaID, "misc", filename)
}

func (s *VideoGenerationService) updateVideoGenError(videoGenID uint, errorMsg string) {
	if err := s.db.Model(&models.VideoGeneration{}).Where("id = ?", videoGenID).Updates(map[string]interface{}{
		"status":    models.VideoStatusFailed,
		"error_msg": errorMsg,
	}).Error; err != nil {
		s.log.Errorw("Failed to update video generation error", "error", err, "id", videoGenID)
	}
}

func (s *VideoGenerationService) getVideoClient(provider string, modelName string, apiKey string) (video.VideoClient, error) {
	// 根据模型名称获取AI配置
	var config *models.AIServiceConfig
	var err error

	if modelName != "" {
		config, err = s.aiService.GetConfigForModelWithAPIKey("video", modelName, apiKey)
		if err != nil {
			s.log.Warnw("Failed to get config for model, using default", "model", modelName, "error", err)
			config, err = s.aiService.GetDefaultConfigWithAPIKey("video", apiKey)
			if err != nil {
				return nil, fmt.Errorf("no video AI config found: %w", err)
			}
		}
	} else {
		config, err = s.aiService.GetDefaultConfigWithAPIKey("video", apiKey)
		if err != nil {
			return nil, fmt.Errorf("no video AI config found: %w", err)
		}
	}

	// 使用配置中的信息创建客户端
	baseURL := config.BaseURL
	configAPIKey := config.APIKey
	model := modelName
	if model == "" && len(config.Model) > 0 {
		model = config.Model[0]
	}

	// 根据配置中的 provider 创建对应的客户端
	var endpoint string
	var queryEndpoint string

	switch config.Provider {
	case "chatfire":
		endpoint = "/video/generations"
		queryEndpoint = "/video/task/{taskId}"
		return video.NewChatfireClient(baseURL, configAPIKey, model, endpoint, queryEndpoint), nil
	case "doubao", "volcengine", "volces":
		// 使用网关标准端点，与 Studio 项目保持一致
		// 注意：如果 baseURL 已包含 /v1，这里不要重复
		endpoint = "/video/generations"
		queryEndpoint = "/video/generations/{taskId}"
		return video.NewVolcesArkClient(baseURL, configAPIKey, model, endpoint, queryEndpoint), nil
	case "openai":
		// OpenAI Sora 使用 /v1/videos 端点
		return video.NewOpenAISoraClient(baseURL, configAPIKey, model), nil
	case "runway":
		return video.NewRunwayClient(baseURL, configAPIKey, model), nil
	case "pika":
		return video.NewPikaClient(baseURL, configAPIKey, model), nil
	case "minimax":
		return video.NewMinimaxClient(baseURL, configAPIKey, model), nil
	default:
		return nil, fmt.Errorf("unsupported video provider: %s", provider)
	}
}

func (s *VideoGenerationService) RecoverPendingTasks() {
	var pendingVideos []models.VideoGeneration
	// Query for pending tasks with non-empty task_id
	// Note: Using IS NOT NULL and != '' to ensure we only get valid task IDs
	if err := s.db.Where("status = ? AND task_id IS NOT NULL AND task_id != ''", models.VideoStatusProcessing).Find(&pendingVideos).Error; err != nil {
		s.log.Errorw("Failed to load pending video tasks", "error", err)
		return
	}

	s.log.Infow("Recovering pending video generation tasks", "count", len(pendingVideos))

	for _, videoGen := range pendingVideos {
		// CRITICAL FIX: Check for nil TaskID before dereferencing to prevent panic
		// Even though we filter for non-empty task_id, GORM might still return nil pointers
		// This nil check prevents a potential runtime panic
		if videoGen.TaskID == nil || *videoGen.TaskID == "" {
			s.log.Warnw("Skipping video generation with nil or empty TaskID", "id", videoGen.ID)
			continue
		}

		// Start goroutine to poll task status for each pending video
		// Each goroutine will poll independently until completion or timeout
		go s.pollTaskStatus(videoGen.ID, *videoGen.TaskID, videoGen.Provider, videoGen.Model, "")
	}
}

func (s *VideoGenerationService) GetVideoGeneration(userID string, id uint) (*models.VideoGeneration, error) {
	userID = normalizeUserID(userID)
	var videoGen models.VideoGeneration
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&videoGen).Error; err != nil {
		return nil, err
	}
	return &videoGen, nil
}

func (s *VideoGenerationService) ListVideoGenerations(userID string, dramaID *uint, storyboardID *uint, status string, limit int, offset int) ([]*models.VideoGeneration, int64, error) {
	userID = normalizeUserID(userID)
	var videos []*models.VideoGeneration
	var total int64

	query := s.db.Model(&models.VideoGeneration{}).Where("user_id = ?", userID)

	if dramaID != nil {
		query = query.Where("drama_id = ?", *dramaID)
	}
	if storyboardID != nil {
		query = query.Where("storyboard_id = ?", *storyboardID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&videos).Error; err != nil {
		return nil, 0, err
	}

	return videos, total, nil
}

func (s *VideoGenerationService) GenerateVideoFromImage(userID string, apiKey string, imageGenID uint) (*models.VideoGeneration, error) {
	userID = normalizeUserID(userID)
	var imageGen models.ImageGeneration
	if err := s.db.Where("id = ? AND user_id = ?", imageGenID, userID).First(&imageGen).Error; err != nil {
		return nil, fmt.Errorf("image generation not found")
	}

	if imageGen.Status != models.ImageStatusCompleted || imageGen.ImageURL == nil {
		return nil, fmt.Errorf("image is not ready")
	}

	// 获取关联的Storyboard以获取时长
	var duration *int
	if imageGen.StoryboardID != nil {
		var storyboard models.Storyboard
		if err := s.db.Where("id = ?", *imageGen.StoryboardID).First(&storyboard).Error; err == nil {
			duration = &storyboard.Duration
			s.log.Infow("Using storyboard duration for video generation",
				"storyboard_id", *imageGen.StoryboardID,
				"duration", storyboard.Duration)
		}
	}

	req := &GenerateVideoRequest{
		DramaID:      fmt.Sprintf("%d", imageGen.DramaID),
		StoryboardID: imageGen.StoryboardID,
		ImageGenID:   &imageGenID,
		ImageURL:     *imageGen.ImageURL,
		Prompt:       imageGen.Prompt,
		Provider:     "doubao",
		Duration:     duration,
	}

	return s.GenerateVideo(userID, apiKey, req)
}

func (s *VideoGenerationService) BatchGenerateVideosForEpisode(userID string, apiKey string, episodeID string) ([]*models.VideoGeneration, error) {
	userID = normalizeUserID(userID)
	var episode models.Episode
	if err := s.db.Preload("Storyboards").
		Joins("JOIN dramas ON dramas.id = episodes.drama_id").
		Where("episodes.id = ? AND dramas.user_id = ?", episodeID, userID).
		First(&episode).Error; err != nil {
		return nil, fmt.Errorf("episode not found")
	}

	var results []*models.VideoGeneration
	for _, storyboard := range episode.Storyboards {
		if storyboard.ImagePrompt == nil {
			continue
		}

		var imageGen models.ImageGeneration
		if err := s.db.Where("storyboard_id = ? AND status = ?", storyboard.ID, models.ImageStatusCompleted).
			Order("created_at DESC").First(&imageGen).Error; err != nil {
			s.log.Warnw("No completed image for storyboard", "storyboard_id", storyboard.ID)
			continue
		}

		videoGen, err := s.GenerateVideoFromImage(userID, apiKey, imageGen.ID)
		if err != nil {
			s.log.Errorw("Failed to generate video", "storyboard_id", storyboard.ID, "error", err)
			continue
		}

		results = append(results, videoGen)
	}

	return results, nil
}

func (s *VideoGenerationService) DeleteVideoGeneration(userID string, id uint) error {
	userID = normalizeUserID(userID)
	result := s.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.VideoGeneration{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("video generation not found")
	}
	return nil
}

// convertImageToBase64 将图片转换为base64格式
// 优先使用本地存储的图片，如果没有则使用URL
func (s *VideoGenerationService) convertImageToBase64(imageURL string) (string, error) {
	// 如果已经是base64格式，直接返回
	if strings.HasPrefix(imageURL, "data:") {
		return imageURL, nil
	}

	// 尝试从COS存储读取（优先级最高）
	if s.storageService != nil && !strings.HasPrefix(imageURL, "http://") && !strings.HasPrefix(imageURL, "https://") {
		// 看起来像 COS key（不是 HTTP URL）
		localPath, cleanup, err := s.storageService.GetLocalPath(context.Background(), imageURL)
		if err == nil && localPath != "" {
			defer cleanup() // 确保清理临时文件

			// 从本地临时文件转换为 base64
			base64Str, err := utils.ImageToBase64(localPath)
			if err == nil {
				s.log.Infow("Converted COS image to base64", "key", imageURL)
				return base64Str, nil
			}
			s.log.Warnw("Failed to convert COS image to base64", "error", err, "key", imageURL)
		}
	}

	// 尝试从本地存储读取
	if s.localStorage != nil {
		var relativePath string

		// 1. 检查是否是本地URL（包含 /static/）
		if strings.Contains(imageURL, "/static/") {
			// 提取相对路径，例如从 "http://localhost:5678/static/images/xxx.jpg" 提取 "images/xxx.jpg"
			parts := strings.Split(imageURL, "/static/")
			if len(parts) == 2 {
				relativePath = parts[1]
			}
		} else if !strings.HasPrefix(imageURL, "http://") && !strings.HasPrefix(imageURL, "https://") {
			// 2. 如果不是 HTTP/HTTPS URL，视为相对路径（如 "images/xxx.jpg"）
			relativePath = imageURL
		}

		// 如果识别出相对路径，尝试读取本地文件
		if relativePath != "" {
			absPath := s.localStorage.GetAbsolutePath(relativePath)

			// 使用工具函数转换为base64
			base64Str, err := utils.ImageToBase64(absPath)
			if err == nil {
				s.log.Infow("Converted local image to base64", "path", relativePath)
				return base64Str, nil
			}
			s.log.Warnw("Failed to convert local image to base64, will try URL", "error", err, "path", absPath)
		}
	}

	// 如果本地读取失败或不是本地路径，尝试从URL下载并转换
	base64Str, err := utils.ImageToBase64(imageURL)
	if err != nil {
		return "", fmt.Errorf("failed to convert image to base64: %w", err)
	}

	urlLen := len(imageURL)
	if urlLen > 50 {
		urlLen = 50
	}
	s.log.Infow("Converted remote image to base64", "url", imageURL[:urlLen])
	return base64Str, nil
}
