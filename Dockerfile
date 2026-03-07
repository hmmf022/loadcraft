# Stage 1: Build MCP server bundles
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy tsup/tsconfig configs
COPY tsup.config.mcp.ts tsup.config.mcp-editor.ts ./
COPY tsconfig.mcp.json tsconfig.mcp-editor.json ./

# Copy source files needed for build
COPY src/core/ src/core/
COPY src/mcp/ src/mcp/
COPY src/mcp-editor/ src/mcp-editor/
COPY src/editor/state/ src/editor/state/

# Build both MCP servers
RUN npm run build:mcp && npm run build:mcp-editor

# Stage 2: Minimal runtime
FROM node:20-slim

WORKDIR /app

# Non-root user
RUN groupadd --system loadcraft && \
    useradd --system --gid loadcraft --no-create-home loadcraft && \
    mkdir -p /data && chown loadcraft:loadcraft /data

# Copy only bundled JS files from builder
COPY --from=builder --chown=loadcraft:loadcraft /app/dist-mcp/main.js dist-mcp/main.js
COPY --from=builder --chown=loadcraft:loadcraft /app/dist-mcp-editor/main.js dist-mcp-editor/main.js

USER loadcraft

# Default: run simulator MCP server
# Override with: node dist-mcp-editor/main.js for editor
CMD ["node", "dist-mcp/main.js"]
