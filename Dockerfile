# ── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Backend + Terraform ──────────────────────────────────────────
FROM node:20-alpine

# Install Terraform
RUN apk add --no-cache curl unzip && \
    curl -fsSL https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_amd64.zip -o /tmp/tf.zip && \
    unzip /tmp/tf.zip -d /usr/local/bin && \
    rm /tmp/tf.zip && \
    terraform version

WORKDIR /app

# Install backend deps
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy Terraform templates
COPY terraform/ ./terraform/

# Copy built frontend into backend to serve statically
COPY --from=frontend-build /app/frontend/dist ./backend/public

# Serve frontend from backend
RUN sed -i 's|// Routes|// Serve frontend\napp.use(express.static(path.join(__dirname, "public")))\napp.get("*", (req, res) => {\n  if (!req.path.startsWith("/api") \&\& !req.path.startsWith("/ws")) {\n    res.sendFile(path.join(__dirname, "public", "index.html"))\n  }\n})\n\n// Routes|' ./backend/index.js || true

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "backend/index.js"]
