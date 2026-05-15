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
  default = 443
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
  skip_requesting_account_id = var.infra_mode == "local"
  skip_metadata_api_check    = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      lambda        = local.endpoint
      apigateway    = local.endpoint
      apigatewayv2  = local.endpoint
      iam           = local.endpoint
      sts           = local.endpoint
    }
  }
}

# IAM role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "runway-${var.env_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Lambda function
resource "aws_lambda_function" "handler" {
  function_name = "runway-${var.env_name}-handler"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "${path.module}/handler.zip"

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
    }
  }

  tags = { managed-by = "runway", env-id = var.env_id }
}

# API Gateway v2 HTTP API
resource "aws_apigatewayv2_api" "api" {
  name          = "runway-${var.env_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.handler.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

output "api_endpoint"     { value = aws_apigatewayv2_api.api.api_endpoint }
output "function_name"    { value = aws_lambda_function.handler.function_name }
output "env_id"           { value = var.env_id }
