import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { SPRINT2B_WORKDIR } from '../config/constants.js'
import type { BetaSelfHostedWork } from '@anthropic-ai/sdk/resources/beta/environments/work.js'

export interface SpawnContainerOptions {
  environmentKey: string
  imageTag: string
  workspacesDir?: string
  projectDir?: string
  // When set, the host directory is mounted inside the container at /mnt/session/outputs
  outputsDir?: string
}

// Returns the host directory that was mounted as /workspace in the container.
export function sessionWorkdir(sessionId: string, workspacesDir?: string): string {
  const base = workspacesDir ?? path.join(process.cwd(), SPRINT2B_WORKDIR)
  return path.join(base, sessionId)
}

export async function spawnContainerSession(
  work: BetaSelfHostedWork,
  opts: SpawnContainerOptions,
): Promise<void> {
  if (work.data.type !== 'session') return

  const sessionId = work.data.id
  const workdir = sessionWorkdir(sessionId, opts.workspacesDir)
  fs.mkdirSync(workdir, { recursive: true })
  // Container runs as a non-root system user (UID ~999); grant write access
  fs.chmodSync(workdir, 0o777)

  console.log(`[container] spawning for session ${sessionId}`)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'docker',
      [
        'run',
        '--rm',
        // Router DNS unreachable from Docker bridge; use Google public DNS
        // Host UFW DEFAULT_FORWARD_POLICY=DROP blocks Docker bridge traffic;
        // --network=host shares the host network namespace, bypassing the bridge entirely
        '--network=host',
        // Pass only session-scoped credentials — never the host API key
        '-e', `ANTHROPIC_SESSION_ID=${sessionId}`,
        '-e', `ANTHROPIC_ENVIRONMENT_KEY=${opts.environmentKey}`,
        '-e', `ANTHROPIC_WORK_ID=${work.id}`,
        '-e', `ANTHROPIC_ENVIRONMENT_ID=${work.environment_id}`,
        // Mount the per-session host directory as the workdir
        '-v', `${workdir}:/workspace`,
        // Optionally mount a read-only project directory inside /workspace/project.
        // Must be inside /workspace because ant's read tool sandbox is scoped to /workspace.
        ...(opts.projectDir ? ['-v', `${opts.projectDir}:/workspace/project:ro`] : []),
        // Optionally mount a host directory at /mnt/session/outputs (the documented final-output path).
        ...(opts.outputsDir ? ['-v', `${opts.outputsDir}:/mnt/session/outputs`] : []),
        opts.imageTag,
      ],
      {
        stdio: 'inherit',
        // Restrict the docker process's own env: only PATH is needed
        env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' },
      },
    )

    proc.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') {
        resolve()
      } else {
        reject(new Error(`Container exited with code ${code ?? signal} for session ${sessionId}`))
      }
    })
    proc.on('error', reject)
  })

  console.log(`[container] finished for session ${sessionId}`)
}
