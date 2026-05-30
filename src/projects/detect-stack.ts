import fs from 'fs'
import path from 'path'

export type StackId = 'node-ts' | 'python' | 'go' | 'rust' | 'generic'

const DETECTION_ORDER: Array<{ file: string; stack: StackId }> = [
  { file: 'package.json', stack: 'node-ts' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
]

// Only stacks with a shipped capsule image get a non-null profile.
// All others fall back to plain subprocess execution.
const PROFILE_MAP: Record<StackId, string | null> = {
  'node-ts': 'node-vitest-typescript-v1',
  'python': null,
  'go': null,
  'rust': null,
  'generic': null,
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

export function stackToProfile(stack: StackId): string | null {
  return PROFILE_MAP[stack] ?? null
}
