package middlewares

import (
	"context"

	"github.com/gin-gonic/gin"
)

type contextKey string

const (
	CtxUserID contextKey = "user_id"
	CtxAPIKey contextKey = "api_key"
)

// InjectToContext copies auth values from gin context to standard context.Context.
func InjectToContext(c *gin.Context) context.Context {
	ctx := c.Request.Context()
	ctx = context.WithValue(ctx, CtxUserID, c.GetString(string(CtxUserID)))
	ctx = context.WithValue(ctx, CtxAPIKey, c.GetString(string(CtxAPIKey)))
	return ctx
}
