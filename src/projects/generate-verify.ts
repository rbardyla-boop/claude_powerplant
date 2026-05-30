import yaml from 'js-yaml'
import type { StackId } from './detect-stack.js'
import { stackToProfile } from './detect-stack.js'
import { listKnownProfileIds } from '../verification/verification-profiles.js'

interface CheckDef {
  command: string
  required?: boolean
}

// defaultChecks from the roadmap stack→config table
const STACK_CHECKS: Record<StackId, Record<string, CheckDef>> = {
  'node-ts': {
    test: { command: 'npm test' },
    typecheck: { command: 'npx tsc --noEmit' },
  },
  python: {
    // python3 -m pytest: works without pytest in PATH; requires only system Python + installed pytest package.
    // See docs/VERIFY_PROFILE_CONSTRAINTS.md — bare `pytest` fails in subprocess isolation.
    test: { command: 'python3 -m pytest' },
  },
  go: {
    test: { command: 'go test ./...' },
  },
  rust: {
    // --workspace ensures all crates in a multi-crate workspace are built and tested.
    build: { command: 'cargo build --workspace' },
    test: { command: 'cargo test --workspace' },
    // Advisory: clippy and fmt are style/lint checks — failures are informational, not blocking.
    clippy: { command: 'cargo clippy --workspace -- -D warnings', required: false },
    format: { command: 'cargo fmt --check', required: false },
  },
  // generic: user must add checks — generated VERIFY.yaml will need editing
  generic: {},
}

// Prepended to every generated VERIFY.yaml to document subprocess execution constraints.
const VERIFY_HEADER = `# VERIFY.yaml — check execution constraints:
#
#   Commands run as plain subprocesses (no shell). The command string is split on
#   whitespace — e.g. "npm test" → ["npm", "test"]. Shell features are NOT
#   supported: no &&, ||, pipes, redirection, quoting, or expansion.
#
#   Only PATH is forwarded to the subprocess. Tools must be installed system-wide
#   (e.g. npm, python3, go, cargo). Shell builtins like "source" will not work.
#   Use "python3 -m pytest" instead of bare "pytest" for portability.
#
`

/**
 * Produce a VERIFY.yaml string for the given stack.
 * Only emits verificationProfile when a capsule image actually exists for it.
 * Non-capsule stacks fall back to plain subprocess execution (verificationProfile omitted).
 */
export function generateVerifyYaml(stack: StackId): string {
  const profileId = stackToProfile(stack)
  const knownProfiles = listKnownProfileIds()
  const checks = STACK_CHECKS[stack]

  const doc: Record<string, unknown> = {}

  if (profileId !== null && knownProfiles.includes(profileId)) {
    doc['verificationProfile'] = profileId
  }
  // No verificationProfile → checks run as plain subprocesses (no Docker capsule).

  doc['checks'] = checks

  return VERIFY_HEADER + yaml.dump(doc, { lineWidth: 120 })
}
