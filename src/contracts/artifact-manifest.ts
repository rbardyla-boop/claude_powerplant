import { z } from 'zod'

export const ArtifactPathsSchema = z.object({
  patch: z.string().min(1),
  changedFiles: z.string().min(1),
  verificationReport: z.string().min(1),
  adversarialReview: z.string().min(1),
  sessionSummary: z.string().min(1),
})

export const VerificationCommandSchema = z.object({
  command: z.string().min(1),
  result: z.string(),
})

export const ArtifactManifestSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'blocked']),
  taskId: z.string().min(1),
  artifacts: ArtifactPathsSchema,
  verificationCommands: z.array(VerificationCommandSchema),
  blockedReason: z.string().optional(),
})

export type ArtifactPaths = z.infer<typeof ArtifactPathsSchema>
export type VerificationCommand = z.infer<typeof VerificationCommandSchema>
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>
