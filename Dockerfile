# Multi-stage build for Huobao Drama (TypeScript version)

# ==================== Stage 1: Build frontend ====================
ARG DOCKER_REGISTRY=
ARG NPM_REGISTRY=

FROM ${DOCKER_REGISTRY:-}node:20-alpine AS frontend-builder

ARG NPM_REGISTRY=
ENV NPM_REGISTRY=${NPM_REGISTRY:-}
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==================== Stage 2: Install backend deps ====================
FROM ${DOCKER_REGISTRY:-}node:20-alpine AS backend-builder

ARG NPM_REGISTRY=
ENV NPM_REGISTRY=${NPM_REGISTRY:-}
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# better-sqlite3 needs build tools for native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app/backend
COPY backend/package*.json ./
# Install all deps — tsx (devDep) is needed at runtime for TS execution
RUN npm install

# ==================== Stage 3: Runtime ====================
ARG DOCKER_REGISTRY=
ARG ALPINE_MIRROR=

FROM ${DOCKER_REGISTRY:-}node:20-alpine

ARG ALPINE_MIRROR=
ENV ALPINE_MIRROR=${ALPINE_MIRROR:-}
RUN if [ -n "$ALPINE_MIRROR" ]; then \
    sed -i "s@dl-cdn.alpinelinux.org@$ALPINE_MIRROR@g" /etc/apk/repositories; \
    fi

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    ffmpeg \
    wget \
    && rm -rf /var/cache/apk/*

ENV TZ=Asia/Shanghai
WORKDIR /app

# Copy backend with production deps
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/

# Copy frontend SPA build (ssr:false → .output/public is the static dist)
COPY --from=frontend-builder /app/frontend/.output/public ./frontend/dist

# Copy other project files
COPY configs/ ./configs/
COPY skills/ ./skills/

# Create data directory
RUN mkdir -p /app/data/static

EXPOSE 5679

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5679/api/v1/health || exit 1

WORKDIR /app/backend
CMD ["npx", "tsx", "src/index.ts"]
