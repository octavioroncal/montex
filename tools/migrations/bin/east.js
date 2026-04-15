#!/usr/bin/env node

const Path = require('node:path')
const { spawnSync } = require('node:child_process')

const runnerPath = Path.resolve(__dirname, '../scripts/runner.mjs')
const args = process.argv.slice(2).filter(arg => arg !== '--es-modules')

const result = spawnSync(process.execPath, [runnerPath, ...args], {
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status == null ? 1 : result.status)
