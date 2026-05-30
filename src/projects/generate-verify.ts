import yaml from 'js-yaml'
import type { StackId } from './detect-stack.js'
import { stackToProfile } from './detect-stack.js'

interface CheckDef {
  command: string
}

// defaultChecks from the roadmap stack→config table
const STACK_CHECKS: Record<StackId, Record<string, CheckDef>> = {
  'node-ts': {
    test: { command: 'npm test' },
    typecheck: { command: 'npx tsc --noEmit' },
  },
  python: {
    test: { command: 'pytest' },
  },
  go: {
    test: { command: 'go test ./...' },
  },
  rust: {
    test: { command: 'cargo test' },
  },
  // generic: user must add checks — generated VERIFY.yaml will need editing
  generic: {},
}

/**
 * Produce a VERIFY.yaml string for the given stack.
 * Uses the stack's registered verification profile and default checks.
 * Note: generic produces empty checks — loadProjectContract will require the
 * user to add at least one check before the contract is fully valid.
 */
export function generateVerifyYaml(stack: StackId): string {
  const verificationProfile = stackToProfile(stack)
  const checks = STACK_CHECKS[stack]
  const doc: Record<string, unknown> = { verificationProfile, checks }
  return yaml.dump(doc, { lineWidth: 120 })
}
