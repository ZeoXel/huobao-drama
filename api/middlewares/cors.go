package middlewares

import (
	"fmt"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func CORSMiddleware(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		path := c.Request.URL.Path

		// 检查是否是静态文件路径（/static 或 /assets）
		isStaticPath := len(path) >= 7 && (path[:7] == "/static" || path[:7] == "/assets")

		allowed := false
		for _, o := range allowedOrigins {
			if o == "*" || o == origin || wildcardOriginMatch(o, origin) {
				allowed = true
				break
			}
		}

		// 对于静态文件，如果有 Origin 头，总是允许跨域访问
		if isStaticPath && origin != "" {
			allowed = true
		}

		if allowed && origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		} else if allowed && origin == "" {
			// 如果没有 Origin 头但是允许的请求，设置为 *
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-API-Key, X-User-ID, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Disposition")
		studioOrigin := strings.TrimSpace(os.Getenv("STUDIO_ORIGIN"))
		if studioOrigin == "" {
			studioOrigin = "https://studio.lsaigc.com"
		}
		c.Writer.Header().Set("Content-Security-Policy", fmt.Sprintf("frame-ancestors 'self' %s", studioOrigin))

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func wildcardOriginMatch(pattern, origin string) bool {
	if pattern == "" || origin == "" || !strings.Contains(pattern, "*") {
		return false
	}
	parts := strings.Split(pattern, "*")
	if len(parts) != 2 {
		return false
	}
	return strings.HasPrefix(origin, parts[0]) && strings.HasSuffix(origin, parts[1])
}
