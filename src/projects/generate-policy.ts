import crypto from 'crypto'
import path from 'path'
import yaml from 'js-yaml'
import type { StackId } from './detect-stack.js'

const REQUIRED_EXCLUDES = [
  '.git/**',
  'node_modules/**',
  '.env',
  '.env.*',
  '**/*.key',
  '**/*.pem',
]

const DENY_IF_PRESENT = ['.env', '.git']

interface PolicyPaths {
  includePaths: string[]
  allowedReadPaths: string[]
  allowedWritePaths: string[]
}

// .powerplant contract files are always readable so the agent can reference them
const POWERPLANT_READ = ['.powerplant/POLICY.yaml', '.powerplant/VERIFY.yaml']

const STACK_PATHS: Record<StackId, PolicyPaths> = {
  'node-ts': {
    includePaths: ['src/**', 'tests/**', 'package.json', 'tsconfig.json'],
    allowedReadPaths: ['src/**', 'tests/**', 'package.json', 'tsconfig.json', ...POWERPLANT_READ],
    allowedWritePaths: ['src/**', 'tests/**'],
  },
  python: {
    // Uses **/*.py so both src/-layout and flat-package repos are covered.
    includePaths: ['**/*.py', 'tests/**', 'pyproject.toml', 'requirements.txt', 'requirements*.txt', 'setup.cfg'],
    allowedReadPaths: ['**/*.py', 'tests/**', 'pyproject.toml', 'requirements.txt', 'requirements*.txt', 'setup.cfg', ...POWERPLANT_READ],
    allowedWritePaths: ['**/*.py', 'tests/**'],
  },
  go: {
    includePaths: ['**/*.go', 'go.mod', 'go.sum'],
    allowedReadPaths: ['**/*.go', 'go.mod', 'go.sum', ...POWERPLANT_READ],
    allowedWritePaths: ['**/*.go'],
  },
  rust: {
    includePaths: ['**/*.rs', 'Cargo.toml', 'Cargo.lock'],
    allowedReadPaths: ['**/*.rs', 'Cargo.toml', 'Cargo.lock', ...POWERPLANT_READ],
    allowedWritePaths: ['**/*.rs'],
  },
  generic: {
    includePaths: ['src/**'],
    allowedReadPaths: ['src/**', ...POWERPLANT_READ],
    allowedWritePaths: ['src/**'],
  },
}

/**
 * Generate a deterministic-format project ID: <dirname>-<8 hex chars>.
 * Hex suffix is random so two inits in the same directory produce distinct IDs.
 */
export function generateProjectId(projectDir: string): string {
  const dirname = path.basename(path.resolve(projectDir))
  const hex = crypto.randomBytes(4).toString('hex')
  return `${dirname}-${hex}`
}

/**
 * Produce a POLICY.yaml string for the given stack and project ID.
 * Always includes the required security excludes.
 */
export function generatePolicyYaml(stack: StackId, projectId: string): string {
  const paths = STACK_PATHS[stack]
  const doc = {
    projectId,
    includePaths: paths.includePaths,
    excludePaths: REQUIRED_EXCLUDES,
    denyIfPresentAfterCopy: DENY_IF_PRESENT,
    allowedReadPaths: paths.allowedReadPaths,
    allowedWritePaths: paths.allowedWritePaths,
  }
  return yaml.dump(doc, { lineWidth: 120 })
}
