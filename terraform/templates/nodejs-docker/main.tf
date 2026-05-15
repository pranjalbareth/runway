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

# Pull Node.js image
resource "docker_image" "node" {
  name         = "node:18-alpine"
  keep_locally = true
}

# Create a Docker network for this environment
resource "docker_network" "env_network" {
  name = "runway-${var.env_name}-network"
}

# Spin up the container (simulates EC2 running a Node app)
resource "docker_container" "app" {
  name  = "runway-${var.env_name}"
  image = docker_image.node.image_id

  networks_advanced {
    name = docker_network.env_network.name
  }

  ports {
    internal = 3000
    external = var.app_port
  }

  env = [
    "NODE_ENV=development",
    "RUNWAY_ENV_NAME=${var.env_name}",
    "RUNWAY_ENV_ID=${var.env_id}",
    "INSTANCE_TYPE=${var.instance_type}"
  ]

  # Run a simple HTTP server to prove the container is live
  command = [
    "node", "-e",
    "const h=require('http');h.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({env:'${var.env_name}',id:'${var.env_id}',status:'running',instanceType:'${var.instance_type}'}))}).listen(3000,()=>console.log('Runway env ${var.env_name} running on port 3000'))"
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
}

output "container_id" {
  value = docker_container.app.id
}

output "container_name" {
  value = docker_container.app.name
}

output "app_url" {
  value = "http://localhost:${var.app_port}"
}

output "env_id" {
  value = var.env_id
}
