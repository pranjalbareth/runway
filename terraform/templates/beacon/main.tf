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
  default = 8080
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
variable "infra_mode" {
  type    = string
  default = "local"
}

resource "docker_image" "nginx" {
  name         = "nginx:alpine"
  keep_locally = true
}

resource "docker_network" "beacon_net" {
  name = "runway-${var.env_name}-net"
}

# ── Origin: serves the actual static content ──
resource "docker_container" "origin" {
  name  = "runway-${var.env_name}-origin"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.beacon_net.name
  }

  upload {
    file    = "/usr/share/nginx/html/index.html"
    content = <<-EOT
      <!doctype html>
      <html><head><title>Beacon — ${var.env_name}</title></head>
      <body style="font-family: monospace; background:#0a0a0a; color:#fafafa; padding:40px;">
        <h1>🗼 Beacon</h1>
        <p>env: <b>${var.env_name}</b></p>
        <p>id: <code>${var.env_id}</code></p>
        <p>Served by origin, fronted by edge cache.</p>
      </body></html>
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
    value = "origin"
  }
}

# ── Edge cache: nginx in proxy_cache mode in front of origin ──
resource "docker_container" "edge_cache" {
  name  = "runway-${var.env_name}-edge"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.beacon_net.name
  }

  ports {
    internal = 80
    external = var.app_port
  }

  upload {
    file    = "/etc/nginx/conf.d/default.conf"
    content = <<-EOT
      proxy_cache_path /tmp/cache levels=1:2 keys_zone=edge:10m max_size=50m inactive=60m;
      server {
        listen 80;
        location / {
          proxy_cache edge;
          proxy_cache_valid 200 1m;
          add_header X-Cache-Status $upstream_cache_status;
          proxy_pass http://runway-${var.env_name}-origin:80;
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
    value = "edge_cache"
  }

  depends_on = [docker_container.origin]
}

output "edge_url" {
  value = "http://localhost:${var.app_port}"
}
output "env_id" {
  value = var.env_id
}
