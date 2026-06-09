terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
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
  default = 443
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

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      lambda       = local.endpoint
      apigateway   = local.endpoint
      apigatewayv2 = local.endpoint
      iam          = local.endpoint
      dynamodb     = local.endpoint
      sts          = local.endpoint
    }
  }
}

# ── Inline Lambda package ──
data "archive_file" "api" {
  type        = "zip"
  output_path = "${path.module}/api.zip"
  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => ({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: "${var.env_name}", id: "${var.env_id}", path: event.rawPath })
      })
    EOT
  }
}

# ── IAM role for Lambda ──
resource "aws_iam_role" "lambda_role" {
  name = "runway-${var.env_name}-jetstream-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# ── Lambda function ──
resource "aws_lambda_function" "api" {
  function_name    = "runway-${var.env_name}-api"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
      TABLE_NAME      = "runway-${var.env_name}"
    }
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# ── API Gateway HTTP API in front of the Lambda ──
resource "aws_apigatewayv2_api" "gateway" {
  name          = "runway-${var.env_name}-gateway"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.gateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.gateway.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.gateway.id
  name        = "$default"
  auto_deploy = true
}

# ── DynamoDB table (only in real AWS mode — local hook pre-creates it) ──
resource "aws_dynamodb_table" "store" {
  count        = var.infra_mode == "local" ? 0 : 1
  name         = "runway-${var.env_name}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.gateway.api_endpoint
}
output "table_name" {
  value = "runway-${var.env_name}"
}
output "env_id" {
  value = var.env_id
}
