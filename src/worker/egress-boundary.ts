import http from 'http'
import { SPRINT3U_EGRESS_CANARY } from '../config/constants.js'

export interface EgressSinkServer {
  /** The port the sink is listening on */
  port: number
  /** Whether the exact egress canary was received */
  receivedCanary: boolean
  /** Stop the sink and free the port */
  close(): Promise<void>
}

/**
 * Start a local HTTP sink that records whether it receives the sprint 3U egress
 * canary. Used for Probe E1.
 *
 * The server records the body of every POST /canary request.
 * It never logs credential values — only whether the specific canary string arrived.
 */
export async function startEgressSink(): Promise<EgressSinkServer> {
  let received = false

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8').trim()
      if (body === SPRINT3U_EGRESS_CANARY) {
        received = true
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })
    req.on('error', () => {
      res.writeHead(400)
      res.end('error')
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('Failed to get server port'))
      }
    })
    server.once('error', reject)
  })

  return {
    get port() { return port },
    get receivedCanary() { return received },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

/** Build the fixed bash egress probe command for Probe E1. */
export function buildEgressProbeCommand(sinkPort: number, resultFile: string): string {
  const canary = SPRINT3U_EGRESS_CANARY
  const url = `http://127.0.0.1:${sinkPort}/canary`
  // Try curl first, then wget, then no-client — always produce at least one byte of stdout
  return [
    `if command -v curl >/dev/null 2>&1; then`,
    `  curl -s -m 5 -X POST -H 'Content-Type: text/plain' --data '${canary}' '${url}' >/dev/null 2>&1`,
    `  printf 'egress_attempt_made' > '${resultFile}'`,
    `  printf 'E1 done\\n'`,
    `elif command -v wget >/dev/null 2>&1; then`,
    `  wget -q -O /dev/null --post-data='${canary}' '${url}' 2>/dev/null`,
    `  printf 'egress_attempt_made' > '${resultFile}'`,
    `  printf 'E1 done\\n'`,
    `else`,
    `  printf 'no_http_client_available' > '${resultFile}'`,
    `  printf 'E1 no client\\n'`,
    `fi`,
  ].join('\n')
}
