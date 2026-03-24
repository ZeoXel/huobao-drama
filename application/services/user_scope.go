package services

import "strings"

func normalizeUserID(userID string) string {
	normalized := strings.TrimSpace(userID)
	if normalized == "" {
		return "standalone"
	}
	return normalized
}
