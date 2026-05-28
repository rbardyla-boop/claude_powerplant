import { z } from 'zod'

export const InspectionReportSchema = z.object({
  inspectedAt: z.string(),
  projectPath: z.string(),
  projectId: z.string(),
  contractValid: z.boolean(),
  sanitizationPreview: z.object({
    passed: z.boolean(),
    includedFiles: z.array(z.string()),
    excludedFileCount: z.number().int(),
    forbiddenDetected: z.array(z.string()),
    allForbiddenAbsent: z.boolean(),
  }),
  policy: z.object({
    workspaceMode: z.string(),
    realProjectMounted: z.boolean(),
    allowedChecks: z.array(z.string()),
    allowedReadPaths: z.array(z.string()),
    allowedWritePaths: z.array(z.string()),
    forbiddenPaths: z.array(z.string()),
  }),
  executorPolicy: z.object({
    networkDisabled: z.boolean(),
    noCredentials: z.boolean(),
  }),
})

export type InspectionReport = z.infer<typeof InspectionReportSchema>
