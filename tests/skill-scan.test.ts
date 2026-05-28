import { describe, test, expect } from 'vitest'
import { scanFileBuffer } from '../src/skills/skill-scan.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function scan(content: string, relPath = 'SKILL.md') {
  return scanFileBuffer(Buffer.from(content, 'utf-8'), relPath)
}

function scanBuf(buf: Buffer, relPath = 'SKILL.md') {
  return scanFileBuffer(buf, relPath)
}

// ── UTF-8 and NUL validation ──────────────────────────────────────────────────

describe('Gate 3: NUL bytes are rejected', () => {
  test('rejects a buffer containing a NUL byte', () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
    const result = scanBuf(buf, 'binary.txt')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.ruleId).toBe('NUL_BYTES')
    expect(result.relativePath).toBe('binary.txt')
  })

  test('rejects a buffer that is all NUL bytes', () => {
    const buf = Buffer.alloc(32, 0)
    const result = scanBuf(buf, 'all-nul.bin')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.ruleId).toBe('NUL_BYTES')
  })

  test('accepts a buffer with no NUL bytes', () => {
    const buf = Buffer.from('hello world\n', 'utf-8')
    const result = scanBuf(buf)
    expect(result.valid).toBe(true)
  })
})

describe('Gate 3: invalid UTF-8 is rejected', () => {
  test('rejects a buffer containing invalid UTF-8 (lone continuation byte)', () => {
    // 0x80 alone is not valid UTF-8
    const buf = Buffer.concat([Buffer.from('hello '), Buffer.from([0x80]), Buffer.from(' world')])
    const result = scanBuf(buf, 'bad-utf8.txt')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.ruleId).toBe('INVALID_UTF8')
    expect(result.relativePath).toBe('bad-utf8.txt')
  })

  test('rejects a buffer with an incomplete multi-byte sequence', () => {
    // 0xE2 0x82 would be the start of a 3-byte sequence (€ = E2 82 AC) but missing last byte
    const buf = Buffer.concat([Buffer.from('price: '), Buffer.from([0xe2, 0x82])])
    const result = scanBuf(buf, 'truncated.txt')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.ruleId).toBe('INVALID_UTF8')
  })

  test('accepts valid UTF-8 including multi-byte characters', () => {
    const result = scan('Hello, 世界! Price: €1.00')
    expect(result.valid).toBe(true)
  })
})

// ── Private key detection ─────────────────────────────────────────────────────

describe('Gate 3: PEM private keys are rejected', () => {
  test('rejects a file containing an RSA PRIVATE KEY block', () => {
    const content = [
      '# Skill configuration',
      '',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5GqB2bMIqgBeIfQFm5IMGNMy5Z0bOCw==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')

    const result = scan(content)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.findings[0]?.ruleId).toBe('PEM_PRIVATE_KEY')
    // No secret bytes in the finding
    expect(JSON.stringify(result.findings)).not.toContain('MIIEowIBAAK')
  })

  test('rejects a file containing an EC PRIVATE KEY block', () => {
    const content = '-----BEGIN EC PRIVATE KEY-----\nABCDEFGHIJKLMNOP\n-----END EC PRIVATE KEY-----'
    const result = scan(content)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'PEM_PRIVATE_KEY')).toBe(true)
  })

  test('rejects a file containing an OPENSSH PRIVATE KEY block', () => {
    const content = '-----BEGIN OPENSSH PRIVATE KEY-----\nABCDEF\n-----END OPENSSH PRIVATE KEY-----'
    const result = scan(content)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'PEM_PRIVATE_KEY')).toBe(true)
  })

  test('rejects a file containing a bare PRIVATE KEY block', () => {
    const content = '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----'
    const result = scan(content)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'PEM_PRIVATE_KEY')).toBe(true)
  })

  test('gate3-private-key fixture is rejected', () => {
    const fs = require('fs')
    const path = require('path')
    const fixturePath = path.join(process.cwd(), 'fixtures', 'skills', 'gate3-private-key', 'SKILL.md')
    const buf = fs.readFileSync(fixturePath)
    const result = scanBuf(buf, 'SKILL.md')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'PEM_PRIVATE_KEY')).toBe(true)
  })
})

// ── API key / token detection ─────────────────────────────────────────────────

describe('Gate 3: GitHub tokens are rejected', () => {
  test('rejects a GitHub classic PAT (ghp_ prefix + 36 chars)', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const result = scan(`config:\n  token: ${token}`)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'GITHUB_TOKEN')).toBe(true)
    expect(JSON.stringify(result.findings)).not.toContain(token)
  })

  test('gate3-api-key fixture is rejected', () => {
    const fs = require('fs')
    const path = require('path')
    const fixturePath = path.join(process.cwd(), 'fixtures', 'skills', 'gate3-api-key', 'SKILL.md')
    const buf = fs.readFileSync(fixturePath)
    const result = scanBuf(buf, 'SKILL.md')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.length).toBeGreaterThan(0)
  })
})

