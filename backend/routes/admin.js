const express = require('express')
const path = require('path')
const fs = require('fs')
const { getDb, envQueries } = require('../lib/db')

const router = express.Router()
const WORK_DIR = path.join(__dirname, '../../.runway-work')

// POST /api/admin/flush — wipe all environments, audit log, terraform output
// logs, and the .runway-work directory. Does not stop in-flight terraform
// processes — caller should wait for active provisions to finish first.
router.post('/flush', (req, res) => {
  const before = {
    environments: envQueries.getAll().length,
  }

  const db = getDb()
  db.run('DELETE FROM env_logs')
  db.run('DELETE FROM audit_log')
  db.run('DELETE FROM environments')

  // Persist the empty DB to disk
  const fsLocal = require('fs')
  const dbPath = path.join(__dirname, '../../runway.db')
  fsLocal.writeFileSync(dbPath, Buffer.from(db.export()))

  // Wipe terraform work directories — on Windows, individual env dirs may be
  // locked by lingering terraform processes; skip those and report them.
  let workDirsRemoved = 0
  let workDirsSkipped = 0

  if (fs.existsSync(WORK_DIR)) {
    let subdirs = []
    try {
      subdirs = fs.readdirSync(WORK_DIR)
    } catch (_) {
      // Can't even list — skip the whole thing
      workDirsSkipped++
    }

    for (const sub of subdirs) {
      const subPath = path.join(WORK_DIR, sub)
      try {
        fs.rmSync(subPath, { recursive: true, force: true })
        workDirsRemoved++
      } catch (_) {
        workDirsSkipped++
      }
    }

    // Remove the parent dir itself if all children were cleared
    if (workDirsSkipped === 0) {
      try { fs.rmSync(WORK_DIR, { recursive: true, force: true }) } catch (_) {}
    }
  }

  res.json({
    flushed: true,
    environmentsDeleted: before.environments,
    workDirRemoved: workDirsSkipped === 0,
    workDirsRemoved,
    workDirsSkipped,
  })
})

module.exports = router
