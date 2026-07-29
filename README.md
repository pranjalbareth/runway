# ▲ Runway - Internal Developer Platform

A self-service IDP that lets developers provision isolated environments via a web UI. Terraform runs under the hood, streaming live output to the browser over WebSockets. Includes a policy engine, a plugin-gated template catalog, TTL-based auto-destroy, and a full audit log.

## Architecture

```
React Frontend (Vite)
    │  REST + WebSocket
    ▼
Node.js Backend (Express + ws)
    ├── Policy Engine     → validates every provision request
    ├── Plugin System     → health-checks Docker / MockCloud / AWS, gates template visibility
    ├── Terraform Runner  → child_process.spawn, streams stdout over WS
    ├── SQLite            → environment state, audit log, plugin status
    └── TTL Scheduler     → auto-destroys environments after expiry
            │
            ▼
    Terraform (Docker provider locally, AWS provider in prod)
            │
            ▼
    Docker containers (local) / EC2, S3, Lambda, SQS, DynamoDB, EventBridge (AWS)
```

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, React Router |
| Backend | Node.js, Express, ws |
| Database | SQLite (sql.js) |
| IaC | Terraform (Docker provider locally, AWS provider in prod) |
| CI/CD | GitHub Actions |
| Prod infra | AWS EC2, VPC, IAM |

## Running locally

**Prerequisites:** Node.js 18+, Terraform, Docker Desktop running

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start backend
cd backend
npm install
node index.js

# 3. Start frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Running with Docker

```bash
docker build -t runway .
docker run -p 3001:3001 --env-file .env runway
```

The Docker image builds the frontend with Vite and serves it alongside the backend.

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend port |
| `INFRA_MODE` | `local` | `local` = MockCloud (no real AWS), `aws` = real AWS |
| `MOCKCLOUD_ENDPOINT` | `http://localhost:4566` | MockCloud URL (used when `INFRA_MODE=local`) |
| `AWS_ACCESS_KEY_ID` | (none) | AWS access key (required when `INFRA_MODE=aws`) |
| `AWS_SECRET_ACCESS_KEY` | (none) | AWS secret key (required when `INFRA_MODE=aws`) |
| `AWS_REGION` | `us-east-1` | Target AWS region (required when `INFRA_MODE=aws`) |

## Policy Engine

Every provision request is evaluated against rules before Terraform runs:

- **Instance type**: only `t3.micro` and `t3.small` allowed
- **TTL**: required, 30 seconds–72 hours
- **Name format**: lowercase alphanumeric + hyphens only
- **Port range**: 1024–9999 only

Violations are returned to the frontend before any infra is touched.

## Plugins

Templates are gated behind three plugins, each with a runtime health check (`GET /api/plugins`, `POST /api/plugins/:id/check`). A template is only visible in the catalog once one of its `requiredPlugins` is active.

| Plugin | Checks | Used by |
|--------|--------|---------|
| `docker` | `docker info` reachable | Hangar, Squadron, Beacon |
| `mockcloud` | LocalStack-style emulator at `MOCKCLOUD_ENDPOINT` responds | Jetstream, Cascade, Tower, Raptor, Cargo |
| `aws` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` present | Jetstream, Cascade, Tower, Cargo |

## Templates

Every template is a composite stack (multiple Terraform resources provisioned together), not a single resource.

| Template | Subtitle | Plugin(s) | Resources |
|----------|----------|-----------|-----------|
| 🛩️ `hangar` | Full-Stack Node Workspace — nginx + Node app + Redis | `docker` | 4 |
| ✈️ `squadron` | Microservices Mesh — nginx gateway + 2 backend services | `docker` | 4 |
| 🗼 `beacon` | Static Site Edge — nginx edge cache + nginx origin | `docker` | 3 |
| 🚀 `jetstream` | Serverless API — Lambda + API Gateway + DynamoDB | `mockcloud`, `aws` | 4 |
| 🌊 `cascade` | Event Pipeline — SQS + DLQ + Lambda worker + DynamoDB | `mockcloud`, `aws` | 5 |
| 🏗️ `tower` | Three-Tier Web App — EC2 + security group + S3 + IAM | `mockcloud`, `aws` | 4 |
| 🦅 `raptor` | The Everything Stack — every AWS service Runway supports, in one provision | `mockcloud` | 17 |
| 📦 `cargo` | Data Lake Platform — S3 ingest → EventBridge → Lambda transformer → DynamoDB | `mockcloud`, `aws` | 5 |

Docker templates (`hangar`, `squadron`, `beacon`) require only Docker Desktop. Cloud templates run against MockCloud (LocalStack-style, no credentials needed) when `INFRA_MODE=local`, or real AWS when `INFRA_MODE=aws` with valid credentials.

Full resource-level detail and generated Terraform source for any template are available via `GET /api/templates/:id` and `GET /api/templates/:id/code`.

## TTL Auto-Destroy

Every environment is provisioned with a TTL (30s–72h). A Node.js `setTimeout` scheduler fires `terraform destroy` automatically when the TTL expires, preventing cloud sprawl.

## CI/CD

GitHub Actions runs on every push to `main`:

1. Install deps and verify backend starts
2. Build frontend with Vite
3. SSH deploy to EC2, restart via PM2

**Required GitHub secrets:**

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | EC2 public IP or hostname |
| `DEPLOY_USER` | SSH username (e.g. `ubuntu`) |
| `DEPLOY_KEY` | Private SSH key for the EC2 instance |

Pull requests trigger the lint-and-test job only; the deploy job runs only on pushes to `main`.

## Resetting state

```bash
# Clear all environment records and audit logs from the database
cd backend
npm run flush
```
