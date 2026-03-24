package cos

import (
	"fmt"
	"path/filepath"
	"strings"
)

func sanitizePathPart(v string) string {
	p := strings.TrimSpace(v)
	p = strings.ReplaceAll(p, "..", "")
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.Trim(p, "/")
	if p == "" {
		return "unknown"
	}
	return p
}

func DramaBaseKey(userID, dramaID string) string {
	return fmt.Sprintf("drama/%s/%s", sanitizePathPart(userID), sanitizePathPart(dramaID))
}

func CharacterKey(userID, dramaID, characterID, filename string) string {
	return filepath.ToSlash(fmt.Sprintf("%s/characters/%s/%s", DramaBaseKey(userID, dramaID), sanitizePathPart(characterID), sanitizePathPart(filename)))
}

func SceneKey(userID, dramaID, sceneID, filename string) string {
	return filepath.ToSlash(fmt.Sprintf("%s/scenes/%s/%s", DramaBaseKey(userID, dramaID), sanitizePathPart(sceneID), sanitizePathPart(filename)))
}

func StoryboardKey(userID, dramaID, episodeID, storyboardID, filename string) string {
	return filepath.ToSlash(fmt.Sprintf("%s/episodes/%s/storyboards/%s/%s", DramaBaseKey(userID, dramaID), sanitizePathPart(episodeID), sanitizePathPart(storyboardID), sanitizePathPart(filename)))
}

func EpisodeOutputKey(userID, dramaID, episodeID, filename string) string {
	return filepath.ToSlash(fmt.Sprintf("%s/episodes/%s/output/%s", DramaBaseKey(userID, dramaID), sanitizePathPart(episodeID), sanitizePathPart(filename)))
}

func UserLibraryCharacterKey(userID, filename string) string {
	return filepath.ToSlash(fmt.Sprintf("drama/%s/library/characters/%s", sanitizePathPart(userID), sanitizePathPart(filename)))
}

