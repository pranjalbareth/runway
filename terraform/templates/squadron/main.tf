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
resource "docker_image" "httpbin" {
  name         = "kennethreitz/httpbin"
  keep_locally = true
}

resource "docker_network" "squadron_net" {
  name = "runway-${var.env_name}-net"
}

# ── Service A ──
resource "docker_container" "service_a" {
  name  = "runway-${var.env_name}-svc-a"
  image = docker_image.httpbin.image_id

  networks_advanced {
    name = docker_network.squadron_net.name
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
    value = "service_a"
  }
}

# ── Service B ──
resource "docker_container" "service_b" {
  name  = "runway-${var.env_name}-svc-b"
  image = docker_image.httpbin.image_id

  networks_advanced {
    name = docker_network.squadron_net.name
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
    value = "service_b"
  }
}

# ── API Gateway routing /a → service_a, /b → service_b ──
resource "docker_container" "gateway" {
  name  = "runway-${var.env_name}-gateway"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.squadron_net.name
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
        location /a/ {
          proxy_pass http://runway-${var.env_name}-svc-a:80/;
        }
        location /b/ {
          proxy_pass http://runway-${var.env_name}-svc-b:80/;
        }
        location / {
          return 200 'Squadron gateway for ${var.env_name}\n  /a/  -> service_a\n  /b/  -> service_b\n';
          add_header Content-Type text/plain;
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
    value = "gateway"
  }

  depends_on = [docker_container.service_a, docker_container.service_b]
}

output "gateway_url" {
  value = "http://localhost:${var.app_port}"
}
output "env_id" {
  value = var.env_id
}
