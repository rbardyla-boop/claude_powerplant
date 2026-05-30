#!/usr/bin/env node
/**
 * Road to Usable end-to-end smoke.
 *
 * Run:   node --import=tsx scripts/smoke-road-to-usable.ts
 *    or: npm run smoke:road-to-usable
 *
 * Uses throwaway temp directories. ANTHROPIC_API_KEY is NOT required.
 * Exercises: init → review → approve (dry-run) → session create/status/list.
 * Does NOT exercise live `powerplant run` (requires API key).
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

// ── Constants ──────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const POWERPLANT_ENTRY = path.join(REPO_ROOT, 'src', 'cli', 'powerplant.ts')
const RUNS_HOME = path.join(os.homedir(), '.powerplant', 'runs')

// ── Step tracking ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const cleanupFns: Array<() => void> = []

function step(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark}  ${label}${detail ? ' — ' + detail : ''}`)
  if (ok) passed++
  else failed++
}

process.on('exit', () => {
  for (const fn of [...cleanupFns].reverse()) {
    try { fn() } catch { /* ignore */ }
  }
})
process.on('SIGINT', () => { process.exit(2) })

// ── CLI invocation helper ─────────────────────────────────────────────────────

function pp(args: string[], env?: Record<string, string>): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(TSX_BIN, [POWERPLANT_ENTRY, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    cwd: REPO_ROOT,
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ── Artifact helpers ──────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function buildPatch(file: string, from: string, to: string): string {
  const a = from.split('\n').slice(0, -1)
  const b = to.split('\n').slice(0, -1)
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.map(l => `-${l}`),
    ...b.map(l => `+${l}`),
    '',
  ].join('\n')
}

// ── Node/TS project smoke ─────────────────────────────────────────────────────

console.log('\n=== Road to Usable — End-to-End Smoke ===\n')
console.log('Node/TS project:\n')

const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-node-'))
cleanupFns.push(() => fs.rmSync(nodeDir, { recursive: true, force: true }))

const pkgContent = JSON.stringify({ name: 'smoke-node-project', version: '1.0.0', type: 'module' }, null, 2) + '\n'
const indexContent = 'export const greet = (name: string) => `Hello, ${name}!`\n'

fs.writeFileSync(path.join(nodeDir, 'package.json'), pkgContent)
fs.writeFileSync(path.join(nodeDir, 'index.ts'), indexContent)

spawnSync('git', ['init'], { cwd: nodeDir })
spawnSync('git', ['config', 'user.email', 'smoke@powerplant.local'], { cwd: nodeDir })
spawnSync('git', ['config', 'user.name', 'Powerplant Smoke'], { cwd: nodeDir })
spawnSync('git', ['add', '-A'], { cwd: nodeDir })
spawnSync('git', ['commit', '-m', 'init'], { cwd: nodeDir })

step('create temp Node/TS project (git init + commit)', fs.existsSync(path.join(nodeDir, 'package.json')))

// ── Step 2: powerplant init --yes ─────────────────────────────────────────────

const initResult = pp(['init', '--yes', nodeDir])
const policyPath = path.join(nodeDir, '.powerplant', 'POLICY.yaml')
const verifyPath = path.join(nodeDir, '.powerplant', 'VERIFY.yaml')

const firstLine = initResult.stdout.split('\n').find(l => l.trim()) ?? ''
step('powerplant init --yes (node-ts)', initResult.status === 0, initResult.status !== 0 ? (initResult.stderr.trim() || firstLine) : firstLine)

// ── Step 3: verify POLICY.yaml and VERIFY.yaml ────────────────────────────────

const policyContent = fs.existsSync(policyPath) ? fs.readFileSync(policyPath, 'utf-8') : ''
const verifyContent = fs.existsSync(verifyPath) ? fs.readFileSync(verifyPath, 'utf-8') : ''
step('POLICY.yaml present and non-empty', policyContent.length > 0)
step('VERIFY.yaml present and non-empty', verifyContent.length > 0)
step('VERIFY.yaml contains node-vitest-typescript-v1', verifyContent.includes('node-vitest-typescript-v1'))

// Extract projectId from POLICY.yaml
const projectIdMatch = policyContent.match(/projectId:\s*(\S+)/)
const projectId = projectIdMatch ? projectIdMatch[1]! : `smoke-fallback-${Date.now()}`

// ── Step 4: create synthetic run artifact ─────────────────────────────────────

const runId = `pp-smoke-${Date.now()}-node`
const runDir = path.join(RUNS_HOME, projectId, runId)
fs.mkdirSync(runDir, { recursive: true })
cleanupFns.push(() => {
  try { fs.rmSync(path.join(RUNS_HOME, projectId), { recursive: true, force: true }) } catch { /* */ }
})

// Read actual hashes AFTER init (package.json and index.ts are unchanged)
const actualPkg = fs.readFileSync(path.join(nodeDir, 'package.json'), 'utf-8')
const actualIndex = fs.readFileSync(path.join(nodeDir, 'index.ts'), 'utf-8')
const patchContent = buildPatch('index.ts', actualIndex, `// smoke\n${actualIndex}`)

fs.writeFileSync(path.join(runDir, 'TASK.md'), 'Add a smoke comment to index.ts')
fs.writeFileSync(path.join(runDir, 'PATCH.diff'), patchContent)
fs.writeFileSync(path.join(runDir, 'SOURCE_MANIFEST.json'), JSON.stringify({
  projectId,
  sourcePath: nodeDir,
  capturedAt: new Date().toISOString(),
  files: [
    { relativePath: 'package.json', sha256: sha256(actualPkg) },
    { relativePath: 'index.ts', sha256: sha256(actualIndex) },
  ],
}))
fs.writeFileSync(path.join(runDir, 'SESSION_SUMMARY.json'), JSON.stringify({
  runId,
  passed: true,
  builtInToolUseCount: 0,
  originalProjectMounted: false,
  clearedForRealProjectMounting: false,
  clearedForSanitizedExternalProjectInput: false,
}))

step('synthetic run artifact written', fs.existsSync(path.join(runDir, 'TASK.md')))

// ── Step 5: powerplant review --json ─────────────────────────────────────────

const reviewJson = pp(['review', runId, '--json'])
let reviewState: { runId?: string } | null = null
try { reviewState = JSON.parse(reviewJson.stdout) } catch { /* */ }
step('powerplant review --json exits 0', reviewJson.status === 0, reviewJson.status !== 0 ? reviewJson.stderr.trim() : '')
step('review --json emits valid JSON with correct runId', reviewState?.runId === runId)

// ── Step 6: powerplant review --diff ─────────────────────────────────────────

const reviewDiff = pp(['review', runId, '--diff'])
step('powerplant review --diff exits 0', reviewDiff.status === 0, reviewDiff.status !== 0 ? reviewDiff.stderr.trim() : '')

// ── Step 7: powerplant approve --dry-run ─────────────────────────────────────

const approveDry = pp(['approve', runId, '--dry-run'])
step(
  'powerplant approve --dry-run exits 0',
  approveDry.status === 0,
  approveDry.status !== 0 ? (approveDry.stderr.trim() || approveDry.stdout.trim()) : '',
)
step('approve dry-run shows evidence hash', approveDry.stdout.includes('Evidence hash:'))
step('approve dry-run shows patch applies', approveDry.stdout.includes('Patch applies:'))

// ── Step 8: powerplant session create ────────────────────────────────────────

const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-home-'))
cleanupFns.push(() => fs.rmSync(smokeHome, { recursive: true, force: true }))

const sessionCreate = pp(['session', 'create', nodeDir], { POWERPLANT_HOME: smokeHome })
const sessionIdMatch = sessionCreate.stdout.match(/ID:\s+(\S+)/)
const sessionId = sessionIdMatch ? sessionIdMatch[1]! : null

step('powerplant session create exits 0', sessionCreate.status === 0, sessionCreate.status !== 0 ? sessionCreate.stderr.trim() : '')
step('session create reports session ID', sessionId !== null, sessionId ?? '(ID not found in output)')

// ── Step 9: powerplant session status ────────────────────────────────────────

if (sessionId) {
  const sessionStatus = pp(['session', 'status', sessionId], { POWERPLANT_HOME: smokeHome })
  step('powerplant session status exits 0', sessionStatus.status === 0, sessionStatus.status !== 0 ? sessionStatus.stderr.trim() : '')
  step('session status reports open', sessionStatus.stdout.includes('open'))
} else {
  step('powerplant session status (skipped — session ID not captured)', false)
  step('session status reports open (skipped)', false)
}

// ── Step 10: powerplant session list ─────────────────────────────────────────

const sessionList = pp(['session', 'list'], { POWERPLANT_HOME: smokeHome })
step('powerplant session list exits 0', sessionList.status === 0, sessionList.status !== 0 ? sessionList.stderr.trim() : '')

// ── Python project smoke ──────────────────────────────────────────────────────

console.log('\nPython project:\n')

const pyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-python-'))
cleanupFns.push(() => fs.rmSync(pyDir, { recursive: true, force: true }))

fs.writeFileSync(path.join(pyDir, 'pyproject.toml'), '[project]\nname = "smoke-python-project"\nversion = "0.1.0"\n')
step('create temp Python project', fs.existsSync(path.join(pyDir, 'pyproject.toml')))

// ── Step 12: powerplant init --yes (python) ───────────────────────────────────

const pyInit = pp(['init', '--yes', pyDir])
const pyPolicyPath = path.join(pyDir, '.powerplant', 'POLICY.yaml')
const pyFirstLine = pyInit.stdout.split('\n').find(l => l.trim()) ?? ''
step('powerplant init --yes (python)', pyInit.status === 0, pyInit.status !== 0 ? (pyInit.stderr.trim() || pyFirstLine) : pyFirstLine)

// ── Step 13: verify python VERIFY.yaml has pytest check, no capsule profile ──

const pyPolicy = fs.existsSync(pyPolicyPath) ? fs.readFileSync(pyPolicyPath, 'utf-8') : ''
const pyVerifyPath = path.join(pyDir, '.powerplant', 'VERIFY.yaml')
const pyVerify = fs.existsSync(pyVerifyPath) ? fs.readFileSync(pyVerifyPath, 'utf-8') : ''
// No capsule image shipped for python yet; verificationProfile is intentionally omitted.
step('VERIFY.yaml has pytest check, no capsule profile (not yet shipped)', pyVerify.includes('pytest') && !pyVerify.includes('verificationProfile'))
step('VERIFY.yaml present for Python project', fs.existsSync(pyVerifyPath))

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(52))
console.log('\nNon-claims (not tested here):')
console.log('  • powerplant run           — requires ANTHROPIC_API_KEY')
console.log('  • Live agent execution     — no API key, no Docker in smoke')
console.log('  • Stage 2C managed-agent   — gated, not exercised by default')
console.log('  • Python capsule isolation — Step 6, deferred')
console.log()

if (failed === 0) {
  console.log(`PASS  ${passed}/${passed + failed} steps`)
  process.exitCode = 0
} else {
  console.log(`FAIL  ${passed}/${passed + failed} steps, ${failed} failed`)
  process.exitCode = 1
}
