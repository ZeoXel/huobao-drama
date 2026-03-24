package handlers

import (
	"strings"

	"github.com/drama-generator/backend/api/middlewares"
	"github.com/gin-gonic/gin"
)

func currentUserID(c *gin.Context) string {
	userID := strings.TrimSpace(c.GetString(string(middlewares.CtxUserID)))
	if userID == "" {
		return "standalone"
	}
	return userID
}

func currentAPIKey(c *gin.Context) string {
	return strings.TrimSpace(c.GetString(string(middlewares.CtxAPIKey)))
}
