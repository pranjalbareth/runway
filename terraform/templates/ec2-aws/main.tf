terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "env_name" {
  type = string
}
variable "env_id" {
  type = string
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
variable "app_port" {
  type    = number
  default = 22
}
variable "infra_mode" {
  type    = string
  default = "local"
}

locals {
  mockcloud_endpoint = var.infra_mode == "local" ? (
    length(var.mockcloud_endpoint) > 0 ? var.mockcloud_endpoint : "http://localhost:4566"
  ) : null
}

variable "mockcloud_endpoint" {
  type    = string
  default = ""
}

provider "aws" {
  region                      = var.infra_mode == "local" ? "us-east-1" : var.aws_region
  access_key                  = var.infra_mode == "local" ? "mock" : null
  secret_key                  = var.infra_mode == "local" ? "mock" : null
  skip_credentials_validation = var.infra_mode == "local"
  skip_requesting_account_id = var.infra_mode == "local"
  skip_metadata_api_check    = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      ec2 = local.mockcloud_endpoint
      iam = local.mockcloud_endpoint
      sts = local.mockcloud_endpoint
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# Key pair for SSH access
resource "aws_key_pair" "env_key" {
  key_name   = "runway-${var.env_name}-key"
  public_key = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC runway-mock-key"
}

# Security group
resource "aws_security_group" "env_sg" {
  name        = "runway-${var.env_name}-sg"
  description = "Security group for Runway env ${var.env_name}"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH"
  }

  ingress {
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "App port"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name       = "runway-${var.env_name}-sg"
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# EC2 instance
resource "aws_instance" "app" {
  ami                    = "ami-ubuntu-22"
  instance_type          = var.instance_type
  key_name               = aws_key_pair.env_key.key_name
  vpc_security_group_ids = [aws_security_group.env_sg.id]

  tags = {
    Name       = "runway-${var.env_name}"
    managed-by = "runway"
    env-id     = var.env_id
  }
}

output "instance_id"      { value = aws_instance.app.id }
output "public_ip"        { value = aws_instance.app.public_ip }
output "security_group_id" { value = aws_security_group.env_sg.id }
output "key_name"         { value = aws_key_pair.env_key.key_name }
output "app_url"          { value = "http://${aws_instance.app.public_ip}:${var.app_port}" }
output "env_id"           { value = var.env_id }
