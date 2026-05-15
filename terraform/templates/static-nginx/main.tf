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

resource "docker_network" "env_network" {
  name = "runway-${var.env_name}-network"
}

resource "docker_container" "nginx" {
  name  = "runway-${var.env_name}"
  image = docker_image.nginx.image_id

  networks_advanced {
    name = docker_network.env_network.name
  }

  ports {
    internal = 80
    external = var.app_port
  }

  env = [
    "RUNWAY_ENV_NAME=${var.env_name}",
    "RUNWAY_ENV_ID=${var.env_id}"
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
}

output "container_id" {
  value = docker_container.nginx.id
}

output "container_name" {
  value = docker_container.nginx.name
}

output "app_url" {
  value = "http://localhost:${var.app_port}"
}

output "env_id" {
  value = var.env_id
}
