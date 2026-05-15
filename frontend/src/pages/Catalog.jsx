import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEnvironments } from '../hooks/useEnvironments'
import './Catalog.css'

const TEMPLATE_ICONS = {
  'nodejs-docker': '⬡',
  'static-nginx': '◈',
  'ec2-aws': '▣',
  's3-static-site': '◉',
  'serverless-lambda': '⚡',
  'sqs-worker': '⇶',
  'dynamodb-app': '⬡',
  'eventbridge-pipeline': '⟳',
}

const INSTANCE_TYPES = ['t3.micro', 't3.small']

export default function Catalog() {
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ name: '', instance_type: 't3.micro', port: '', ttl_hours: 24 })
  const [errors, setErrors] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const { provision } = useEnvironments()
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(setTemplates)
      .catch(console.error)
  }, [])

  const openModal = (template) => {
    setSelected(template)
    setForm({ name: '', instance_type: 't3.micro', port: template.defaultPort || '', ttl_hours: 24 })
    setErrors([])
  }

  const closeModal = () => {
    setSelected(null)
    setErrors([])
  }

  const handleProvision = async () => {
    setSubmitting(true)
    setErrors([])
    try {
      const result = await provision({
        name: form.name,
        template: selected.id,
        instance_type: form.instance_type,
        port: Number(form.port),
        ttl_hours: Number(form.ttl_hours)
      })
      closeModal()
      navigate(`/dashboard?highlight=${result.id}`)
    } catch (err) {
      if (err.violations) {
        setErrors(err.violations.map(v => v.message))
      } else {
        setErrors([err.error || 'Provisioning failed'])
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="catalog">
      <div className="page-header">
        <div className="page-title">Service Catalog</div>
        <div className="page-subtitle">Pick a template to provision a new environment</div>
      </div>

      <div className="template-grid">
        {templates.map(t => (
          <div key={t.id} className="template-card" onClick={() => openModal(t)}>
            <div className="template-icon">{TEMPLATE_ICONS[t.id] || '◆'}</div>
            <div className="template-info">
              <div className="template-name">{t.name}</div>
              <div className="template-desc">{t.description}</div>
              <div className="template-tags">
                {t.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
              </div>
            </div>
            <div className="template-action">
              Provision <span>→</span>
            </div>
          </div>
        ))}
      </div>

      {/* Provision Modal */}
      {selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Provision — {selected.name}</div>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>

            <div className="modal-body">
              <div className="field">
                <label className="label">Environment name</label>
                <input
                  type="text"
                  placeholder="my-feature-env"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
                <span className="field-hint">Lowercase, hyphens only. e.g. auth-v2-test</span>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="label">Instance type</label>
                  <select value={form.instance_type} onChange={e => setForm(f => ({ ...f, instance_type: e.target.value }))}>
                    {INSTANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {selected.defaultPort && (
                  <div className="field">
                    <label className="label">Port</label>
                    <input
                      type="number"
                      value={form.port}
                      onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <div className="field">
                <label className="label">TTL (hours) — auto-destroy after</label>
                <select value={form.ttl_hours} onChange={e => setForm(f => ({ ...f, ttl_hours: e.target.value }))}>
                  {[1, 4, 8, 12, 24, 48, 72].map(h => (
                    <option key={h} value={h}>{h}h{h === 24 ? ' (default)' : ''}</option>
                  ))}
                </select>
                <span className="field-hint">Environment will be automatically destroyed after TTL expires</span>
              </div>

              <div className="policy-notice">
                <div className="policy-notice-title">▲ POLICY GUARDRAILS</div>
                <div className="policy-notice-rules">
                  <span>Max t3.small</span>
                  <span>TTL 1–72h required</span>
                  <span>Lowercase name only</span>
                  <span>Port 1024–9999</span>
                </div>
              </div>

              {errors.length > 0 && (
                <div className="modal-errors">
                  {errors.map((e, i) => (
                    <div key={i} className="modal-error">✕ {e}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleProvision}
                disabled={submitting || !form.name}
              >
                {submitting ? 'Sending to Terraform...' : 'Provision Environment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
