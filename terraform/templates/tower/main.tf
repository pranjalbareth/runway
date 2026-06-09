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
variable "app_port" {
  type    = number
  default = 80
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
variable "infra_mode" {
  type    = string
  default = "local"
}
variable "mockcloud_endpoint" {
  type    = string
  default = ""
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

locals {
  endpoint = var.infra_mode == "local" ? (
    length(var.mockcloud_endpoint) > 0 ? var.mockcloud_endpoint : "http://localhost:4566"
  ) : null
}

provider "aws" {
  region                      = var.infra_mode == "local" ? "us-east-1" : var.aws_region
  access_key                  = var.infra_mode == "local" ? "mock" : null
  secret_key                  = var.infra_mode == "local" ? "mock" : null
  skip_credentials_validation = var.infra_mode == "local"
  skip_requesting_account_id  = var.infra_mode == "local"
  skip_metadata_api_check     = var.infra_mode == "local"
  # MockCloud only understands path-style S3 URLs (PUT /bucket). Without this
  # the provider sends virtual-hosted (Host: bucket.s3.amazonaws.com) and
  # MockCloud mis-parses every PUT into BucketAlreadyExists.
  s3_use_path_style = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      ec2 = local.endpoint
      iam = local.endpoint
      s3  = local.endpoint
      sts = local.endpoint
    }
  }
}

# ── IAM role + instance profile (skipped in local mode — MockCloud's IAM
#    emulator returns malformed XML for CreateInstanceProfile) ──
resource "aws_iam_role" "instance_role" {
  count = var.infra_mode == "local" ? 0 : 1
  name  = "runway-${var.env_name}-tower-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_instance_profile" "instance" {
  count = var.infra_mode == "local" ? 0 : 1
  name  = "runway-${var.env_name}-tower-profile"
  role  = aws_iam_role.instance_role[0].name
}

# ── Security group: open app_port to the world ──
resource "aws_security_group" "web_sg" {
  name        = "runway-${var.env_name}-web-sg"
  description = "Allow inbound on app_port for runway-${var.env_name}"

  ingress {
    from_port   = var.app_port
    to_port     = var.app_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# ── EC2 instance (a tiny Amazon Linux 2 AMI id; LocalStack accepts any AMI id) ──
resource "aws_instance" "web" {
  ami                  = "ami-0c55b159cbfafe1f0"
  instance_type        = var.instance_type
  security_groups      = [aws_security_group.web_sg.name]
  iam_instance_profile = var.infra_mode == "local" ? null : aws_iam_instance_profile.instance[0].name

  tags = {
    Name       = "runway-${var.env_name}-web"
    managed-by = "runway"
    env-id     = var.env_id
  }

  # MockCloud loses SG/AMI state between refreshes, which would otherwise
  # force a destroy/recreate cycle on every apply. Pin the EC2's identity to
  # what was created — these never genuinely change in a single env's lifetime.
  lifecycle {
    ignore_changes = [security_groups, ami, ebs_block_device, root_block_device]
  }
}

# ── S3 bucket for static assets ──
# force_destroy lets `terraform destroy` clean up even when the bucket has
# objects. The terraform.js LOCAL_HOOKS pre-deletes any stale bucket of the
# same name in MockCloud before each apply, so retries don't hit
# BucketAlreadyExists.
resource "aws_s3_bucket" "assets" {
  # Bucket name includes a slice of env_id so MockCloud's persistent S3
  # namespace can't collide across provisions. Backend's LOCAL_HOOKS
  # computes the same name (see backend/lib/terraform.js bucketName()).
  bucket        = "runway-${var.env_name}-${substr(var.env_id, 0, 8)}-assets"
  force_destroy = true
  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

output "instance_id" {
  value = aws_instance.web.id
}
output "infra_mode" {
  value = var.infra_mode
}
output "asset_bucket" {
  value = aws_s3_bucket.assets.bucket
}
output "env_id" {
  value = var.env_id
}
