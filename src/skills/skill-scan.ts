// ── Gate 3: Secret and Content Safety ────────────────────────────────────────
//
// Scans every imported payload file for:
//   1. Invalid UTF-8 bytes
//   2. NUL (0x00) bytes — indicates binary content
//   3. High-confidence credential material
//
// Rejection does NOT reveal matched secret bytes in any output, error, or log.
// Findings carry only: ruleId, relativePath, and a redacted category label.
//
// Pattern policy (conservative):
//   - Only high-confidence patterns that have low false-positive risk at the
//     expected lengths/formats. Placeholder-like values (YOUR_KEY_HERE, <...>)
//     are not matched by the credential patterns; they are too short or don't
//     match the structural checks below.
//   - Env-variable assignment patterns require the value to be non-placeholder
//     AND the variable name to be in the well-known secret set.

// ── Credential patterns ───────────────────────────────────────────────────────
//
// Each pattern targets a specific well-known credential format. The regexes
// are designed to require enough entropy/length to avoid matching
// instructional text that merely mentions a variable name.

const CREDENTIAL_PATTERNS: ReadonlyArray<{ ruleId: string; pattern: RegExp }> = [
  // PEM / OpenSSH private key blocks — the most unambiguous indicator
  {
    ruleId: 'PEM_PRIVATE_KEY',
    pattern: /-----BEGIN\s+(?:[A-Z]+ )?PRIVATE KEY-----/,
  },
  // GitHub fine-grained PAT: github_pat_ + 82 alphanumeric/underscore chars
  {
    ruleId: 'GITHUB_FINE_GRAINED_PAT',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
  },
  // GitHub classic tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36 alphanumeric chars
  {
    ruleId: 'GITHUB_TOKEN',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/,
  },
  // Anthropic API key: sk-ant- prefix, min 32 chars
  {
    ruleId: 'ANTHROPIC_API_KEY',
    pattern: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9\-_]{32,}\b/,
  },
  // OpenAI API key: sk- prefix, min 48 alphanumeric chars
  {
    ruleId: 'OPENAI_API_KEY',
    pattern: /\bsk-[A-Za-z0-9]{48,}\b/,
  },
  // AWS Access Key ID: AKIA + 16 uppercase alphanumeric
  {
    ruleId: 'AWS_ACCESS_KEY_ID',
    pattern: /\bAKIA[A-Z0-9]{16}\b/,
  },
  // Stripe live secret key: sk_live_ + min 24 alphanumeric
  {
    ruleId: 'STRIPE_SECRET_KEY',
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/,
  },
  // Slack bot/user/app/workspace tokens
  {
    ruleId: 'SLACK_TOKEN',
    pattern: /\bxox[bpars]-[A-Za-z0-9][A-Za-z0-9\-]{10,}\b/,
  },
  // Google API key: AIza + 35 URL-safe base64 chars
  {
    ruleId: 'GOOGLE_API_KEY',
    pattern: /\bAIza[A-Za-z0-9\-_]{35}\b/,
  },
]

// ── Well-known secret environment variable names ──────────────────────────────

const SECRET_ENV_VAR_NAMES = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_ENVIRONMENT_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_RESTRICTED_KEY',
  'DATABASE_URL',
  'DATABASE_PASSWORD',
  'DB_PASSWORD',
  'JWT_SECRET',
  'PRIVATE_KEY',
  'SECRET_KEY',
])

// A value looks like a placeholder if it matches any of these patterns.
// The spec explicitly requires that `YOUR_API_KEY_HERE` be allowed through.
const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /^your[_\-]/i,               // your-key, your_api_key_here
  /[_\-]here$/i,               // ..._here, ...-here
  /^<[^>]+>$/,                 // <value>, <replace-me>
  /^[x]{4,}$/i,                // xxxx, XXXX
  /^changeme$/i,
  /^example/i,                 // example-key, exampletoken
  /^placeholder/i,
  /^test[_\-]/i,               // test_key, test-token
  /^fake[_\-]/i,               // fake-key, fake_token
  /^dummy[_\-]/i,
  /^replace[_\-]/i,
  /^add[_\-]/i,
  /^insert[_\-]/i,
  /^none$/i,
  /^null$/i,
  /^undefined$/i,
  /^\.{3,}$/,                  // ..., ....
]

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some(p => p.test(value))
}

// An env assignment line looks like: VARNAME=value or VARNAME="value"
// We require value length >= 16 to avoid matching short noise like "yes"/"no".
const ENV_ASSIGN_LINE = /^([A-Z_][A-Z0-9_]*)\s*=\s*["']?([A-Za-z0-9+/=._\-]{16,})["']?$/

// ── Finding type ──────────────────────────────────────────────────────────────

export interface SecretFinding {
  ruleId: string
  relativePath: string
}

// ── Scan a single file's buffer ───────────────────────────────────────────────

export interface FileScanResult {
  valid: true
  findings: SecretFinding[]
}

export interface FileScanError {
  valid: false
  ruleId: 'INVALID_UTF8' | 'NUL_BYTES'
  relativePath: string
}

export type FileScanOutcome = FileScanResult | FileScanError

export function scanFileBuffer(buf: Buffer, relativePath: string): FileScanOutcome {
  // NUL bytes: indicate binary or injected null-terminated content.
  if (buf.includes(0)) {
    return { valid: false, ruleId: 'NUL_BYTES', relativePath }
  }

  // UTF-8 validity: reject files that cannot be decoded as valid UTF-8.
  let text: string
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    text = decoder.decode(buf)
  } catch {
    return { valid: false, ruleId: 'INVALID_UTF8', relativePath }
  }

  const findings: SecretFinding[] = []

  // Pattern-based credential scan
  for (const { ruleId, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ ruleId, relativePath })
      // One finding per rule category per file — do not collect further
      // matches for the same ruleId to avoid redundant findings.
    }
  }

  // Env-assignment scan: check each line for SECRET_VAR=<real-value>
  for (const line of text.split('\n')) {
    const m = ENV_ASSIGN_LINE.exec(line.trim())
    if (!m) continue
    const varName = m[1]!
    const value = m[2]!
    if (SECRET_ENV_VAR_NAMES.has(varName) && !isPlaceholderValue(value)) {
      findings.push({ ruleId: 'SECRET_ENV_ASSIGNMENT', relativePath })
      break
    }
  }

  return { valid: true, findings }
}
