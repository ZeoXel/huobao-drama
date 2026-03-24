package services

import (
	"fmt"
	"time"

	// Added missing import
	models "github.com/drama-generator/backend/domain/models"
	"github.com/drama-generator/backend/pkg/ai"
	"github.com/drama-generator/backend/pkg/config"
	"github.com/drama-generator/backend/pkg/logger"
	"github.com/drama-generator/backend/pkg/utils"
	"gorm.io/gorm"
)

type PropService struct {
	db                     *gorm.DB
	aiService              *AIService
	taskService            *TaskService
	imageGenerationService *ImageGenerationService
	log                    *logger.Logger
	config                 *config.Config
	promptI18n             *PromptI18n
}

func NewPropService(db *gorm.DB, aiService *AIService, taskService *TaskService, imageGenerationService *ImageGenerationService, log *logger.Logger, cfg *config.Config) *PropService {
	return &PropService{
		db:                     db,
		aiService:              aiService,
		taskService:            taskService,
		imageGenerationService: imageGenerationService,
		log:                    log,
		config:                 cfg,
		promptI18n:             NewPromptI18n(cfg),
	}
}

// ListProps 获取剧本的道具列表
func (s *PropService) ListProps(dramaID uint) ([]models.Prop, error) {
	var props []models.Prop
	if err := s.db.Where("drama_id = ?", dramaID).Find(&props).Error; err != nil {
		return nil, err
	}
	return props, nil
}

// CreateProp 创建道具
func (s *PropService) CreateProp(prop *models.Prop) error {
	return s.db.Create(prop).Error
}

// UpdateProp 更新道具
func (s *PropService) UpdateProp(id uint, updates map[string]interface{}) error {
	return s.db.Model(&models.Prop{}).Where("id = ?", id).Updates(updates).Error
}

// DeleteProp 删除道具
func (s *PropService) DeleteProp(id uint) error {
	return s.db.Delete(&models.Prop{}, id).Error
}

// ExtractPropsFromScript 从剧本提取道具（异步）
func (s *PropService) ExtractPropsFromScript(userID string, apiKey string, episodeID uint) (string, error) {
	userID = normalizeUserID(userID)
	var episode models.Episode
	if err := s.db.Joins("JOIN dramas ON dramas.id = episodes.drama_id").
		Where("episodes.id = ? AND dramas.user_id = ?", episodeID, userID).
		First(&episode).Error; err != nil {
		return "", fmt.Errorf("episode not found: %w", err)
	}

	task, err := s.taskService.CreateTask("prop_extraction", fmt.Sprintf("%d", episodeID))
	if err != nil {
		return "", err
	}

	go s.processPropExtraction(task.ID, episode, apiKey)

	return task.ID, nil
}

func (s *PropService) processPropExtraction(taskID string, episode models.Episode, apiKey string) {
	s.taskService.UpdateTaskStatus(taskID, "processing", 0, "正在分析剧本...")

	script := ""
	if episode.ScriptContent != nil {
		script = *episode.ScriptContent
	}

	// 获取 drama 的 style 信息
	var drama models.Drama
	if err := s.db.First(&drama, episode.DramaID).Error; err != nil {
		s.log.Warnw("Failed to load drama", "error", err, "drama_id", episode.DramaID)
	}

	promptTemplate := s.promptI18n.GetPropExtractionPrompt(drama.Style)
	prompt := fmt.Sprintf(promptTemplate, script)

	response, err := s.aiService.GenerateTextWithAPIKey(apiKey, prompt, "", ai.WithMaxTokens(2000))
	if err != nil {
		s.taskService.UpdateTaskError(taskID, err)
		return
	}

	var extractedProps []struct {
		Name        string `json:"name"`
		Type        string `json:"type"`
		Description string `json:"description"`
		ImagePrompt string `json:"image_prompt"`
	}

	if err := utils.SafeParseAIJSON(response, &extractedProps); err != nil {
		s.taskService.UpdateTaskError(taskID, fmt.Errorf("解析AI结果失败: %w", err))
		return
	}

	s.taskService.UpdateTaskStatus(taskID, "processing", 50, "正在保存道具...")

	var createdProps []models.Prop
	for _, p := range extractedProps {
		prop := models.Prop{
			DramaID:     episode.DramaID,
			Name:        p.Name,
			Type:        &p.Type,
			Description: &p.Description,
			Prompt:      &p.ImagePrompt,
		}
		// 检查是否已存在同名道具（避免重复）
		var count int64
		s.db.Model(&models.Prop{}).Where("drama_id = ? AND name = ?", episode.DramaID, p.Name).Count(&count)
		if count == 0 {
			if err := s.db.Create(&prop).Error; err == nil {
				createdProps = append(createdProps, prop)
			}
		}
	}

	s.taskService.UpdateTaskResult(taskID, createdProps)
}

