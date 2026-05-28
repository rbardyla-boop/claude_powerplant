import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { provisionSelfHostedEnvironment } from '../provision/ensure-self-hosted-environment.js'
import { ensureSelfHostedAgent } from '../provision/ensure-self-hosted-agent.js'

validateLiveEnv()
const client = createClient()

const { environment } = await provisionSelfHostedEnvironment(client)
await ensureSelfHostedAgent(client, environment)
