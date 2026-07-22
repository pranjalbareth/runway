import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './TemplateDetailModal.css'

const INSTANCE_TYPES = ['t3.micro', 't3.small']

const ADJECTIVES = [
  'amber', 'bold', 'brave', 'bright', 'calm', 'clean', 'cool', 'crisp', 'dark',
  'deep', 'eager', 'epic', 'fast', 'firm', 'free', 'gold', 'grand', 'green',
  'happy', 'heavy', 'keen', 'kind', 'lean', 'light', 'loud', 'mild', 'mint',
  'neat', 'odd', 'open', 'pale', 'pink', 'plain', 'plum', 'proud', 'pure',
  'quick', 'quiet', 'rare', 'raw', 'real', 'red', 'rich', 'rough', 'round',
  'royal', 'safe', 'sharp', 'silent', 'slim', 'slow', 'smart', 'soft', 'solid',
  'still', 'strong', 'swift', 'tall', 'thick', 'thin', 'tidy', 'tiny', 'tough',
  'true', 'vast', 'warm', 'wide', 'wild', 'wise', 'young',
]

const NOUNS = [
  'anchor', 'apple', 'arrow', 'atlas', 'axle', 'badge', 'bark', 'basin', 'beam',
  'blade', 'bolt', 'bridge', 'brook', 'cabin', 'cable', 'cave', 'cedar', 'cliff',
  'cloud', 'comet', 'coral', 'creek', 'crest', 'dawn', 'delta', 'depot', 'drift',
  'dune', 'echo', 'elm', 'ember', 'falcon', 'fern', 'field', 'fjord', 'flare',
  'fleet', 'flint', 'flume', 'foam', 'forge', 'frost', 'gale', 'gate', 'glade',
  'glow', 'gorge', 'grove', 'gulf', 'harbor', 'haven', 'hawk', 'heath', 'hollow',
  'horn', 'inlet', 'jade', 'kettle', 'knoll', 'lake', 'larch', 'lava', 'leaf',
  'ledge', 'mast', 'meadow', 'mesa', 'mill', 'mist', 'moor', 'moss', 'nexus',
  'oak', 'orbit', 'peak', 'petal', 'pine', 'pixel', 'plume', 'pond', 'pulse',
  'quill', 'raven', 'reef', 'ridge', 'river', 'rock', 'root', 'sand', 'shore',
  'slope', 'smoke', 'spark', 'spire', 'spring', 'spur', 'stone', 'storm',
  'surge', 'tide', 'timber', 'torch', 'trail', 'vale', 'vault', 'vine', 'wake',
  'wave', 'well', 'wind', 'wing', 'wood', 'yard',
]

