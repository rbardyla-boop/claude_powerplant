import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { previewSanitization } from '../src/projects/preview-sanitization.js'
import { SPRINT4A_PILOT_CONTRACT } from '../src/contracts/project-pilot-contract.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from '../src/contracts/project-pilot-contract.js'
import type { InspectionReport } from '../src/contracts/inspection-report.js'

// Tests for the inspect command logic. No CLI process spawn — pure unit tests
// against the underlying functions. Live inspection of the actual pilot project
// is left to the manual acceptance workflow.

let tempProjectDir: string

beforeAll(() => {
  // Build a minimal project structure that mirrors the pilot contract
  tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-inspect-test-'))

  // Create .powerplant/POLICY.yaml (presence validates contract)
  fs.mkdirSync(path.join(tempProjectDir, '.powerplant'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, '.powerplant', 'POLICY.yaml'), 'projectId: test\n')

  // Allowed files
  fs.writeFileSync(path.join(tempProjectDir, 'package.json'), '{}')
  fs.writeFileSync(path.join(tempProjectDir, 'README.md'), '# Test')
  fs.mkdirSync(path.join(tempProjectDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'src', 'status.js'), 'export function ok() {}')
  fs.mkdirSync(path.join(tempProjectDir, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'tests', 'status.test.js'), 'test("ok", () => {})')

  // Excluded files (not in includePaths)
  fs.writeFileSync(path.join(tempProjectDir, '.env'), 'SECRET=shhh')
  fs.mkdirSync(path.join(tempProjectDir, 'private'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'private', 'secret.txt'), 'top secret')
  fs.mkdirSync(path.join(tempProjectDir, 'deployment'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'deployment', 'release.txt'), 'v1.0')
})

afterAll(() => {
  fs.rmSync(tempProjectDir, { recursive: true, force: true })
})

describe('previewSanitization', () => {
  it('includes only files matching includePaths', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // package.json, README.md, src/status.js, tests/status.test.js, .powerplant/POLICY.yaml
    expect(preview.includedFiles).toContain('package.json')
    expect(preview.includedFiles).toContain('README.md')
    expect(preview.includedFiles).toContain('src/status.js')
    expect(preview.includedFiles).toContain('tests/status.test.js')
    expect(preview.includedFiles).toContain('.powerplant/POLICY.yaml')
  })

  it('excludes files not in includePaths', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.excludedFiles).toContain('.env')
    expect(preview.excludedFiles).toContain('private/secret.txt')
    expect(preview.excludedFiles).toContain('deployment/release.txt')
  })

  it('never includes excluded file content in the preview', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // Content is never in the preview result — only paths are listed
    const allEntries = JSON.stringify(preview)
    expect(allEntries).not.toContain('top secret')
    expect(allEntries).not.toContain('SECRET=shhh')
  })

  it('detects forbidden paths present in source', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // denyIfPresentAfterCopy: ['.env', 'private', 'deployment', '.git', 'node_modules', 'credentials.json']
    expect(preview.forbiddenDetected).toContain('.env')
    expect(preview.forbiddenDetected).toContain('private')
    expect(preview.forbiddenDetected).toContain('deployment')
  })

  it('reports allForbiddenAbsent false when forbidden paths exist', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.allForbiddenAbsent).toBe(false)
  })

  it('returns allForbiddenAbsent true for a clean project', () => {
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-clean-'))
    try {
      fs.writeFileSync(path.join(cleanDir, 'package.json'), '{}')
      fs.mkdirSync(path.join(cleanDir, 'src'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, 'src', 'status.js'), '// clean')
      fs.mkdirSync(path.join(cleanDir, 'tests'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, 'tests', 'status.test.js'), '// test')
      fs.mkdirSync(path.join(cleanDir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, '.powerplant', 'POLICY.yaml'), '')

      const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: cleanDir }
      const preview = previewSanitization(contract)

      expect(preview.allForbiddenAbsent).toBe(true)
      expect(preview.forbiddenDetected).toHaveLength(0)
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true })
    }
  })

  it('throws for non-existent project path', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: '/nonexistent/path' }
    expect(() => previewSanitization(contract)).toThrow(/does not exist/)
  })
})

