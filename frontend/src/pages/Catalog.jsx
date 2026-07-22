import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEnvironments } from '../hooks/useEnvironments'
import TemplateDetailModal from '../components/TemplateDetailModal'
import './Catalog.css'

const PLUGIN_GROUPS = [
  { id: 'docker',    label: 'Docker',    description: 'Local container stacks' },
  { id: 'mockcloud', label: 'MockCloud', description: 'Cloud templates against the local emulator' },
  { id: 'aws',       label: 'AWS',       description: 'Cloud templates against real AWS' }
]

export default function Catalog() {
  const [templates, setTemplates] = useState([])
  const [allTemplates, setAllTemplates] = useState([])
  const [plugins, setPlugins] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const { provision } = useEnvironments()
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    try {
      const [visibleRes, allRes, pluginRes] = await Promise.all([
        fetch('/api/templates').then((r) => r.json()),
        fetch('/api/templates?all=true').then((r) => r.json()),
        fetch('/api/plugins').then((r) => r.json())
      ])
      setTemplates(visibleRes)
      setAllTemplates(allRes)
      setPlugins(pluginRes)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const activePluginIds = useMemo(
    () => new Set(plugins.filter((p) => p.status === 'active').map((p) => p.id)),
    [plugins]
  )

  const grouped = useMemo(() => {
    const buckets = new Map(PLUGIN_GROUPS.map((g) => [g.id, []]))
    for (const t of allTemplates) {
      for (const pid of t.requiredPlugins || []) {
        if (buckets.has(pid)) buckets.get(pid).push(t)
      }
    }
    return buckets
  }, [allTemplates])

  function pluginActiveForTemplate(t) {
    return (t.requiredPlugins || []).some((id) => activePluginIds.has(id))
  }

  async function handleProvision(payload) {
    const result = await provision(payload)
    setSelected(null)
    navigate(`/dashboard?highlight=${result.id}`)
  }

  return (
    <div className="catalog">
      <div className="page-header">
        <div className="page-title">Service Catalog</div>
        <div className="page-subtitle">
          Pick a composite template to provision. Click any card for details, resources, and Terraform source.
        </div>
      </div>

      {loading ? (
        <div className="catalog-loading">Loading catalog…</div>
      ) : (
        PLUGIN_GROUPS.map((group) => {
          const items = grouped.get(group.id) || []
          const active = activePluginIds.has(group.id)
          return (
            <PluginGroup
              key={group.id}
              group={group}
              templates={items}
              pluginActive={active}
              onSelect={setSelected}
            />
          )
        })
      )}

      {selected && (
        <TemplateDetailModal
          template={selected}
          pluginActive={pluginActiveForTemplate(selected)}
          onClose={() => setSelected(null)}
          onProvision={handleProvision}
        />
      )}
    </div>
  )
}

function PluginGroup({ group, templates, pluginActive, onSelect }) {
  return (
    <section className="catalog-group">
      <div className="catalog-group-head">
        <div>
          <div className="catalog-group-title">{group.label}</div>
          <div className="catalog-group-desc">{group.description}</div>
        </div>
        <span className={`badge ${pluginActive ? 'badge-active' : 'badge-inactive'}`}>
          {pluginActive ? 'PLUGIN ACTIVE' : 'PLUGIN INACTIVE'}
        </span>
      </div>

      {templates.length === 0 ? (
        <div className="catalog-empty">No templates registered for this plugin.</div>
      ) : !pluginActive ? (
        <div className="catalog-locked">
          <div>{templates.length} template{templates.length === 1 ? '' : 's'} available — activate the {group.label} plugin to provision.</div>
          <Link to="/plugins" className="catalog-locked-link">Open Plugins page →</Link>
        </div>
      ) : null}

      <div className="template-grid">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`template-card ${pluginActive ? '' : 'template-card-disabled'}`}
            onClick={() => onSelect(t)}
          >
            <div className="template-icon">{t.icon || '◆'}</div>
            <div className="template-info">
              <div className="template-name">
                {t.name}
                {t.subtitle && <span className="template-subtitle"> — {t.subtitle}</span>}
              </div>
              <div className="template-desc">{t.description}</div>
              <div className="template-tags">
                {(t.tags || []).map((tag) => <span key={tag} className="tag">{tag}</span>)}
              </div>
            </div>
            <div className="template-action">
              Details <span>→</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
