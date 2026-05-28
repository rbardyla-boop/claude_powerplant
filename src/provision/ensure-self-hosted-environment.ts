import Anthropic from '@anthropic-ai/sdk'
import { SELF_HOSTED_ENVIRONMENT_NAME } from '../config/constants.js'
import {
  loadSelfHostedState,
  saveSelfHostedState,
} from '../platform/self-hosted-state.js'
import type { SelfHostedEnvironment } from '../platform/self-hosted-state.js'

export async function ensureSelfHostedEnvironment(
  client: Anthropic,
): Promise<{ environment: SelfHostedEnvironment; reused: boolean }> {
  const existing = loadSelfHostedState()
  if (existing) {
    console.log(
      `Reusing self-hosted environment: ${existing.environment.id} (${existing.environment.name})`,
    )
    return { environment: existing.environment, reused: true }
  }

  console.log(`Creating self-hosted environment: ${SELF_HOSTED_ENVIRONMENT_NAME}`)
  try {
    const created = await client.beta.environments.create({
      name: SELF_HOSTED_ENVIRONMENT_NAME,
      config: { type: 'self_hosted' },
    })
    return {
      environment: { id: created.id, name: created.name },
      reused: false,
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status === 409) {
      console.log(
        `Environment name conflict (409); searching for existing "${SELF_HOSTED_ENVIRONMENT_NAME}"`,
      )
      for await (const env of client.beta.environments.list()) {
        if (env.name === SELF_HOSTED_ENVIRONMENT_NAME) {
          console.log(`Found existing environment: ${env.id}`)
          return { environment: { id: env.id, name: env.name }, reused: true }
        }
      }
      throw new Error(
        `Environment "${SELF_HOSTED_ENVIRONMENT_NAME}" exists (409) but was not found in list`,
      )
    }
    throw err
  }
}

export async function provisionSelfHostedEnvironment(
  client: Anthropic,
): Promise<{ environment: SelfHostedEnvironment }> {
  const { environment, reused } = await ensureSelfHostedEnvironment(client)

  console.log('\n=== Self-Hosted Environment ===')
  console.log(`  ID:     ${environment.id}`)
  console.log(`  Name:   ${environment.name}`)
  console.log(`  Status: ${reused ? 'reused' : 'created'}`)
  console.log('\nNext steps:')
  console.log(
    '  1. Open https://platform.claude.com/workspaces/default/environments',
  )
  console.log(`  2. Click "${environment.name}" → "Generate environment key"`)
  console.log(`  3. Export in your shell:`)
  console.log(`       export ANTHROPIC_ENVIRONMENT_ID="${environment.id}"`)
  console.log(`       export ANTHROPIC_ENVIRONMENT_KEY="sk-ant-oat01-..."`)
  console.log('  4. Run: npm run sprint2a:worker   (in one terminal)')
  console.log('  5. Run: npm run sprint2a:session  (in another terminal)')

  return { environment }
}
