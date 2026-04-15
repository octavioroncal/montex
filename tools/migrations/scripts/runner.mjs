#!/usr/bin/env node

import Fs from 'node:fs/promises'
import Path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIGRATION_FILENAME_REGEX = /^\d{14}_.+\.mjs$/
const MIGRATION_EXTENSION = '.mjs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = Path.dirname(__filename)
const TEMPLATE_PATH = Path.resolve(__dirname, '../lib/20000000000000_template.mjs')

function printHelp() {
  console.log('Usage: east <command> [options] [migrations...]')
  console.log('')
  console.log('Commands:')
  console.log('  create <name>')
  console.log('  list [new|executed|all] -t <tag>[,<tag2>]')
  console.log('  migrate -t <tag>[,<tag2>] [--force] [migrations...]')
  console.log('  rollback -t <tag>[,<tag2>] [migrations...]')
}

function parseArgs(argv) {
  const tags = []
  let force = false
  let command = null
  const positionals = []

  const optionsWithValue = new Set([
    '--config',
    '--adapter',
    '--template',
    '--dir',
    '--url',
    '--timeout',
  ])

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      return { help: true }
    }

    if (arg === '--force') {
      force = true
      continue
    }

    if (arg === '--es-modules') {
      continue
    }

    if (arg === '-t' || arg === '--tag' || arg === '--tags') {
      const value = argv[i + 1]
      if (!value) {
        throw new Error(`Missing value for option ${arg}`)
      }
      tags.push(value)
      i++
      continue
    }

    if (
      arg.startsWith('--tag=') ||
      arg.startsWith('--tags=') ||
      arg.startsWith('-t=')
    ) {
      const value = arg.slice(arg.indexOf('=') + 1)
      if (value) {
        tags.push(value)
      }
      continue
    }

    if (optionsWithValue.has(arg)) {
      i++
      continue
    }

    if (arg.startsWith('-') && !command) {
      // Ignore unknown global flags for compatibility.
      continue
    }

    if (!command) {
      command = arg
      continue
    }

    positionals.push(arg)
  }

  return {
    help: false,
    command,
    force,
    tags: tags
      .flatMap(tag => tag.split(','))
      .map(tag => tag.trim())
      .filter(Boolean),
    positionals,
  }
}

function normalizeMigrationName(name) {
  return name.endsWith(MIGRATION_EXTENSION)
    ? name.slice(0, -MIGRATION_EXTENSION.length)
    : name
}

function toDateTimeNumber(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  )
}

