package middlewares

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// AuthMiddleware supports two modes:
// 1) standalone: no Authorization header, user id comes from X-User-ID (or fallback)
// 2) studio: Bearer JWT must be valid and non-expired, user id comes from token claims
func AuthMiddleware(nextAuthSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))

		// standalone mode
		if authHeader == "" {
			userID := strings.TrimSpace(c.GetHeader("X-User-ID"))
			if userID == "" {
				userID = "standalone"
			}
			c.Set(string(CtxUserID), userID)
			c.Set(string(CtxAPIKey), "")
			c.Next()
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(401, gin.H{"error": "invalid authorization header"})
			c.Abort()
			return
		}

		if nextAuthSecret == "" {
			c.JSON(500, gin.H{"error": "server auth secret not configured"})
			c.Abort()
			return
		}

		tokenStr := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(
			tokenStr,
			claims,
			func(t *jwt.Token) (interface{}, error) {
				return []byte(nextAuthSecret), nil
			},
			jwt.WithValidMethods([]string{"HS256"}),
			jwt.WithExpirationRequired(),
			jwt.WithLeeway(30*time.Second),
		)
		if err != nil || token == nil || !token.Valid {
			c.JSON(401, gin.H{"error": "invalid or expired token"})
			c.Abort()
			return
		}

		userID, _ := claims["id"].(string)
		if userID == "" {
			userID, _ = claims["sub"].(string)
		}
		if userID == "" {
			c.JSON(401, gin.H{"error": "missing user id in token"})
			c.Abort()
			return
		}

		c.Set(string(CtxUserID), userID)
		c.Set(string(CtxAPIKey), strings.TrimSpace(c.GetHeader("X-API-Key")))
		c.Next()
	}
}
