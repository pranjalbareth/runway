// Policy engine - evaluates every provision request before Terraform runs
// This is the governance layer. Add/remove rules here.

const POLICIES = [
  {
    id: 'no-large-instances',
    description: 'Only t3.micro and t3.small allowed without justification',
    check: (req) => {
      const allowed = ['t3.micro', 't3.small', undefined, null]
      if (!allowed.includes(req.instance_type)) {
        return { passed: false, message: `Instance type "${req.instance_type}" requires approval. Allowed: t3.micro, t3.small` }
      }
      return { passed: true }
    }
  },
  {
    id: 'ttl-required',
    description: 'All environments must have a TTL between 1 and 72 hours',
    check: (req) => {
      const ttl = req.ttl_hours
      if (!ttl || ttl < 1 || ttl > 72) {
        return { passed: false, message: `TTL must be between 1 and 72 hours. Got: ${ttl}` }
      }
      return { passed: true }
    }
  },
  {
    id: 'name-format',
    description: 'Environment name must be lowercase alphanumeric with hyphens only',
    check: (req) => {
      const valid = /^[a-z0-9-]+$/.test(req.name)
      if (!valid) {
        return { passed: false, message: `Environment name "${req.name}" must be lowercase alphanumeric with hyphens only` }
      }
      return { passed: true }
    }
  },
  {
    id: 'no-port-conflicts',
    description: 'Port must be between 1024 and 9999',
    check: (req) => {
      const port = req.port
      if (port && (port < 1024 || port > 9999)) {
        return { passed: false, message: `Port ${port} is outside allowed range (1024-9999)` }
      }
      return { passed: true }
    }
  }
]

function evaluatePolicies(provisionRequest) {
  const violations = []
  const passed = []

  for (const policy of POLICIES) {
    const result = policy.check(provisionRequest)
    if (!result.passed) {
      violations.push({ policy: policy.id, message: result.message })
    } else {
      passed.push(policy.id)
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    passed,
    evaluatedAt: new Date().toISOString()
  }
}

module.exports = { evaluatePolicies, POLICIES }