function generateName(templateId) {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${templateId}-${adj}-${noun}`
}

export default function TemplateDetailModal({ template, pluginActive, onClose, onProvision }) {
  const [tab, setTab] = useState('overview')
  const [code, setCode] = useState(null)
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeError, setCodeError] = useState(null)
  const [form, setForm] = useState(() => ({
    name: generateName(template.id),
    instance_type: 't3.micro',
    port: template.defaultPort >= 1024 ? template.defaultPort : '',
    ttl_hours: 30 / 3600
  }))
  const [errors, setErrors] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (tab !== 'code' || code !== null) return
    setCodeLoading(true)
    fetch(`/api/templates/${template.id}/code`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
        setCode(data.code)
      })
      .catch((e) => setCodeError(e.message))
      .finally(() => setCodeLoading(false))
  }, [tab, code, template.id])

  async function submit() {
    setSubmitting(true)
    setErrors([])
    try {
      await onProvision({
        name: form.name,
        template: template.id,
        instance_type: form.instance_type,
        port: Number(form.port),
        ttl_hours: Number(form.ttl_hours)
      })
    } catch (err) {
      if (err.violations) setErrors(err.violations.map((v) => v.message))
      else setErrors([err.error || 'Provisioning failed'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header detail-header">
          <div className="detail-header-main">
            <span className="detail-icon">{template.icon || '◆'}</span>
            <div>
              <div className="detail-name">{template.name}</div>
              {template.subtitle && <div className="detail-subtitle">{template.subtitle}</div>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="detail-tabs">
          <button className={tab === 'overview' ? 'tab tab-active' : 'tab'} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'code' ? 'tab tab-active' : 'tab'} onClick={() => setTab('code')}>Terraform code</button>
          <button className={tab === 'provision' ? 'tab tab-active' : 'tab'} onClick={() => setTab('provision')}>Provision</button>
        </div>

        <div className="modal-body detail-body">
          {tab === 'overview' && (
            <Overview template={template} pluginActive={pluginActive} />
          )}
          {tab === 'code' && (
            <CodeView loading={codeLoading} error={codeError} code={code} />
          )}
          {tab === 'provision' && (
            <ProvisionForm
              template={template}
              form={form}
              setForm={setForm}
              errors={errors}
              pluginActive={pluginActive}
            />
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {tab === 'provision' && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={submitting || !form.name || !pluginActive}
              title={!pluginActive ? 'Activate the required plugin first' : ''}
            >
              {submitting ? 'Sending to Terraform…' : 'Provision Environment'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Overview({ template, pluginActive }) {
  return (
    <>
      <div className="detail-desc">{template.description}</div>

      <div className="detail-section">
        <div className="detail-section-title">Resources provisioned</div>
        <div className="resource-table">
          {(template.resources || []).map((r, i) => (
            <div key={i} className="resource-row">
              <span className="resource-type">{r.type}</span>
              <span className="resource-name">{r.name}</span>
              <span className="resource-desc">{r.description}</span>
            </div>
          ))}
          {(!template.resources || template.resources.length === 0) && (
            <div className="resource-empty">No declared resources.</div>
          )}
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">Plugins required</div>
        <div className="plugin-pills">
          {(template.requiredPlugins || []).map((id) => (
            <span key={id} className="plugin-pill">{id}</span>
          ))}
          {(!template.requiredPlugins || template.requiredPlugins.length === 0) && (
            <span className="plugin-pill plugin-pill-none">none</span>
          )}
        </div>
      </div>

      {!pluginActive && (template.requiredPlugins || []).length > 0 && (
        <div className="detail-warning">
          ⚠ None of this template's required plugins are active.{' '}
          <Link to="/plugins" className="detail-link">Open Plugins page →</Link>
        </div>
      )}
    </>
  )
}

function CodeView({ loading, error, code }) {
  if (loading) return <div className="code-loading">Loading main.tf…</div>
  if (error) return <div className="code-error">✕ {error}</div>
  return (
    <pre className="code-block"><code>{code}</code></pre>
  )
}

function ProvisionForm({ template, form, setForm, errors, pluginActive }) {
  const hasEC2 = template.resources?.some((r) => r.type === 'aws_instance')
  const hasPort = template.defaultPort >= 1024

  function reroll() {
    setForm((f) => ({ ...f, name: generateName(template.id) }))
  }

  return (
    <>
      {!pluginActive && (
        <div className="detail-warning">
          ⚠ Required plugin is not active. Provisioning is disabled until you{' '}
          <Link to="/plugins" className="detail-link">activate it</Link>.
        </div>
      )}

      <div className="field">
        <label className="label">Environment name</label>
        <div className="name-input-row">
          <input
            type="text"
            placeholder={`${template.id}-swift-peak`}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <button type="button" className="btn-reroll" onClick={reroll} title="Generate a new name">
            ⟳
          </button>
        </div>
        <span className="field-hint">Lowercase, hyphens only.</span>
      </div>

      {(hasEC2 || hasPort) && (
        <div className="field-row">
          {hasEC2 && (
            <div className="field">
              <label className="label">Instance type</label>
              <select value={form.instance_type} onChange={(e) => setForm((f) => ({ ...f, instance_type: e.target.value }))}>
                {INSTANCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {hasPort && (
            <div className="field">
              <label className="label">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              />
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label className="label">TTL, auto-destroy after</label>
        <select value={form.ttl_hours} onChange={(e) => setForm((f) => ({ ...f, ttl_hours: Number(e.target.value) }))}>
          <option value={30 / 3600}>30s — demo</option>
          {[1, 4, 8, 12, 24, 48, 72].map((h) => (
            <option key={h} value={h}>{h}h{h === 24 ? ' (default)' : ''}</option>
          ))}
        </select>
      </div>

      <div className="policy-notice">
        <div className="policy-notice-title">▲ POLICY GUARDRAILS</div>
        <div className="policy-notice-rules">
          {hasEC2 && <span>Max t3.small</span>}
          <span>TTL 30s–72h required</span>
          <span>Lowercase name only</span>
          {hasPort && <span>Port 1024–9999</span>}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="modal-errors">
          {errors.map((e, i) => (
            <div key={i} className="modal-error">✕ {e}</div>
          ))}
        </div>
      )}
    </>
  )
}
