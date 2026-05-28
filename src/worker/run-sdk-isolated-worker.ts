import Anthropic from '@anthropic-ai/sdk'
import { EnvironmentWorker } from '@anthropic-ai/sdk/helpers/beta/environments'
import { betaAgentToolset20260401 } from '@anthropic-ai/sdk/tools/agent-toolset/node'
import fs from 'fs'

export interface SdkIsolatedWorkerOptions {
  /**
   * Environment key — the single credential the worker uses. Must NOT be the
   * ANTHROPIC_API_KEY. Control-plane operations (agent creation, session
   * creation, stats queries) must use a separate API-key client.
   */
  environmentKey: string
  environmentId: string
  /**
   * Per-session workdir. The bash tool CWD and the write tool base path.
   * Created automatically if absent.
   */
  workdir: string
  /** Tool names to expose (e.g. ['bash'] or ['write']). Defaults to all standard tools. */
  allowedTools?: string[]
  /** External abort signal — aborting ends the polling loop. */
  signal?: AbortSignal
  /** Called once the worker claims a session, with the session ID it claimed. */
  onClaimed?: (sessionId: string) => void
}

/**
 * Starts an EnvironmentWorker that uses only the environment key (no API key).
 * The worker polls the environment queue, claims a session, and dispatches tool
 * calls locally using betaAgentToolset20260401 filtered to allowedTools.
 *
 * The bash tool's subprocess environment has ANTHROPIC_API_KEY scrubbed: when
 * betaAgentToolset20260401 is called WITHOUT an explicit env, it defaults to a
 * sanitised copy of process.env with ANTHROPIC_* vars removed.
 *
 * Returns the underlying run() promise. Callers should abort the signal when
 * the session is done (e.g. after end_turn in the orchestrator event loop).
 */
export async function runSdkIsolatedWorker(
  opts: SdkIsolatedWorkerOptions,
): Promise<void> {
  fs.mkdirSync(opts.workdir, { recursive: true })

  const envKeyClient = new Anthropic({ authToken: opts.environmentKey })

  let onClaimedFired = false
  const worker = new EnvironmentWorker({
    client: envKeyClient,
    environmentId: opts.environmentId,
    environmentKey: opts.environmentKey,
    workdir: opts.workdir,
    tools: (ctx) => {
      if (!onClaimedFired && ctx.sessionId && opts.onClaimed) {
        onClaimedFired = true
        opts.onClaimed(ctx.sessionId)
      }
      const all = betaAgentToolset20260401(ctx)
      if (!opts.allowedTools || opts.allowedTools.length === 0) return all
      return all.filter(t => opts.allowedTools!.includes(t.name))
    },
    signal: opts.signal,
  })

  await worker.run()
}
