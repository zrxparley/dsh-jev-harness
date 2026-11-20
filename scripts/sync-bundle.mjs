#!/usr/bin/env node
/**
 * Single-source sync (#6): the git repo is the ONLY source of truth. This script
 * generates the local runtime bundle (`@local/jev-harness`, default ../jev-harness)
 * from the repo, so the two trees can never drift by hand-editing the copy.
 *
 *   node scripts/sync-bundle.mjs           sync repo -> bundle
 *   node scripts/sync-bundle.mjs --check   drift check only (CI): exit 1 if the
 *                                          bundle's shared files differ from the repo
 *
 * Why a script and not hand `cp`: the bundle needs more than a copy — its
 * package.json `name` must be @local/jev-harness while the repo publishes as
 * @zrxparley/dsh-jev-harness, and cordis.patch.yml's `name` line must match the
 * LOCAL package or the row fails to resolve (a real v1.5.0 packaging bug). Those
 * two rewrites are exactly what a human forgets. Version has ONE source:
 * repo package.json.
 *
 * No npm dependencies; runs on the bundled node directly (this machine has no npm).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = process.env.JEV_BUNDLE_DIR
  ? path.resolve(process.env.JEV_BUNDLE_DIR)
  : path.resolve(REPO, '..', 'jev-harness')
const LOCAL_NAME = '@local/jev-harness'
const CHECK = process.argv.includes('--check')

/** Files that must be byte-identical between repo and bundle after sync. */
const SHARED_FILES = ['index.js', 'skills.js', 'criteria.js', 'lib/client.js', 'icon.svg']
const SHARED_DIRS = ['locale']
const PATCH_FILE = 'cordis.patch.yml'

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const read = (file) => fs.readFileSync(file, 'utf8')

function fail(msg) {
  console.error(`\n[sync-bundle] ${msg}`)
  process.exit(1)
}

function repoVersion() {
  return JSON.parse(read(path.join(REPO, 'package.json'))).version
}

/** Rewrite the patch `name:` line to the local package name. */
function patchForBundle() {
  const src = read(path.join(REPO, PATCH_FILE))
  // Replace only the `name: '...'` value on the plugin row, keep everything else.
  return src.replace(/(name:\s*)'[^']*'/, `$1'${LOCAL_NAME}'`)
}

function bundlePackage() {
  const repoPkg = JSON.parse(read(path.join(REPO, 'package.json')))
  // The bundle keeps its own name but the version ALWAYS comes from the repo.
  return {
    ...repoPkg,
    name: LOCAL_NAME,
    version: repoPkg.version,
  }
}

function copyShared() {
  for (const rel of SHARED_FILES) {
    const from = path.join(REPO, rel)
    if (!fs.existsSync(from)) fail(`repo is missing required file ${rel}`)
    const to = path.join(BUNDLE, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  for (const dir of SHARED_DIRS) {
    const fromDir = path.join(REPO, dir)
    if (!fs.existsSync(fromDir)) continue
    for (const entry of fs.readdirSync(fromDir)) {
      const from = path.join(fromDir, entry)
      if (!fs.statSync(from).isFile()) continue
      const to = path.join(BUNDLE, dir, entry)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    }
  }
}

function writeGenerated() {
  fs.writeFileSync(path.join(BUNDLE, PATCH_FILE), patchForBundle())
  fs.writeFileSync(path.join(BUNDLE, 'package.json'), `${JSON.stringify(bundlePackage(), null, 2)}\n`, { mode: 0o600 })
}

function doSync() {
  fs.mkdirSync(BUNDLE, { recursive: true })
  copyShared()
  writeGenerated()
  console.log(`[sync-bundle] synced repo -> ${BUNDLE}`)
  console.log(`[sync-bundle] name=${LOCAL_NAME} version=${repoVersion()} (single source: repo package.json)`)
  // A sync that does not leave the trees identical is a bug; verify inline.
  doCheck()
}

function doCheck() {
  const problems = []
  for (const rel of SHARED_FILES) {
    const repoFile = path.join(REPO, rel)
    const bundleFile = path.join(BUNDLE, rel)
    if (!fs.existsSync(bundleFile)) { problems.push(`${rel}: missing in bundle`); continue }
    if (sha(repoFile) !== sha(bundleFile)) problems.push(`${rel}: content differs`)
  }
  for (const dir of SHARED_DIRS) {
    const fromDir = path.join(REPO, dir)
    if (!fs.existsSync(fromDir)) continue
    for (const entry of fs.readdirSync(fromDir)) {
      const rel = `${dir}/${entry}`
      const bundleFile = path.join(BUNDLE, rel)
      if (!fs.existsSync(bundleFile)) { problems.push(`${rel}: missing in bundle`); continue }
      if (sha(path.join(fromDir, entry)) !== sha(bundleFile)) problems.push(`${rel}: content differs`)
    }
  }
  // patch name must be the local package
  const patch = read(path.join(BUNDLE, PATCH_FILE))
  if (!patch.includes(`name: '${LOCAL_NAME}'`)) problems.push(`${PATCH_FILE}: name is not ${LOCAL_NAME}`)
  // version must match the repo
  const bundleVersion = JSON.parse(read(path.join(BUNDLE, 'package.json'))).version
  if (bundleVersion !== repoVersion()) problems.push(`package.json version ${bundleVersion} != repo ${repoVersion()}`)

  if (problems.length) {
    console.error(`\n[check:drift] bundle is OUT OF SYNC with the repo (${BUNDLE}):`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error(`\nRun \`node scripts/sync-bundle.mjs\` to regenerate the bundle from the repo (the only source).`)
    process.exit(1)
  }
  console.log(`[check:drift] OK — bundle matches repo (version ${repoVersion()}, ${SHARED_FILES.length + SHARED_DIRS.length} shared paths verified)`)
}

if (CHECK) doCheck()
else doSync()