describe('Gate 3: Anthropic API keys are rejected', () => {
  test('rejects sk-ant- prefixed keys of sufficient length', () => {
    const key = 'sk-ant-api03-' + 'A'.repeat(40)
    const result = scan(`key = ${key}`)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'ANTHROPIC_API_KEY')).toBe(true)
    expect(JSON.stringify(result.findings)).not.toContain(key)
  })
})

describe('Gate 3: OpenAI API keys are rejected', () => {
  test('rejects sk- prefixed keys of 48+ chars', () => {
    const key = 'sk-' + 'A'.repeat(48)
    const result = scan(`OPENAI_KEY=${key}`)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'OPENAI_API_KEY')).toBe(true)
    expect(JSON.stringify(result.findings)).not.toContain(key)
  })

  test('does not reject short sk- strings (too short to be real keys)', () => {
    const result = scan('see sk-help for details')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'OPENAI_API_KEY')).toBe(false)
  })
})

describe('Gate 3: AWS access key IDs are rejected', () => {
  test('rejects AKIA + 16 uppercase alphanumeric chars', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE'
    const result = scan(`aws_access_key_id = ${key}`)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f => f.ruleId === 'AWS_ACCESS_KEY_ID')).toBe(true)
    expect(JSON.stringify(result.findings)).not.toContain(key)
  })
})

// ── Secret env assignment detection ──────────────────────────────────────────

describe('Gate 3: secret-bearing env assignments are rejected', () => {
  test('gate3-env-secret fixture is rejected', () => {
    const fs = require('fs')
    const path = require('path')
    const fixturePath = path.join(process.cwd(), 'fixtures', 'skills', 'gate3-env-secret', 'SKILL.md')
    const buf = fs.readFileSync(fixturePath)
    const result = scanBuf(buf, 'SKILL.md')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    // Should be caught by ANTHROPIC_API_KEY pattern (sk-ant- prefix)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  test('ANTHROPIC_API_KEY=<real-value> is rejected via env assignment', () => {
    // Value is long and non-placeholder but doesn't match the sk-ant- pattern
    const result = scan('ANTHROPIC_API_KEY=realApiKeyValue123456789012345678901234567890')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings.some(f =>
      f.ruleId === 'SECRET_ENV_ASSIGNMENT' || f.ruleId === 'ANTHROPIC_API_KEY'
    )).toBe(true)
  })
})

// ── Placeholder detection (allowed) ──────────────────────────────────────────

describe('Gate 3: placeholder credential references are allowed', () => {
  test('gate3-placeholder-only fixture is accepted', () => {
    const fs = require('fs')
    const path = require('path')
    const fixturePath = path.join(process.cwd(), 'fixtures', 'skills', 'gate3-placeholder-only', 'SKILL.md')
    const buf = fs.readFileSync(fixturePath)
    const result = scanBuf(buf, 'SKILL.md')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })

  test('OPENAI_API_KEY=YOUR_API_KEY_HERE is not rejected', () => {
    const result = scan('OPENAI_API_KEY=YOUR_API_KEY_HERE')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })

  test('GITHUB_TOKEN=<your-github-token> is not rejected', () => {
    const result = scan('GITHUB_TOKEN=<your-github-token>')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })

  test('ANTHROPIC_API_KEY=your-api-key-here is not rejected', () => {
    const result = scan('ANTHROPIC_API_KEY=your-api-key-here')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })
})

// ── Secret reporting safety ───────────────────────────────────────────────────

describe('Gate 3: rejection output must not contain matched secret bytes', () => {
  test('PEM private key rejection does not include key material in finding fields', () => {
    const secretContent = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'SUPERSECRETPRIVATEKEYCONTENTHERE1234567890abcdef',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')
    const result = scan(secretContent)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const serialized = JSON.stringify(result.findings)
    expect(serialized).not.toContain('SUPERSECRETPRIVATEKEYCONTENTHERE1234567890abcdef')
  })

  test('GitHub token rejection does not include token in finding fields', () => {
    const secret = 'ghp_' + 'X'.repeat(36)
    const result = scan(`token = ${secret}\n`)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const serialized = JSON.stringify(result.findings)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('X'.repeat(36))
  })
})

// ── Clean content passthrough ─────────────────────────────────────────────────

describe('Gate 3: clean content passes through', () => {
  test('valid SKILL.md with no secrets returns success with empty findings', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: A clean skill with no secrets.',
      '---',
      '',
      '# My Skill',
      '',
      'Run this command to get started. No credentials required.',
    ].join('\n')

    const result = scan(content)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })

  test('documentation mentioning "api key" does not trigger rejection', () => {
    const result = scan('To set your API key, export OPENAI_API_KEY=<your key here>.')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.findings).toHaveLength(0)
  })
})
