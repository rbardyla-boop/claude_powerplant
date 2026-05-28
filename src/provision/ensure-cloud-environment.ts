import Anthropic from '@anthropic-ai/sdk'
import { SMOKE_ENVIRONMENT_NAME } from '../config/constants.js'
import { loadState } from '../platform/managed-agent-state.js'
import type { EnvironmentResource } from '../platform/managed-agent-state.js'

export async function ensureCloudEnvironment(
  client: Anthropic,
): Promise<{ environment: EnvironmentResource; reused: boolean }> {
  const state = loadState()
  if (state?.environment) {
    console.log(`Reusing environment: ${state.environment.id} (${state.environment.name})`)
    return { environment: state.environment, reused: true }
  }

  console.log(`Creating environment: ${SMOKE_ENVIRONMENT_NAME}`)
  try {
    const created = await client.beta.environments.create({
      name: SMOKE_ENVIRONMENT_NAME,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    })
    return {
      environment: { id: created.id, name: created.name },
      reused: false,
    }
  } catch (err) {
    // 409: environment with this name already exists — find and reuse it
    if (err instanceof Anthropic.APIError && err.status === 409) {
      console.log(
        `Environment name conflict (409); searching for existing "${SMOKE_ENVIRONMENT_NAME}"`,
      )
      // PagePromise is AsyncIterable<BetaEnvironment>; iterate directly across pages.
      for await (const env of client.beta.environments.list()) {
        if (env.name === SMOKE_ENVIRONMENT_NAME) {
          console.log(`Found existing environment: ${env.id}`)
          return { environment: { id: env.id, name: env.name }, reused: true }
        }
      }
      throw new Error(
        `Environment "${SMOKE_ENVIRONMENT_NAME}" exists (409) but was not found in list`,
      )
    }
    throw err
  }
}
