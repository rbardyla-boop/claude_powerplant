import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { checkFileNow } from '../src/diagnostics/host-file-timing.js'

describe('checkFileNow', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'powerplant-timing-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns existedAtMs=null when file does not exist', () => {
    const record = checkFileNow(path.join(tmpDir, 'absent.txt'), 'test-absent')
    expect(record.existedAtMs).toBeNull()
    expect(record.checkedAtMs).toBeGreaterThan(0)
  })

  it('returns existedAtMs as a number when file exists', () => {
    const fp = path.join(tmpDir, 'present.txt')
    fs.writeFileSync(fp, 'content')
    const record = checkFileNow(fp, 'test-present')
    expect(record.existedAtMs).not.toBeNull()
    expect(typeof record.existedAtMs).toBe('number')
  })

  it('stores the label and path', () => {
    const fp = path.join(tmpDir, 'labelled.txt')
    const record = checkFileNow(fp, 'my-label')
    expect(record.label).toBe('my-label')
    expect(record.path).toBe(fp)
  })

  it('checkedAtMs is close to current time', () => {
    const before = Date.now()
    const record = checkFileNow(path.join(tmpDir, 'x.txt'), 'x')
    const after = Date.now()
    expect(record.checkedAtMs).toBeGreaterThanOrEqual(before)
    expect(record.checkedAtMs).toBeLessThanOrEqual(after)
  })

  it('existedAtMs equals checkedAtMs when file exists', () => {
    const fp = path.join(tmpDir, 'timing.txt')
    fs.writeFileSync(fp, '')
    const record = checkFileNow(fp, 'timing')
    expect(record.existedAtMs).toBe(record.checkedAtMs)
  })
})
