terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "docker" {}

variable "env_name" {
  type = string
}
variable "env_id" {
  type = string
}
variable "app_port" {
  type    = number
  default = 3000
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
variable "infra_mode" {
  type    = string
  default = "local"
}

# ── Images ──
resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}
resource "docker_image" "node" {
  name         = "node:18-alpine"
  keep_locally = true
}
resource "docker_image" "redis" {
  name         = "redis:7-alpine"
  keep_locally = true
}

# ── Network ──
resource "docker_network" "hangar_net" {
  name = "runway-${var.env_name}-net"
}

# ── Redis cache ──
resource "docker_container" "cache" {
  name  = "runway-${var.env_name}-cache"
  image = docker_image.redis.image_id

  networks_advanced {
    name = docker_network.hangar_net.name
  }

  restart = "unless-stopped"

  labels {
    label = "managed-by"
    value = "runway"
  }
  labels {
    label = "runway-env-id"
    value = var.env_id
  }
  labels {
    label = "runway-env-name"
    value = var.env_name
  }
  labels {
    label = "runway-role"
    value = "cache"
  }
}

# ── Node app ──
resource "docker_container" "app" {
  name  = "runway-${var.env_name}-app"
  image = docker_image.node.image_id

  networks_advanced {
    name = docker_network.hangar_net.name
  }

  env = [
    "NODE_ENV=development",
    "RUNWAY_ENV_NAME=${var.env_name}",
    "RUNWAY_ENV_ID=${var.env_id}",
    "REDIS_HOST=runway-${var.env_name}-cache"
  ]

  command = [
    "node", "-e",
    "const h=require('http');h.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({env:'${var.env_name}',id:'${var.env_id}',role:'app',redis:'runway-${var.env_name}-cache'}))}).listen(3000,()=>console.log('Hangar app ${var.env_name} listening on 3000'))"
  ]

  restart = "unless-stopped"

  labels {
    label = "managed-by"
    value = "runway"
  }
  labels {
    label = "runway-env-id"
    value = var.env_id
  }
  labels {
    label = "runway-env-name"
    value = var.env_name
  }
  labels {
    label = "runway-role"
    value = "app"
  }

  depends_on = [docker_container.cache]
}

# ── Edge / nginx reverse proxy ──
resource "docker_container" "edge" {
  name  = "runway-${var.env_name}-edge"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.hangar_net.name
  }

  ports {
    internal = 80
    external = var.app_port
  }

  upload {
    file    = "/etc/nginx/conf.d/default.conf"
    content = <<-EOT
      server {
        listen 80;
        location / {
          proxy_pass http://runway-${var.env_name}-app:3000;
          proxy_set_header Host $host;
        }
      }
    EOT
  }

  restart = "unless-stopped"

  labels {
    label = "managed-by"
    value = "runway"
  }
  labels {
    label = "runway-env-id"
    value = var.env_id
  }
  labels {
    label = "runway-env-name"
    value = var.env_name
  }
  labels {
    label = "runway-role"
    value = "edge"
  }

  depends_on = [docker_container.app]
}

output "app_url" {
  value = "http://localhost:${var.app_port}"
}
output "env_id" {
  value = var.env_id
}
