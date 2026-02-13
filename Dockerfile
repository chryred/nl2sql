# NL2SQL MCP Server Dockerfile
# Multi-stage build for optimized production image

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune devDependencies after build
RUN npm prune --production

# =============================================================================
# Stage 2: Production (Debian-based for Oracle Instant Client compatibility)
# =============================================================================
FROM node:20-slim AS production

# Set environment variables
ENV NODE_ENV=production
ENV MCP_TRANSPORT=sse
ENV MCP_PORT=3001

WORKDIR /app

# Install Oracle Instant Client Basic-lite + dependencies
# RUN apt-get update && \
#     apt-get install -y --no-install-recommends \
#       libaio1 \
#       wget \
#       unzip \
#       ca-certificates && \
#     mkdir -p /opt/oracle && \
#     wget -q https://download.oracle.com/otn_software/linux/instantclient/2340000/instantclient-basiclite-linux.x64-23.4.0.24.05.zip \
#       -O /tmp/instantclient.zip && \
#     unzip /tmp/instantclient.zip -d /opt/oracle && \
#     ln -s /opt/oracle/instantclient_* /opt/oracle/instantclient && \
#     rm /tmp/instantclient.zip && \
#     apt-get purge -y wget unzip && \
#     apt-get autoremove -y && \
#     rm -rf /var/lib/apt/lists/*

# ENV LD_LIBRARY_PATH=/opt/oracle/instantclient
# ENV ORACLE_CLIENT_PATH=/opt/oracle/instantclient

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nl2sql

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy source metadata files (YAML queries)
COPY --from=builder /app/src/database/schemas/metadata ./src/database/schemas/metadata

# Change ownership to non-root user
RUN chown -R nl2sql:nodejs /app

# Switch to non-root user
USER nl2sql

# Expose MCP SSE port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.setTimeout(5000, () => process.exit(1));"

# Default: Start MCP server in SSE mode
# Override with CMD ["node", "dist/index.js", "interactive"] for REPL mode
CMD ["node", "dist/mcp/index.js"]
