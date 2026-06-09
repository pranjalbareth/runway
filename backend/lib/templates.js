// backend/lib/templates.js — single source of truth for all Runway templates.
// Each template is a COMPOSITE stack (multiple resources provisioned together).
// `requiredPlugins` controls visibility — a template is shown when any of its
// required plugins is active. `resources` is metadata used by the detail modal.

const TEMPLATES = [
  // ───── Docker plugin (local containers) ───────────────────────────────────
  {
    id: 'hangar',
    name: 'Hangar',
    subtitle: 'Full-Stack Node Workspace',
    description: 'A complete Node.js development hangar — nginx reverse proxy in front, Node app server behind it, Redis cache on the side. Everything wired into a private Docker network.',
    tags: ['node', 'redis', 'nginx', 'fullstack'],
    icon: '🛩️',
    defaultPort: 3000,
    category: 'compute',
    requiredPlugins: ['docker'],
    resources: [
      { type: 'docker_network',   name: 'hangar_net', description: 'Private bridge network connecting all containers' },
      { type: 'docker_container', name: 'edge',       description: 'Nginx reverse proxy exposed on app_port' },
      { type: 'docker_container', name: 'app',        description: 'Node.js application container' },
      { type: 'docker_container', name: 'cache',      description: 'Redis cache for session + ephemeral data' }
    ]
  },
  {
    id: 'squadron',
    name: 'Squadron',
    subtitle: 'Microservices Mesh',
    description: 'A 3-container service mesh — an nginx API gateway routes traffic to two backend microservices over a private network. Useful for testing service-to-service patterns.',
    tags: ['microservices', 'mesh', 'gateway'],
    icon: '✈️',
    defaultPort: 8080,
    category: 'compute',
    requiredPlugins: ['docker'],
    resources: [
      { type: 'docker_network',   name: 'squadron_net', description: 'Internal mesh network' },
      { type: 'docker_container', name: 'gateway',      description: 'Nginx API gateway with upstream routing' },
      { type: 'docker_container', name: 'service_a',    description: 'Backend microservice A (httpbin)' },
      { type: 'docker_container', name: 'service_b',    description: 'Backend microservice B (httpbin)' }
    ]
  },
  {
    id: 'beacon',
    name: 'Beacon',
    subtitle: 'Static Site Edge',
    description: 'A static site stack — nginx serves the content, a small cache container in front simulates an edge CDN. Two containers on a shared network.',
    tags: ['static', 'nginx', 'edge', 'cdn'],
    icon: '🗼',
    defaultPort: 8080,
    category: 'storage',
    requiredPlugins: ['docker'],
    resources: [
      { type: 'docker_network',   name: 'beacon_net', description: 'Edge → origin network' },
      { type: 'docker_container', name: 'edge_cache', description: 'Nginx caching proxy (the "CDN" tier)' },
      { type: 'docker_container', name: 'origin',     description: 'Nginx origin serving static files' }
    ]
  },

  // ───── Cloud plugins (MockCloud OR AWS) ───────────────────────────────────
  {
    id: 'jetstream',
    name: 'Jetstream',
    subtitle: 'Serverless API',
    description: 'A serverless HTTP API — Lambda function fronted by API Gateway HTTP API, persisting to a DynamoDB table. Pay-per-request, scales to zero.',
    tags: ['lambda', 'api-gateway', 'dynamodb', 'serverless'],
    icon: '🚀',
    defaultPort: null,
    category: 'serverless',
    requiredPlugins: ['mockcloud', 'aws'],
    resources: [
      { type: 'aws_iam_role',          name: 'lambda_role', description: 'Execution role for the Lambda' },
      { type: 'aws_lambda_function',   name: 'api',         description: 'HTTP request handler' },
      { type: 'aws_apigatewayv2_api',  name: 'gateway',     description: 'HTTP API gateway in front of Lambda' },
      { type: 'aws_dynamodb_table',    name: 'store',       description: 'On-demand persistence for the API' }
    ]
  },
  {
    id: 'cascade',
    name: 'Cascade',
    subtitle: 'Event Pipeline',
    description: 'An async event pipeline — messages land in an SQS queue (with a dead-letter queue for failures), a Lambda processor drains them and writes results to DynamoDB.',
    tags: ['sqs', 'lambda', 'dynamodb', 'async', 'queue'],
    icon: '🌊',
    defaultPort: null,
    category: 'messaging',
    requiredPlugins: ['mockcloud', 'aws'],
    resources: [
      { type: 'aws_iam_role',        name: 'worker_role', description: 'Execution role for the worker Lambda' },
      { type: 'aws_sqs_queue',       name: 'inbox',       description: 'Primary queue messages enter on' },
      { type: 'aws_sqs_queue',       name: 'dlq',         description: 'Dead-letter queue for poisoned messages' },
      { type: 'aws_lambda_function', name: 'processor',   description: 'Drains the queue and writes to DynamoDB' },
      { type: 'aws_dynamodb_table',  name: 'results',     description: 'Persistent store for processed results' }
    ]
  },
  {
    id: 'tower',
    name: 'Tower',
    subtitle: 'Three-Tier Web App',
    description: 'A classic always-on web app — EC2 instance with security group for compute, S3 bucket for assets, IAM role tying them together. The "control tower" of your stack.',
    tags: ['ec2', 'iam', 's3', 'web-app'],
    icon: '🏗️',
    defaultPort: 8080,
    category: 'compute',
    requiredPlugins: ['mockcloud', 'aws'],
    resources: [
      { type: 'aws_iam_role',          name: 'instance_role', description: 'IAM role attached to the EC2' },
      { type: 'aws_security_group',    name: 'web_sg',        description: 'Allows inbound traffic on app_port' },
      { type: 'aws_instance',          name: 'web',           description: 'EC2 instance running the web app' },
      { type: 'aws_s3_bucket',         name: 'assets',        description: 'S3 bucket for static assets / uploads' }
    ]
  },
  {
    id: 'raptor',
    name: 'Raptor',
    subtitle: 'The Everything Stack (MockCloud)',
    description: 'A kitchen-sink stack that exercises every AWS service Runway is wired to talk to in MockCloud — compute, storage, messaging, eventing, and observability — all in one provision. Useful as a smoke test for your local emulator.',
    tags: ['everything', 'kitchen-sink', 'mockcloud', 'demo'],
    icon: '🦅',
    defaultPort: 8080,
    category: 'omni',
    requiredPlugins: ['mockcloud'],
    resources: [
      { type: 'aws_iam_role',                  name: 'lambda_role', description: 'Execution role shared by all Lambdas' },
      { type: 'aws_security_group',            name: 'web_sg',      description: 'Inbound rules for the EC2 web tier' },
      { type: 'aws_instance',                  name: 'web',         description: 'EC2 web tier' },
      { type: 'aws_s3_bucket',                 name: 'assets',      description: 'Object storage for assets/uploads' },
      { type: 'aws_dynamodb_table',            name: 'state',       description: 'Persistent key/value table (pre-created in local mode)' },
      { type: 'aws_sqs_queue',                 name: 'inbox',       description: 'Async work queue (pre-created in local mode)' },
      { type: 'aws_sqs_queue',                 name: 'dlq',         description: 'Dead-letter queue (pre-created in local mode)' },
      { type: 'aws_lambda_function',           name: 'api',         description: 'HTTP API handler (Lambda)' },
      { type: 'aws_lambda_function',           name: 'worker',      description: 'Async worker (Lambda) — drains the queue' },
      { type: 'aws_apigatewayv2_api',          name: 'gateway',     description: 'HTTP API gateway in front of api Lambda' },
      { type: 'aws_apigatewayv2_integration',  name: 'integration', description: 'HTTP API → Lambda wiring' },
      { type: 'aws_apigatewayv2_route',        name: 'default',     description: 'Catch-all route for the HTTP API' },
      { type: 'aws_apigatewayv2_stage',        name: 'default',     description: 'Auto-deploying default stage' },
      { type: 'aws_sns_topic',                 name: 'fanout',      description: 'Pub/sub topic for fan-out events' },
      { type: 'aws_cloudwatch_log_group',      name: 'app_logs',    description: 'Centralized CloudWatch log group' },
      { type: 'aws_cloudwatch_event_rule',     name: 'tick',        description: 'EventBridge cron-style rule' },
      { type: 'aws_cloudwatch_event_target',   name: 'tick_target', description: 'Routes the tick rule to the worker Lambda' }
    ]
  },
  {
    id: 'cargo',
    name: 'Cargo',
    subtitle: 'Data Lake Platform',
    description: 'An ingestion + storage platform — files dropped into an S3 bucket trigger an EventBridge rule that fires a Lambda transformer, which writes structured records into DynamoDB.',
    tags: ['s3', 'eventbridge', 'lambda', 'dynamodb', 'data'],
    icon: '📦',
    defaultPort: null,
    category: 'data',
    requiredPlugins: ['mockcloud', 'aws'],
    resources: [
      { type: 'aws_iam_role',                  name: 'transformer_role', description: 'Execution role for the transformer Lambda' },
      { type: 'aws_s3_bucket',                 name: 'ingest',           description: 'Drop zone for raw incoming files' },
      { type: 'aws_lambda_function',           name: 'transformer',      description: 'Parses incoming files and writes records' },
      { type: 'aws_cloudwatch_event_rule',     name: 'on_object_create', description: 'Fires the transformer on new S3 objects' },
      { type: 'aws_dynamodb_table',            name: 'catalog',          description: 'Structured catalog of processed records' }
    ]
  }
]

const TEMPLATE_INDEX = new Map(TEMPLATES.map((t) => [t.id, t]))

function getById(id) {
  return TEMPLATE_INDEX.get(id) || null
}

module.exports = { TEMPLATES, getById }
