import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { detectStack, stackToProfile } from '../src/projects/detect-stack.js'
import type { StackId } from '../src/projects/detect-stack.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-detect-stack-'))
}

function touch(dir: string, file: string): void {
  fs.writeFileSync(path.join(dir, file), '', 'utf-8')
}

describe('detectStack', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('package.json → node-ts', () => {
    touch(dir, 'package.json')
    expect(detectStack(dir)).toBe('node-ts')
  })

  it('pyproject.toml → python', () => {
    touch(dir, 'pyproject.toml')
    expect(detectStack(dir)).toBe('python')
  })

  it('go.mod → go', () => {
    touch(dir, 'go.mod')
    expect(detectStack(dir)).toBe('go')
  })

  it('Cargo.toml → rust', () => {
    touch(dir, 'Cargo.toml')
    expect(detectStack(dir)).toBe('rust')
  })

  it('empty directory → generic', () => {
    expect(detectStack(dir)).toBe('generic')
  })

  it('non-existent path fails closed to generic', () => {
    const absent = path.join(dir, 'does-not-exist')
    expect(detectStack(absent)).toBe('generic')
  })

  describe('priority — package.json wins over every other marker', () => {
    it('package.json + pyproject.toml → node-ts', () => {
      touch(dir, 'package.json')
      touch(dir, 'pyproject.toml')
      expect(detectStack(dir)).toBe('node-ts')
    })

    it('package.json + go.mod → node-ts', () => {
      touch(dir, 'package.json')
      touch(dir, 'go.mod')
      expect(detectStack(dir)).toBe('node-ts')
    })

    it('package.json + Cargo.toml → node-ts', () => {
      touch(dir, 'package.json')
      touch(dir, 'Cargo.toml')
      expect(detectStack(dir)).toBe('node-ts')
    })
  })

  describe('priority — pyproject.toml wins over go.mod and Cargo.toml', () => {
    it('pyproject.toml + go.mod → python', () => {
      touch(dir, 'pyproject.toml')
      touch(dir, 'go.mod')
      expect(detectStack(dir)).toBe('python')
    })

    it('pyproject.toml + Cargo.toml → python', () => {
      touch(dir, 'pyproject.toml')
      touch(dir, 'Cargo.toml')
      expect(detectStack(dir)).toBe('python')
    })
  })

  it('priority — go.mod wins over Cargo.toml', () => {
    touch(dir, 'go.mod')
    touch(dir, 'Cargo.toml')
    expect(detectStack(dir)).toBe('go')
  })

  it('all four markers present → node-ts (highest priority wins)', () => {
    touch(dir, 'package.json')
    touch(dir, 'pyproject.toml')
    touch(dir, 'go.mod')
    touch(dir, 'Cargo.toml')
    expect(detectStack(dir)).toBe('node-ts')
  })
})

describe('stackToProfile', () => {
  const cases: Array<[StackId, string | null]> = [
    ['node-ts', 'node-vitest-typescript-v1'],
    ['python', null],  // no capsule image shipped yet
    ['go', null],      // no capsule image shipped yet
    ['rust', null],    // no capsule image shipped yet
    ['generic', null], // no capsule image shipped yet
  ]

  for (const [stack, expected] of cases) {
    it(`${stack} → ${expected ?? 'null (no capsule)'}`, () => {
      expect(stackToProfile(stack)).toBe(expected)
    })
  }
})
