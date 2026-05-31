import fs from 'fs'
import path from 'path'
import { loadProjectContract } from '../../projects/load-project-contract.js'
import { scanProject } from '../../scout/scan.js'
import { renderCandidatesJson, renderCandidatesMarkdown } from '../../scout/render-candidates.js'
import type { ScoutStatus } from '../../scout/scout-candidate.js'

// "No policy, no scout": Scout only reasons over a sanitized bundle, which only
// exists once a project contract has been declared.
function validateProjectPath(projectPath: string): string {
  const abs = path.resolve(projectPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Project path does not exist: ${abs}`)
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Project path is not a directory: ${abs}`)
  }
  if (!fs.existsSync(path.join(abs, '.powerplant', 'POLICY.yaml'))) {
    throw new Error(
      `No .powerplant/POLICY.yaml found in: ${abs}\n` +
      'Run `powerplant init` first — Scout never scans a project without a policy.',
    )
  }
  return abs
}

const STATUS_ORDER: ScoutStatus[] = ['RECOMMENDED', 'NEEDS_USER_DECISION', 'DEFER', 'REJECT']

/**
 * Make the advisory `.scout/` directory self-ignoring so it never pollutes a
 * clean-tree check in the target repo. `.scout/` is regenerated on every scan
 * and is never authoritative, so it should not appear in `git status`.
 */
export function writeScoutGitignore(scoutDir: string): void {
  fs.writeFileSync(path.join(scoutDir, '.gitignore'), '*\n', 'utf-8')
}

export async function cmdScout(rest: string[]): Promise<void> {
  const jsonMode = rest.includes('--json')
  const projectPath = rest.find(a => !a.startsWith('-')) ?? process.cwd()

  let absPath: string
  try {
    absPath = validateProjectPath(projectPath)
  } catch (err) {
    console.error(`Error: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  let contract
  try {
    contract = loadProjectContract(absPath)
  } catch (err) {
    console.error(`Error: Contract load failed — ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  let report
  try {
    report = scanProject(contract)
  } catch (err) {
    console.error(`Error during scout scan: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // Write advisory artifacts into the project's .scout/ directory.
  const scoutDir = path.join(absPath, '.scout')
  const candidatesDir = path.join(scoutDir, 'candidates')
  fs.mkdirSync(scoutDir, { recursive: true })
  // Keep .scout/ out of git so it never pollutes a clean-tree check.
  writeScoutGitignore(scoutDir)
  // Clear stale per-candidate files so old ids do not linger across scans.
  fs.rmSync(candidatesDir, { recursive: true, force: true })
  fs.mkdirSync(candidatesDir, { recursive: true })

  fs.writeFileSync(path.join(scoutDir, 'candidates.json'), renderCandidatesJson(report), 'utf-8')
  fs.writeFileSync(path.join(scoutDir, 'CANDIDATES.md'), renderCandidatesMarkdown(report), 'utf-8')
  for (const c of report.candidates) {
    fs.writeFileSync(path.join(candidatesDir, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n', 'utf-8')
  }

  if (jsonMode) {
    process.stdout.write(renderCandidatesJson(report))
    return
  }

  const counts = new Map<ScoutStatus, number>()
  for (const c of report.candidates) counts.set(c.status, (counts.get(c.status) ?? 0) + 1)

  console.log()
  console.log(`Scout: ${path.basename(absPath)} (${report.bundleFileCount} sanitized files)`)
  console.log(`Found ${report.candidates.length} candidate(s):`)
  for (const status of STATUS_ORDER) {
    const n = counts.get(status) ?? 0
    if (n > 0) console.log(`  ${status.padEnd(20)} ${n}`)
  }
  // Suppressed findings: candidate-shaped evidence the contract blocked.
  for (const s of report.suppressed) {
    console.log(`  ${s.count} ${s.domain} suppressed: ${s.reason} (e.g. ${s.example})`)
  }
  console.log()
  console.log(`  ${path.join(scoutDir, 'CANDIDATES.md')}`)
  console.log(`  ${path.join(scoutDir, 'candidates.json')}`)
  console.log()
  const firstActionable = report.candidates.find(
    c => c.status === 'RECOMMENDED' || c.status === 'NEEDS_USER_DECISION',
  )
  if (firstActionable) {
    console.log('Scout recommends. You select. Review the candidates, then turn one into a patch:')
    console.log(`  powerplant run ${projectPath} --candidate .scout/candidates/${firstActionable.id}.json`)
  } else {
    console.log('No actionable candidates. Scout never writes code or chains into a run on its own.')
  }
}
