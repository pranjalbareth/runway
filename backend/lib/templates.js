// backend/lib/templates.js — single source of truth for all Runway templates
// Frontend fetches this via /api/templates instead of hardcoding

const TEMPLATES = [
  {
    id: 'nodejs-docker',
    name: 'Node.js App',
    description: 'Provisions a Node.js runtime container. Simulates EC2 + security group + IAM in local mode.',
    tags: ['node', 'backend', 'api'],
    icon: '⬡',
    defaultPort: 3000,
    category: 'compute',
  },
  {
    id: 'static-nginx',
    name: 'Static Site',
    description: 'Provisions an Nginx container for serving static frontends. Simulates S3 + CloudFront in local mode.',
    tags: ['nginx', 'frontend', 'static'],
    icon: '◈',
    defaultPort: 8080,
    category: 'storage',
  },
  {
    id: 'ec2-aws',
    name: 'EC2 Instance',
    description: 'Real EC2 instance with security group and key pair. Uses MockCloud locally, real AWS in cloud mode.',
    tags: ['ec2', 'compute', 'aws'],
    icon: '▣',
    defaultPort: 22,
    category: 'compute',
  },
  {
    id: 's3-static-site',
    name: 'S3 Static Site',
    description: 'S3 bucket with static website hosting, ACL, and public access configuration.',
    tags: ['s3', 'static', 'hosting'],
    icon: '◉',
    defaultPort: null,
    category: 'storage',
  },
  {
    id: 'serverless-lambda',
    name: 'Serverless API',
    description: 'Lambda function with API Gateway v2 HTTP API. Pay-per-request, zero infrastructure to manage.',
    tags: ['lambda', 'api-gateway', 'serverless'],
    icon: '⚡',
    defaultPort: null,
    category: 'serverless',
  },
  {
    id: 'sqs-worker',
    name: 'SQS Worker',
    description: 'SQS queue with dead-letter queue and Lambda consumer. Classic async worker pattern.',
    tags: ['sqs', 'lambda', 'async', 'queue'],
    icon: '⇶',
    defaultPort: null,
    category: 'messaging',
  },
  {
    id: 'dynamodb-app',
    name: 'DynamoDB Table',
    description: 'DynamoDB table with GSI and on-demand billing. Optimized for single-table design patterns.',
    tags: ['dynamodb', 'nosql', 'database'],
    icon: '⬡',
    defaultPort: null,
    category: 'database',
  },
  {
    id: 'eventbridge-pipeline',
    name: 'EventBridge Pipeline',
    description: 'EventBridge rule with Lambda target and CloudWatch logs. Modern event-driven architecture.',
    tags: ['eventbridge', 'lambda', 'events'],
    icon: '⟳',
    defaultPort: null,
    category: 'serverless',
  },
]

module.exports = { TEMPLATES }
