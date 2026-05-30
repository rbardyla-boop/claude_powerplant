import fs from 'fs'
import path from 'path'

export type StackId = 'node-ts' | 'python' | 'go' | 'rust' | 'generic'

const DETECTION_ORDER: Array<{ file: string; stack: StackId }> = [
  { file: 'package.json', stack: 'node-ts' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
]

const PROFILE_MAP: Record<StackId, string> = {
  'node-ts': 'node-vitest-typescript-v1',
  'python': 'subprocess-python-v1',
  'go': 'subprocess-go-v1',
  'rust': 'subprocess-generic-v1',
  'generic': 'subprocess-generic-v1',
}

export function detectStack(projectPath: string): StackId {
  let absPath: string
  try {
    absPath = path.resolve(projectPath)
  } catch {
    return 'generic'
  }

  for (const { file, stack } of DETECTION_ORDER) {
    try {
      if (fs.existsSync(path.join(absPath, file))) {
        return stack
      }
    } catch {
      // non-existent or inaccessible path — skip
    }
  }

  return 'generic'
}

export function stackToProfile(stack: StackId): string {
  return PROFILE_MAP[stack]
}
