import { z } from 'zod'

export const VerificationProfileSchema = z.object({
  profileId: z.string().min(1),
  // 'capsule' runs inside a Docker image; 'subprocess' runs directly via spawnSync.
  runtime: z.enum(['subprocess', 'capsule']),
  // Non-null for capsule profiles; null for subprocess profiles (no Docker required).
  capsuleImageName: z.string().min(1).nullable(),
  // Present on capsule profiles; absent on subprocess profiles.
  toolchainPackageVersions: z.record(z.string()).optional(),
  // Default check commands surfaced by the init wizard; not an authorization mechanism.
  defaultChecks: z.record(z.string()).optional(),
  // All four of these are hard-coded invariants — a profile cannot opt out.
  networkDuringExecution: z.literal(false),
  originalProjectMounted: z.literal(false),
  // Optional — relevant only for capsule profiles where node_modules mounting is a concern.
  projectNodeModulesMounted: z.literal(false).optional(),
  credentialsPassed: z.literal(false),
  visibleToAgent: z.literal(false),
})
export type VerificationProfile = z.infer<typeof VerificationProfileSchema>
