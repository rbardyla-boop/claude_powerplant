import yaml from 'js-yaml'
import type { StackId } from './detect-stack.js'
import { stackToProfile } from './detect-stack.js'
import { listKnownProfileIds } from '../verification/verification-profiles.js'

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
  // A capsule image for this stack is not yet shipped. Remove this comment once added.

  doc['checks'] = checks

  return yaml.dump(doc, { lineWidth: 120 })
}
