import { z } from 'zod'
import type { ProjectContract } from '../projects/project-contract.js'
import {
  SPRINT4A_PILOT_SOURCE_PATH,
  SPRINT4A_PILOT_PROJECT_ID,
} from '../config/constants.js'

// Allowed read paths (exposed to the Managed Agent via project_read_file)
export const PILOT_ALLOWED_READ_PATHS = [
  'package.json',
  'README.md',
  'src/status.js',
  'tests/status.test.js',
  '.powerplant/PROJECT.md',
  '.powerplant/POLICY.yaml',
  '.powerplant/VERIFY.yaml',
  '.powerplant/QUALITY.md',
] as const

export type PilotReadPath = (typeof PILOT_ALLOWED_READ_PATHS)[number]

// Allowed write paths (disposable workspace only — never original source)
export const PILOT_ALLOWED_WRITE_PATHS = [
  'src/status.js',
  'tests/status.test.js',
] as const

export type PilotWritePath = (typeof PILOT_ALLOWED_WRITE_PATHS)[number]

// Allowed check IDs
export const PILOT_ALLOWED_CHECK_IDS = ['test'] as const
export type PilotCheckId = (typeof PILOT_ALLOWED_CHECK_IDS)[number]

// Contract for the sanitizer (include-only copy)
export const SPRINT4A_PILOT_CONTRACT: ProjectContract = {
  projectId: SPRINT4A_PILOT_PROJECT_ID,
  sourcePath: SPRINT4A_PILOT_SOURCE_PATH,
  includePaths: [
    'package.json',
    'README.md',
    'src/**',
    'tests/**',
    '.powerplant/**',
  ],
  excludePaths: [
    '.env',
    '.env.*',
    'private/**',
    'deployment/**',
    '.git/**',
    'node_modules/**',
    'package-lock.json',
    'credentials*.json',
    '**/*.key',
    '**/*.pem',
  ],
  denyIfPresentAfterCopy: [
    '.env',
    'private',
    'deployment',
    '.git',
    'node_modules',
    'credentials.json',
  ],
  workspaceMode: 'sanitized_copy_only',
  allowBash: false,
  realProjectMounted: false,
}

// Source-disclosure disclosure record
export const PILOT_SOURCE_DISCLOSURE_NOTE =
  'This pilot is intentionally non-sensitive. Content returned through ' +
  'project_read_file becomes Managed Agent session context processed by Claude. ' +
  'Future real project contracts must explicitly authorize which files may be disclosed.'

// Validate that a path is in the allowed read set
export const PilotReadPathSchema = z.enum(PILOT_ALLOWED_READ_PATHS)

// Validate that a path is in the allowed write set
export const PilotWritePathSchema = z.enum(PILOT_ALLOWED_WRITE_PATHS)

// Validate that a check ID is allowed
export const PilotCheckIdSchema = z.enum(PILOT_ALLOWED_CHECK_IDS)
