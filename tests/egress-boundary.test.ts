import { describe, it, expect } from 'vitest'
import http from 'http'
import { startEgressSink, buildEgressProbeCommand } from '../src/worker/egress-boundary.js'
import {
  SPRINT3U_EGRESS_CANARY,
  SPRINT3U_E1_SENT,
  SPRINT3U_E1_NO_CLIENT,
} from '../src/config/constants.js'

describe('startEgressSink', () => {
  it('starts on a non-zero port', async () => {
    const sink = await startEgressSink()
    try {
      expect(sink.port).toBeGreaterThan(0)
      expect(sink.port).toBeLessThanOrEqual(65535)
    } finally {
      await sink.close()
    }
  })

  it('starts with receivedCanary false', async () => {
    const sink = await startEgressSink()
    try {
      expect(sink.receivedCanary).toBe(false)
    } finally {
      await sink.close()
    }
  })

  it('sets receivedCanary true when exact canary body is posted', async () => {
    const sink = await startEgressSink()
    try {
      await postToSink(sink.port, SPRINT3U_EGRESS_CANARY)
      expect(sink.receivedCanary).toBe(true)
    } finally {
      await sink.close()
    }
  })

  it('does not set receivedCanary for wrong body', async () => {
    const sink = await startEgressSink()
    try {
      await postToSink(sink.port, 'not-the-canary')
      expect(sink.receivedCanary).toBe(false)
    } finally {
      await sink.close()
    }
  })

  it('does not set receivedCanary for partial match', async () => {
    const sink = await startEgressSink()
    try {
      await postToSink(sink.port, SPRINT3U_EGRESS_CANARY + ' extra')
      expect(sink.receivedCanary).toBe(false)
    } finally {
      await sink.close()
    }
  })

  it('sets receivedCanary true when canary is sent with surrounding whitespace', async () => {
    // The sink trims the body before comparing
    const sink = await startEgressSink()
    try {
      await postToSink(sink.port, `  ${SPRINT3U_EGRESS_CANARY}  `)
      expect(sink.receivedCanary).toBe(true)
    } finally {
      await sink.close()
    }
  })

  it('responds 200 to any POST', async () => {
    const sink = await startEgressSink()
    try {
      const status = await postToSink(sink.port, 'anything')
      expect(status).toBe(200)
    } finally {
      await sink.close()
    }
  })

  it('can be closed without error', async () => {
    const sink = await startEgressSink()
    await expect(sink.close()).resolves.toBeUndefined()
  })

  it('two sinks listen on different ports', async () => {
    const sink1 = await startEgressSink()
    const sink2 = await startEgressSink()
    try {
      expect(sink1.port).not.toBe(sink2.port)
    } finally {
      await sink1.close()
      await sink2.close()
    }
  })
})

describe('buildEgressProbeCommand', () => {
  it('includes the correct sink URL', () => {
    const cmd = buildEgressProbeCommand(12345, 'result.txt')
    expect(cmd).toContain('http://127.0.0.1:12345/canary')
  })

  it('includes the egress canary value', () => {
    const cmd = buildEgressProbeCommand(12345, 'result.txt')
    expect(cmd).toContain(SPRINT3U_EGRESS_CANARY)
  })

  it('writes egress_attempt_made to result file when curl succeeds', () => {
    const cmd = buildEgressProbeCommand(9999, 'E1_EGRESS_RESULT.txt')
    expect(cmd).toContain(SPRINT3U_E1_SENT)
    expect(cmd).toContain('E1_EGRESS_RESULT.txt')
  })

  it('writes no_http_client_available when no curl or wget', () => {
    const cmd = buildEgressProbeCommand(9999, 'E1_EGRESS_RESULT.txt')
    expect(cmd).toContain(SPRINT3U_E1_NO_CLIENT)
  })

  it('falls back to wget when curl is unavailable', () => {
    const cmd = buildEgressProbeCommand(9999, 'result.txt')
    expect(cmd).toContain('wget')
  })

  it('uses POST method with curl', () => {
    const cmd = buildEgressProbeCommand(9999, 'result.txt')
    expect(cmd).toContain('-X POST')
  })

  it('produces a single command string (no arrays or newline split)', () => {
    const cmd = buildEgressProbeCommand(9999, 'result.txt')
    expect(typeof cmd).toBe('string')
    expect(cmd.length).toBeGreaterThan(0)
  })

  it('has a 5 second timeout on curl', () => {
    const cmd = buildEgressProbeCommand(9999, 'result.txt')
    expect(cmd).toContain('-m 5')
  })
})

// Minimal HTTP helper — posts body to 127.0.0.1:<port>/canary, returns status code
function postToSink(port: number, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/canary', method: 'POST' },
      (res) => resolve(res.statusCode ?? 0),
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