// GeneratePropImage 生成道具图片
// 这里可以复用 ImageGenerationService，或者直接调用 AI Service
// 简单起见，这里直接调用 ImageGenerationService 如果可以，或者 AI Service.
// 为了保持架构一致性，应该创建一个 ImageGeneration 记录，然后复用现有的图片生成流程？
// 但为了简单快速实现，这里先写一个专用的方法，或者更好的方式是：
// 创建一个 ImageGeneration 记录，类型设为 "prop"，然后复用 ImageGenerationService 的逻辑。
// 但 ImageGenerationService 目前绑定了 Storyboard/Scene ID 等。
// 所以这里实现一个简化的直接生成逻辑，或者扩展 ImageGenerationService。
// 鉴于时间，我实现一个简化的直接生成并保存图片的方法。

func (s *PropService) GeneratePropImage(userID string, apiKey string, propID uint) (string, error) {
	userID = normalizeUserID(userID)
	// 1. 获取道具信息
	var prop models.Prop
	if err := s.db.Joins("JOIN dramas ON dramas.id = props.drama_id").
		Where("props.id = ? AND dramas.user_id = ?", propID, userID).
		First(&prop).Error; err != nil {
		return "", err
	}

	if prop.Prompt == nil || *prop.Prompt == "" {
		return "", fmt.Errorf("道具没有图片提示词")
	}

	// 2. 创建任务
	task, err := s.taskService.CreateTask("prop_image_generation", fmt.Sprintf("%d", propID))
	if err != nil {
		return "", err
	}

	go s.processPropImageGeneration(task.ID, prop, apiKey)
	return task.ID, nil
}

func (s *PropService) processPropImageGeneration(taskID string, prop models.Prop, apiKey string) {
	s.taskService.UpdateTaskStatus(taskID, "processing", 0, "正在生成图片...")

	var drama models.Drama
	if err := s.db.Where("id = ?", prop.DramaID).First(&drama).Error; err != nil {
		s.taskService.UpdateTaskError(taskID, fmt.Errorf("加载项目信息失败: %w", err))
		return
	}

	// 准备生成参数
	imageStyle := "Modern Japanese anime style"
	imageSize := "1024x1024"

	// 创建生成请求
	req := &GenerateImageRequest{
		DramaID:   fmt.Sprintf("%d", prop.DramaID),
		PropID:    &prop.ID,
		ImageType: string(models.ImageTypeProp),
		Prompt:    *prop.Prompt,
		Size:      imageSize,
		Style:     &imageStyle,
		Provider:  s.config.AI.DefaultImageProvider, // 使用默认配置
	}

	// 调用 ImageGenerationService
	imageGen, err := s.imageGenerationService.GenerateImage(drama.UserID, apiKey, req)
	if err != nil {
		s.taskService.UpdateTaskError(taskID, err)
		return
	}

	// 轮询 ImageGeneration 状态直到完成
	maxAttempts := 60
	pollInterval := 2 * time.Second

	for i := 0; i < maxAttempts; i++ {
		time.Sleep(pollInterval)

		// 重新加载 imageGen
		var currentImageGen models.ImageGeneration
		if err := s.db.First(&currentImageGen, imageGen.ID).Error; err != nil {
			s.log.Errorw("Failed to poll image generation", "error", err, "id", imageGen.ID)
			continue
		}

		if currentImageGen.Status == models.ImageStatusCompleted {
			if currentImageGen.ImageURL != nil {
				// 任务成功
				// ImageGenerationService 已经更新了 Prop.ImageURL，这里只需要更新 TaskService
				s.taskService.UpdateTaskResult(taskID, map[string]string{"image_url": *currentImageGen.ImageURL})
				return
			}
		} else if currentImageGen.Status == models.ImageStatusFailed {
			errMsg := "图片生成失败"
			if currentImageGen.ErrorMsg != nil {
				errMsg = *currentImageGen.ErrorMsg
			}
			s.taskService.UpdateTaskError(taskID, fmt.Errorf(errMsg))
			return
		}

		// 更新进度（可选）
		s.taskService.UpdateTaskStatus(taskID, "processing", 10+i, "正在生成图片...")
	}

	s.taskService.UpdateTaskError(taskID, fmt.Errorf("生成超时"))
}

// AssociatePropsWithStoryboard 关联道具到分镜
func (s *PropService) AssociatePropsWithStoryboard(storyboardID uint, propIDs []uint) error {
	var storyboard models.Storyboard
	if err := s.db.First(&storyboard, storyboardID).Error; err != nil {
		return err
	}

	var props []models.Prop
	if len(propIDs) > 0 {
		if err := s.db.Where("id IN ?", propIDs).Find(&props).Error; err != nil {
			return err
		}
	}

	return s.db.Model(&storyboard).Association("Props").Replace(props)
}
