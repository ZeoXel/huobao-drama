package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestAuthMiddleware_StandaloneMode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(AuthMiddleware("unused-secret"))
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"user_id": c.GetString(string(CtxUserID)),
			"api_key": c.GetString(string(CtxAPIKey)),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("X-User-ID", "standalone-user")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	if got := w.Body.String(); got != "{\"api_key\":\"\",\"user_id\":\"standalone-user\"}" {
		t.Fatalf("unexpected body: %s", got)
	}
}

func TestAuthMiddleware_StudioModeValidJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "test-secret"
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":  "user-from-token",
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	r := gin.New()
	r.Use(AuthMiddleware(secret))
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"user_id": c.GetString(string(CtxUserID)),
			"api_key": c.GetString(string(CtxAPIKey)),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	req.Header.Set("X-API-Key", "gateway-key")
	req.Header.Set("X-User-ID", "spoofed-user")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", w.Code, w.Body.String())
	}

	if got := w.Body.String(); got != "{\"api_key\":\"gateway-key\",\"user_id\":\"user-from-token\"}" {
		t.Fatalf("unexpected body: %s", got)
	}
}

func TestAuthMiddleware_StudioModeExpiredJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "test-secret"
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":  "user-from-token",
		"exp": time.Now().Add(-5 * time.Minute).Unix(),
	})
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	r := gin.New()
	r.Use(AuthMiddleware(secret))
	r.GET("/ping", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d, body=%s", w.Code, w.Body.String())
	}
}