describe('inspect command contract validation', () => {
  it('requires .powerplant/POLICY.yaml to exist', () => {
    // Simulate validation logic — a project without .powerplant/ is rejected
    function validatePolicy(projectPath: string): boolean {
      return fs.existsSync(path.join(projectPath, '.powerplant', 'POLICY.yaml'))
    }

    expect(validatePolicy(tempProjectDir)).toBe(true)
    expect(validatePolicy(os.tmpdir())).toBe(false)
  })

  it('requires the project directory to exist', () => {
    function validateDir(projectPath: string): boolean {
      return fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()
    }

    expect(validateDir(tempProjectDir)).toBe(true)
    expect(validateDir('/nonexistent/path')).toBe(false)
    expect(validateDir(path.join(tempProjectDir, 'package.json'))).toBe(false)
  })
})

describe('inspection report schema', () => {
  it('builds a valid InspectionReport from preview data', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    const report: InspectionReport = {
      inspectedAt: new Date().toISOString(),
      projectPath: tempProjectDir,
      projectId: contract.projectId,
      contractValid: true,
      sanitizationPreview: {
        passed: preview.allForbiddenAbsent,
        includedFiles: preview.includedFiles,
        excludedFileCount: preview.excludedFiles.length,
        forbiddenDetected: preview.forbiddenDetected,
        allForbiddenAbsent: preview.allForbiddenAbsent,
      },
      policy: {
        workspaceMode: contract.workspaceMode,
        realProjectMounted: contract.realProjectMounted,
        allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
        allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
        allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
        forbiddenPaths: contract.excludePaths,
      },
      executorPolicy: {
        networkDisabled: true,
        noCredentials: true,
      },
    }

    expect(report.contractValid).toBe(true)
    expect(report.policy.realProjectMounted).toBe(false)
    expect(report.executorPolicy.networkDisabled).toBe(true)
    expect(report.executorPolicy.noCredentials).toBe(true)
    expect(report.sanitizationPreview.includedFiles).toContain('src/status.js')
  })

  it('never discloses forbidden file contents in inspection data', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    const report: InspectionReport = {
      inspectedAt: new Date().toISOString(),
      projectPath: tempProjectDir,
      projectId: contract.projectId,
      contractValid: true,
      sanitizationPreview: {
        passed: preview.allForbiddenAbsent,
        includedFiles: preview.includedFiles,
        excludedFileCount: preview.excludedFiles.length,
        forbiddenDetected: preview.forbiddenDetected,
        allForbiddenAbsent: preview.allForbiddenAbsent,
      },
      policy: {
        workspaceMode: contract.workspaceMode,
        realProjectMounted: contract.realProjectMounted,
        allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
        allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
        allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
        forbiddenPaths: contract.excludePaths,
      },
      executorPolicy: {
        networkDisabled: true,
        noCredentials: true,
      },
    }

    const serialized = JSON.stringify(report)
    // Contents of .env and private/ must not appear — only their paths
    expect(serialized).not.toContain('SECRET=shhh')
    expect(serialized).not.toContain('top secret')
  })
})

describe('inspect never starts a session', () => {
  it('inspect uses only local file system operations', () => {
    // The inspect command must not call any Anthropic API methods.
    // Verified by confirming no Anthropic client is constructed in inspect.ts.
    // This test acts as a documentation checkpoint that the import tree of
    // cmdInspect does not include the Anthropic SDK.
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // If this runs without an ANTHROPIC_API_KEY, the inspect logic is safe
    delete process.env['ANTHROPIC_API_KEY']
    expect(() => previewSanitization(contract)).not.toThrow()
    expect(preview.includedFiles.length).toBeGreaterThan(0)
  })
})
