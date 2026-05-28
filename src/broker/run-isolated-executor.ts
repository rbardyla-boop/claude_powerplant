import { execFile } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import fs from 'fs'
import path from 'path'
import {
  SPRINT3V_PROOF_FILENAME,
  SPRINT3V_EGRESS_SINK_PORT,
  SPRINT3V_EXECUTOR_IMAGE,
} from '../config/constants.js'
import {
  assertLaunchPolicyPass,
  buildDockerArgv,
} from './executor-launch-policy.js'
import { ExecutorProofSchema } from '../contracts/custom-tool-contract.js'
import type { ExecutorProof } from '../contracts/custom-tool-contract.js'

const execFileAsync = promisify(execFile)

export interface IsolatedExecutorResult {
  proof: ExecutorProof
  sinkReceivedCanary: boolean
  stdout: string
}

/** Start a local HTTP server that records any POST bodies received */
function startEgressSink(port: number): {
  ready: Promise<void>
  received: () => string[]
  stop: () => Promise<void>
} {
  const bodies: string[] = []

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      bodies.push(body)
      res.writeHead(200)
      res.end()
    })
  })

  const ready = new Promise<void>(resolve => server.listen(port, '0.0.0.0', resolve))

  const stop = (): Promise<void> =>
    new Promise(resolve => server.close(() => resolve()))

  return {
    ready,
    received: () => bodies.slice(),
    stop,
  }
}

export async function runIsolatedExecutor(outputDir: string): Promise<IsolatedExecutorResult> {
  fs.mkdirSync(outputDir, { recursive: true })
  // Allow uid 1001 inside the container to write proof artifact
  fs.chmodSync(outputDir, 0o777)

  // Validate launch policy before touching Docker
  assertLaunchPolicyPass({
    image: SPRINT3V_EXECUTOR_IMAGE,
    outputDir,
    networkMode: 'none',
    envVars: {},
    mounts: [outputDir],
    user: '1001:1001',
  })

  // Start egress sink on host — executor cannot reach it with --network none
  const sink = startEgressSink(SPRINT3V_EGRESS_SINK_PORT)
  await sink.ready

  let stdout = ''
  try {
    const argv = buildDockerArgv(outputDir)
    const result = await execFileAsync('docker', argv, {
      env: {},          // empty env for the docker process itself
      timeout: 30_000,
    })
    stdout = result.stdout.trim()
  } finally {
    await sink.stop()
  }

  const sinkBodies = sink.received()
  const sinkReceivedCanary = sinkBodies.some(b => b.includes('POWERPLANT_EGRESS_CANARY'))

  // Read and validate proof artifact
  const proofPath = path.join(outputDir, SPRINT3V_PROOF_FILENAME)
  if (!fs.existsSync(proofPath)) {
    throw new Error(`Executor did not write proof artifact at ${proofPath}`)
  }

  const raw = JSON.parse(fs.readFileSync(proofPath, 'utf-8'))
  const parseResult = ExecutorProofSchema.safeParse(raw)
  if (!parseResult.success) {
    throw new Error(`Proof artifact schema invalid: ${parseResult.error.message}`)
  }

  return { proof: parseResult.data, sinkReceivedCanary, stdout }
}
