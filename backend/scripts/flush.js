#!/usr/bin/env node
// scripts/flush.js — wipe all Runway environments, audit log, terraform output,
// and the .runway-work directory by calling the running backend's admin API.
//
// Usage:
//   npm run flush                          # interactive — prompts y/N
//   npm run flush -- --yes                 # skip prompt
//   npm run flush -- --host 127.0.0.1:3001 # custom host

const { argv, stdin, stdout, exit } = require('node:process')
const { createInterface } = require('node:readline')

const args = argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return def
  const v = args[i + 1]
  return (!v || v.startsWith('--')) ? true : v
}

const host = flag('host', '127.0.0.1:3001')
const yes  = flag('yes', false) || flag('y', false)
const url  = `http://${host}/api/admin/flush`

function confirm(prompt) {
  if (yes) return Promise.resolve(true)
  const rl = createInterface({ input: stdin, output: stdout })
  return new Promise(r => rl.question(prompt, a => { rl.close(); r(/^y(es)?$/i.test(a.trim())) }))
}

;(async () => {
  const ok = await confirm(`This will permanently delete ALL environments, audit logs, and terraform work on ${host}.\nContinue? [y/N] `)
  if (!ok) { console.log('Aborted.'); exit(1) }

  let r
  try {
    r = await fetch(url, { method: 'POST' })
  } catch (e) {
    console.error(`Failed to reach Runway backend at ${host}: ${e.message}`)
    console.error('Is it running? Start it with: npm start')
    exit(1)
  }

  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    console.error(`Flush failed: HTTP ${r.status} — ${data.error || ''}`)
    exit(1)
  }

  console.log('✓ Flush complete')
  console.log(`  Environments deleted: ${data.environmentsDeleted ?? 0}`)
  console.log(`  Work directory removed: ${data.workDirRemoved ? 'yes' : 'no'}`)
})()
