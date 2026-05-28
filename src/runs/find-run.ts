import fs from 'fs'
import path from 'path'
import os from 'os'

export const POWERPLANT_RUNS_HOME = path.join(os.homedir(), '.powerplant', 'runs')

export function findRunDirectory(runId: string): string | null {
  if (!fs.existsSync(POWERPLANT_RUNS_HOME)) return null
  for (const projectDir of fs.readdirSync(POWERPLANT_RUNS_HOME)) {
    const candidate = path.join(POWERPLANT_RUNS_HOME, projectDir, runId)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }
  return null
}

export function makeRunArtifactDirectory(projectId: string, runId: string): string {
  const dir = path.join(POWERPLANT_RUNS_HOME, projectId, runId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