function sanitizeBaseName(baseName) {
  return baseName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

function migrationHasTag(migration, tags) {
  if (tags.length === 0) return true
  if (!Array.isArray(migration.tags)) return false
  return tags.some(tag => migration.tags.includes(tag))
}

function assertTagsIfRequired(command, tags) {
  if (process.env.SKIP_TAG_CHECK === 'true') return
  if (command === 'create') return
  if (tags.length === 0) {
    throw new Error("ERROR: must pass tags using '-t' or '--tag'")
  }
}

async function loadMigrations(cwd) {
  const entries = await Fs.readdir(cwd, { withFileTypes: true })
  const migrationEntries = entries
    .filter(entry => entry.isFile() && MIGRATION_FILENAME_REGEX.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  const migrations = []
  for (const entry of migrationEntries) {
    const fullPath = Path.join(cwd, entry.name)
    const moduleUrl = pathToFileURL(fullPath).href
    const loaded = await import(moduleUrl)
    const migration = loaded.default || {}

    migrations.push({
      name: normalizeMigrationName(entry.name),
      fileName: entry.name,
      tags: Array.isArray(migration.tags) ? migration.tags : [],
      migrate: migration.migrate,
      rollback: migration.rollback,
    })
  }

  return migrations
}

function mapMigrationsByName(migrations) {
  const byName = new Map()
  for (const migration of migrations) {
    byName.set(migration.name, migration)
  }
  return byName
}

async function createMigration(baseName, templatePath, cwd) {
  if (!baseName) {
    throw new Error('Missing migration name')
  }

  const safeBaseName = sanitizeBaseName(baseName)
  if (!safeBaseName) {
    throw new Error('Migration name is invalid after sanitization')
  }

  const template = await Fs.readFile(templatePath, 'utf8')

  let timestamp = toDateTimeNumber()
  let fileName = `${timestamp}_${safeBaseName}${MIGRATION_EXTENSION}`
  let fullPath = Path.join(cwd, fileName)

  while (true) {
    try {
      await Fs.access(fullPath)
      timestamp = String(Number(timestamp) + 1)
      fileName = `${timestamp}_${safeBaseName}${MIGRATION_EXTENSION}`
      fullPath = Path.join(cwd, fileName)
    } catch {
      break
    }
  }

  await Fs.writeFile(fullPath, template, 'utf8')
  console.log(`Created ${fileName}`)
}

async function listMigrations({ migrations, executedNames, tags, status }) {
  const statusFilter = status || 'new'
  if (!['new', 'executed', 'all'].includes(statusFilter)) {
    throw new Error(`Unknown list status: ${statusFilter}`)
  }

  const filtered = migrations
    .filter(migration => migrationHasTag(migration, tags))
    .filter(migration => {
      const executed = executedNames.has(migration.name)
      if (statusFilter === 'new') return !executed
      if (statusFilter === 'executed') return executed
      return true
    })

  for (const migration of filtered) {
    console.log(migration.name)
  }
}

function resolveTargetMigrations(migrationsByName, names) {
  const targets = []
  for (const rawName of names) {
    const name = normalizeMigrationName(rawName)
    const migration = migrationsByName.get(name)
    if (!migration) {
      throw new Error(`Migration not found: ${rawName}`)
    }
    targets.push(migration)
  }
  return targets
}

async function migrate({
  migrations,
  migrationsByName,
  executedNames,
  tags,
  names,
  force,
  adapter,
  client,
}) {
  let targets = names.length
    ? resolveTargetMigrations(migrationsByName, names)
    : migrations.filter(migration => migrationHasTag(migration, tags))

  if (!names.length) {
    targets = targets.filter(migration => !executedNames.has(migration.name))
  } else {
    targets = targets.filter(migration => {
      if (!migrationHasTag(migration, tags)) {
        throw new Error(
          `Migration ${migration.name} does not match any requested tag`
        )
      }
      if (!force && executedNames.has(migration.name)) {
        console.log(`Skipping ${migration.name} (already executed)`)
        return false
      }
      return true
    })
  }

  for (const migration of targets) {
    if (typeof migration.migrate !== 'function') {
      throw new Error(`Migration ${migration.name} is missing migrate()`)
    }

    console.log(`Migrating ${migration.name}`)
    await migration.migrate(client)

    if (!executedNames.has(migration.name)) {
      await adapter.markExecuted(migration.name)
      executedNames.add(migration.name)
    }
  }
}

async function rollback({
  migrations,
  migrationsByName,
  executedNames,
  tags,
  names,
  adapter,
  client,
}) {
  let targets
  if (names.length) {
    targets = resolveTargetMigrations(migrationsByName, names).reverse()
  } else {
    targets = migrations
      .filter(
        migration =>
          migrationHasTag(migration, tags) && executedNames.has(migration.name)
      )
      .reverse()
  }

  for (const migration of targets) {
    if (!executedNames.has(migration.name)) {
      console.log(`Skipping ${migration.name} (not executed)`)
      continue
    }

    if (typeof migration.rollback !== 'function') {
      throw new Error(`Migration ${migration.name} is missing rollback()`)
    }

    console.log(`Rolling back ${migration.name}`)
    await migration.rollback(client)
    await adapter.unmarkExecuted(migration.name)
    executedNames.delete(migration.name)
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))

  if (parsed.help || !parsed.command) {
    printHelp()
    process.exit(parsed.help ? 0 : 1)
  }

  const { command, tags, force, positionals } = parsed
  assertTagsIfRequired(command, tags)

  const cwd = process.cwd()
  if (command === 'create') {
    await createMigration(positionals[0], TEMPLATE_PATH, cwd)
    return
  }

  process.env.SKIP_TAG_CHECK = 'true'
  const { default: Adapter } = await import('../lib/adapter.mjs')
  const adapter = new Adapter()
  const client = await adapter.connect()

  try {
    const migrations = await loadMigrations(cwd)
    const migrationsByName = mapMigrationsByName(migrations)
    const executedNames = new Set(await adapter.getExecutedMigrationNames())

    if (command === 'list') {
      await listMigrations({
        migrations,
        executedNames,
        tags,
        status: positionals[0],
      })
      return
    }

    if (command === 'migrate') {
      await migrate({
        migrations,
        migrationsByName,
        executedNames,
        tags,
        names: positionals,
        force,
        adapter,
        client,
      })
      return
    }

    if (command === 'rollback') {
      await rollback({
        migrations,
        migrationsByName,
        executedNames,
        tags,
        names: positionals,
        adapter,
        client,
      })
      return
    }

    throw new Error(`Unknown command: ${command}`)
  } finally {
    await adapter.disconnect()
  }
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
