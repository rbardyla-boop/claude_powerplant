import { z } from 'zod'

export const ProjectContractSchema = z.object({
  projectId: z.string().min(1),
  sourcePath: z.string().min(1),
  includePaths: z.array(z.string().min(1)).min(1),
  excludePaths: z.array(z.string()),
  denyIfPresentAfterCopy: z.array(z.string()),
  workspaceMode: z.literal('sanitized_copy_only'),
  allowBash: z.boolean(),
  realProjectMounted: z.literal(false),
})

export type ProjectContract = z.infer<typeof ProjectContractSchema>

// Sprint 3R fixture contract — harmless canaries only, no real project
export const SPRINT3R_FIXTURE_CONTRACT: ProjectContract = {
  projectId: 'mount-boundary-fixture',
  sourcePath: '',  // filled in at runtime with the resolved fixture path
  includePaths: [
    'src/**',
    'tests/**',
    'package.json',
    'POWERPLANT_TOKEN.txt',
  ],
  excludePaths: [
    '.env',
    '.env.*',
    '.git/**',
    'credentials*.json',
    'private/**',
    'data/**',
    'node_modules/**',
    'dist/**',
    'coverage/**',
    '**/*.key',
    '**/*.pem',
  ],
  denyIfPresentAfterCopy: [
    '.env',
    'credentials.json',
    '.git',
    'private',
    'data',
  ],
  workspaceMode: 'sanitized_copy_only',
  allowBash: true,
  realProjectMounted: false,
}
