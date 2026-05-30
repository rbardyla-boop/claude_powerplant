import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getPowerplantHome } from '../config/powerplant-home.js'

export interface ChainLink {
  runId: string
  task: string
  evidenceHash: string
  appliedAt: string
  workspaceManifestHash: string
}

export interface SessionState {
  sessionId: string
  projectId: string
  projectPath: string
  createdAt: string
  status: 'open' | 'closed'
  baseManifestHash: string
  chainLinks: ChainLink[]
}

export function getSessionsDir(): string {
  return path.join(getPowerplantHome(), 'sessions')
}

export function getSessionDir(sessionId: string): string {
  return path.join(getSessionsDir(), sessionId)
}

export function getSessionStatePath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'SESSION.json')
}

export function getSessionBasePath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'base')
}

export function generateSessionId(): string {
  const rand = crypto.randomBytes(4).toString('hex')
  return `pp-session-${Date.now()}-${rand}`
}

export function loadSession(sessionId: string): SessionState {
  const statePath = getSessionStatePath(sessionId)
  if (!fs.existsSync(statePath)) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as SessionState
  } catch {
    throw new Error(`SESSION.json for ${sessionId} is unreadable or invalid`)
  }
}

export function saveSession(session: SessionState): void {
  const dir = getSessionDir(session.sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getSessionStatePath(session.sessionId), JSON.stringify(session, null, 2))
}

export function listSessions(): SessionState[] {
  const dir = getSessionsDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => fs.existsSync(path.join(dir, name, 'SESSION.json')))
    .flatMap(name => {
      try { return [loadSession(name)] } catch { return [] }
    })
}

export function createSession(opts: {
  sessionId: string
  projectId: string
  projectPath: string
  baseManifestHash: string
}): SessionState {
  const session: SessionState = {
    sessionId: opts.sessionId,
    projectId: opts.projectId,
    projectPath: opts.projectPath,
    createdAt: new Date().toISOString(),
    status: 'open',
    baseManifestHash: opts.baseManifestHash,
    chainLinks: [],
  }
  saveSession(session)
  return session
}

export function closeSession(sessionId: string): SessionState {
  const session = loadSession(sessionId)
  const updated: SessionState = { ...session, status: 'closed' }
  saveSession(updated)
  return updated
}

export function extendSession(sessionId: string, link: ChainLink): SessionState {
  const session = loadSession(sessionId)
  if (session.status === 'closed') {
    throw new Error(`Session ${sessionId} is closed and cannot be extended`)
  }
  const updated: SessionState = { ...session, chainLinks: [...session.chainLinks, link] }
  saveSession(updated)
  return updated
}
