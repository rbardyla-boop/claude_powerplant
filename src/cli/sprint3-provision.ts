import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { ensureSprint3Agent } from '../provision/ensure-sprint3-agent.js'

validateLiveEnv()
const client = createClient()

const { agent, environmentId, reused } = await ensureSprint3Agent(client)
console.log(`Sprint 3 agent ${reused ? 'reused' : 'created'}: ${agent.id}`)
console.log(`Environment: ${environmentId}`)
