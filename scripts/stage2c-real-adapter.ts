// Stage 2C — Real Managed-Agent Adapter
//
// Step 9: Credential check shell only.
// Step 10: Live adapter with lazy @anthropic-ai/sdk import and bounded
//          execution. The SDK is NOT imported at the module level — the
//          dynamic import only runs inside run() after all gates pass.

import path from 'path'

// ── Step 9: Credential check ──────────────────────────────────────────────────

export interface RealAdapterCredentialCheck {
  available: boolean
  missingVars: string[]
}

export function checkRealAdapterCredentials(): RealAdapterCredentialCheck {
  const missing: string[] = []
  if (!process.env['ANTHROPIC_API_KEY']) {
    missing.push('ANTHROPIC_API_KEY')
  }
  return { available: missing.length === 0, missingVars: missing }
}

// ── Step 10: Transport identity ───────────────────────────────────────────────

export const REAL_MANAGED_AGENT_TRANSPORT_NAME = 'real-managed-agent-v1'

// ── Step 10: Bounded system prompt ───────────────────────────────────────────
//
// Explicitly forbids native filesystem, shell, browser, network, and external
// tools, and constrains the response to a single typed WRITE_FILE action.

const BOUNDED_SYSTEM_PROMPT = [
  'You are operating inside a Stage 2C bounded harness.',
  'Do not use native filesystem, shell, browser, network, or external tools.',
  'Return only a JSON object requesting at most one typed WRITE_FILE action.',
  'The runner will decide whether to apply or deny it.',
].join('\n')

// ── Step 10: Narrow response shape ───────────────────────────────────────────

interface ParsedToolAction {
  tool: 'WRITE_FILE'
  targetPath: string
  content: string
}

// ── Step 10: Real adapter factory ─────────────────────────────────────────────
//
// Returns an object satisfying the ManagedAgentAdapter interface (from
// stage2c-runner.ts) via TypeScript structural typing — no circular import
// is needed because the shapes are identical.
//
// The @anthropic-ai/sdk import is deferred to run() so that merely importing
// this module does not load or initialize the SDK.  The factory itself is
// synchronous; only run() is async.

export function createRealManagedAgentAdapter(): {
  readonly transportName: string
  run(request: { task: string; workspacePath: string; runId: string }): Promise<{
    transportName: string
    toolActions?: ParsedToolAction[]
  }>
} {
  return {
    transportName: REAL_MANAGED_AGENT_TRANSPORT_NAME,

    async run(request) {
      // Lazy import: executes only when run() is called (all gates already passed).
      const anthropicModule = await import('@anthropic-ai/sdk')
      const Anthropic = anthropicModule.default
      const client = new Anthropic()

      const userMessage = [
        `Task: ${request.task}`,
        '',
        'Return ONLY a JSON object with this exact shape:',
        '{"toolActions":[{"tool":"WRITE_FILE","targetPath":"<relative path>","content":"..."}]}',
        '',
        'Use a relative path for targetPath (e.g. "src/status.js").',
        'The runner resolves it inside the candidate workspace.',
        'At most ONE action. For no write return: {"toolActions":[]}',
      ].join('\n')

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: BOUNDED_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      })

      const textBlock = response.content.find((c) => c.type === 'text')
      if (textBlock === undefined || textBlock.type !== 'text') {
        throw new Error('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: no text content in response')
      }

      const text = textBlock.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch === null) {
        throw new Error('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: no JSON object found in response')
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch (err) {
        throw new Error(
          `MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: JSON parse failed — ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('toolActions' in parsed) ||
        !Array.isArray((parsed as Record<string, unknown>)['toolActions'])
      ) {
        throw new Error('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: response missing toolActions array')
      }

      const raw = parsed as { toolActions: unknown[] }
      const validated: ParsedToolAction[] = []

      for (const action of raw.toolActions.slice(0, 1)) {  // max 1 for Step 10
        if (typeof action !== 'object' || action === null) {
          throw new Error('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: toolAction is not an object')
        }
        const a = action as Record<string, unknown>
        if (
          a['tool'] !== 'WRITE_FILE' ||
          typeof a['targetPath'] !== 'string' ||
          a['targetPath'].length === 0 ||
          typeof a['content'] !== 'string'
        ) {
          throw new Error('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: toolAction has invalid shape')
        }

        // Resolve relative paths against the workspace root so the runner's
        // canonical boundary check works correctly.
        const resolvedPath = path.isAbsolute(a['targetPath'])
          ? a['targetPath']
          : path.join(request.workspacePath, a['targetPath'])

        validated.push({ tool: 'WRITE_FILE', targetPath: resolvedPath, content: a['content'] })
      }

      return { transportName: REAL_MANAGED_AGENT_TRANSPORT_NAME, toolActions: validated }
    },
  }
}
