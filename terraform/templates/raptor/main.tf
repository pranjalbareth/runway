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
      lambda       = local.endpoint
      apigateway   = local.endpoint
      apigatewayv2 = local.endpoint
      iam          = local.endpoint
      dynamodb     = local.endpoint
      sqs          = local.endpoint
      s3           = local.endpoint
      ec2          = local.endpoint
      sns          = local.endpoint
      events       = local.endpoint
      cloudwatch   = local.endpoint
      logs         = local.endpoint
      sts          = local.endpoint
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Inline Lambda packages (api + async worker)
# ─────────────────────────────────────────────────────────────────────────────
data "archive_file" "api" {
  type        = "zip"
  output_path = "${path.module}/api.zip"
  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => ({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stack: "raptor",
          env: "${var.env_name}",
          id: "${var.env_id}",
          path: event.rawPath || "/"
        })
      })
    EOT
  }
}

data "archive_file" "worker" {
  type        = "zip"
  output_path = "${path.module}/worker.zip"
  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => {
        const records = (event.Records || event.detail || []).length || 1
        console.log("Raptor worker (${var.env_name}) processed", records, "records")
        return { processed: records }
      }
    EOT
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# IAM
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "lambda_role" {
  name = "runway-${var.env_name}-raptor-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# ─────────────────────────────────────────────────────────────────────────────
# Storage tier — S3 + DynamoDB
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "assets" {
  # Bucket name includes a slice of env_id so MockCloud's persistent S3
  # namespace can't collide across provisions. Backend's LOCAL_HOOKS
  # computes the same name (see backend/lib/terraform.js bucketName()).
  bucket        = "runway-${var.env_name}-${substr(var.env_id, 0, 8)}-raptor-assets"
  force_destroy = true
  tags = {
    managed-by = "runway"
    env-id     = var.env_id
    stack      = "raptor"
  }
}

# DynamoDB is pre-created in local mode (terraform.js LOCAL_HOOKS handles it
# because the lighter MockCloud doesn't implement DescribeTimeToLive cleanly).
resource "aws_dynamodb_table" "state" {
  count        = var.infra_mode == "local" ? 0 : 1
  name         = "runway-${var.env_name}-raptor"
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

# ─────────────────────────────────────────────────────────────────────────────
# Messaging — SQS (queue + DLQ) and SNS fan-out
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_sqs_queue" "dlq" {
  count                     = var.infra_mode == "local" ? 0 : 1
  name                      = "runway-${var.env_name}-raptor-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "inbox" {
  count                      = var.infra_mode == "local" ? 0 : 1
  name                       = "runway-${var.env_name}-raptor-queue"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[0].arn
    maxReceiveCount     = 3
  })
}

resource "aws_sns_topic" "fanout" {
  name = "runway-${var.env_name}-raptor-fanout"
  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

locals {
  fanout_topic_arn = aws_sns_topic.fanout.arn
}

# ─────────────────────────────────────────────────────────────────────────────
# Compute — Lambda × 2
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_lambda_function" "api" {
  function_name    = "runway-${var.env_name}-raptor-api"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
      TABLE_NAME      = "runway-${var.env_name}-raptor"
      ASSETS_BUCKET   = aws_s3_bucket.assets.bucket
      FANOUT_TOPIC    = local.fanout_topic_arn
    }
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
    role       = "api"
  }
}

resource "aws_lambda_function" "worker" {
  function_name    = "runway-${var.env_name}-raptor-worker"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
      QUEUE_NAME      = "runway-${var.env_name}-raptor-queue"
    }
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
    role       = "worker"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# API Gateway HTTP API in front of the api Lambda
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "gateway" {
  name          = "runway-${var.env_name}-raptor-gw"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "integration" {
  api_id                 = aws_apigatewayv2_api.gateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.gateway.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.integration.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.gateway.id
  name        = "$default"
  auto_deploy = true
}

# ─────────────────────────────────────────────────────────────────────────────
# EC2 web tier (SG + instance)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_security_group" "web_sg" {
  name        = "runway-${var.env_name}-raptor-sg"
  description = "Inbound on app_port for raptor web tier"

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

resource "aws_instance" "web" {
  ami             = "ami-0c55b159cbfafe1f0"
  instance_type   = var.instance_type
  security_groups = [aws_security_group.web_sg.name]

  tags = {
    Name       = "runway-${var.env_name}-raptor-web"
    managed-by = "runway"
    env-id     = var.env_id
  }

  lifecycle {
    ignore_changes = [security_groups, ami, ebs_block_device, root_block_device]
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Observability + scheduling — CloudWatch log group + EventBridge tick
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "app_logs" {
  name              = "/runway/${var.env_name}/raptor"
  retention_in_days = 7
  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

resource "aws_cloudwatch_event_rule" "tick" {
  name                = "runway-${var.env_name}-raptor-tick"
  description         = "Periodic tick that fans out to the worker Lambda"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "tick_target" {
  rule      = aws_cloudwatch_event_rule.tick.name
  arn       = aws_lambda_function.worker.arn
  target_id = "runway-${var.env_name}-raptor-worker-target"
}

# ─────────────────────────────────────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────────────────────────────────────
output "api_endpoint" { value = aws_apigatewayv2_api.gateway.api_endpoint }
output "asset_bucket" { value = aws_s3_bucket.assets.bucket }
output "table_name" { value = "runway-${var.env_name}-raptor" }
output "queue_name" { value = "runway-${var.env_name}-raptor-queue" }
output "dlq_name" { value = "runway-${var.env_name}-raptor-dlq" }
output "fanout_topic" { value = local.fanout_topic_arn }
output "log_group" { value = aws_cloudwatch_log_group.app_logs.name }
output "tick_rule" { value = aws_cloudwatch_event_rule.tick.name }
output "instance_id" { value = aws_instance.web.id }
output "infra_mode" { value = var.infra_mode }
output "env_id" { value = var.env_id }
