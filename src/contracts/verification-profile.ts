import { z } from 'zod'

export const VerificationProfileSchema = z.object({
  profileId: z.string().min(1),
  capsuleImageName: z.string().min(1),
  toolchainPackageVersions: z.record(z.string()),
  // All four of these are hard-coded invariants — a profile cannot opt out.
  networkDuringExecution: z.literal(false),
  originalProjectMounted: z.literal(false),
  projectNodeModulesMounted: z.literal(false),
  credentialsPassed: z.literal(false),
  visibleToAgent: z.literal(false),
})
export type VerificationProfile = z.infer<typeof VerificationProfileSchema>
