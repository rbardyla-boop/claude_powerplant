import fs from 'fs'
import path from 'path'
import {
  generateSessionId,
  createSession,
  loadSession,
  listSessions,
  closeSession,
  getSessionBasePath,
} from '../../sessions/session-chain.js'
import { loadProjectContract } from '../../projects/load-project-contract.js'
import { buildSanitizedWorkspace } from '../../projects/build-sanitized-workspace.js'
import { computeDirectoryManifestHash } from '../../projects/compute-repo-manifest.js'

function validateProjectPath(projectPath: string): string {
  const abs = path.resolve(projectPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Project path does not exist: ${abs}`)
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Project path is not a directory: ${abs}`)
  }
  if (!fs.existsSync(path.join(abs, '.powerplant', 'POLICY.yaml'))) {
    throw new Error(
      `No .powerplant/POLICY.yaml found in: ${abs}\n` +
      'Only projects with a .powerplant/ contract folder are supported.',
    )
  }
  return abs
}

export async function cmdSession(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case 'create': {
      const projectPathArg = args[0]
      if (!projectPathArg) {
        console.error('Error: project-path is required.')
        console.error('Usage: powerplant session create <project-path>')
        process.exit(1)
      }

      let absPath: string
      try {
        absPath = validateProjectPath(projectPathArg)
      } catch (err) {
        console.error(`Error: ${String(err).replace('Error: ', '')}`)
        process.exit(1)
      }

      let contract
      try {
        contract = loadProjectContract(absPath)
      } catch (err) {
        console.error(`Error: Contract load failed — ${String(err).replace('Error: ', '')}`)
        process.exit(1)
      }

      const sessionId = generateSessionId()
      const basePath = getSessionBasePath(sessionId)

      console.log(`Creating session ${sessionId}...`)
      console.log(`Project: ${absPath} (${contract.projectId})`)
      console.log('Building sanitized base workspace...')

      try {
        buildSanitizedWorkspace(contract, basePath)
      } catch (err) {
        console.error(`Error building sanitized workspace: ${String(err)}`)
        process.exit(1)
      }

      const baseManifestHash = computeDirectoryManifestHash(basePath)

      const session = createSession({
        sessionId,
        projectId: contract.projectId,
        projectPath: absPath,
        baseManifestHash,
      })

      console.log()
      console.log(`Session created:`)
      console.log(`  ID:          ${session.sessionId}`)
      console.log(`  Project:     ${session.projectId}`)
      console.log(`  Base hash:   ${session.baseManifestHash}`)
      console.log(`  Status:      ${session.status}`)
      console.log()
      console.log(`Next: powerplant run --session ${session.sessionId} ${absPath} "<task>"`)
      break
    }

    case 'list': {
      const sessions = listSessions()
      if (sessions.length === 0) {
        console.log('No sessions found.')
        return
      }
      console.log('Sessions:')
      for (const s of sessions) {
        const chainLen = s.chainLinks.length
        console.log(`  ${s.sessionId}  ${s.projectId}  ${s.status}  chain:${chainLen}`)
      }
      break
    }

    case 'status': {
      const sessionId = args[0]
      if (!sessionId) {
        console.error('Error: session-id is required.')
        console.error('Usage: powerplant session status <session-id>')
        process.exit(1)
      }

      let session
      try {
        session = loadSession(sessionId)
      } catch (err) {
        console.error(`Error: ${String(err).replace('Error: ', '')}`)
        process.exit(1)
      }

      console.log(`Session: ${session.sessionId}`)
      console.log(`  Project ID:   ${session.projectId}`)
      console.log(`  Project path: ${session.projectPath}`)
      console.log(`  Created:      ${session.createdAt}`)
      console.log(`  Status:       ${session.status}`)
      console.log(`  Base hash:    ${session.baseManifestHash}`)
      console.log(`  Chain links:  ${session.chainLinks.length}`)
      if (session.chainLinks.length > 0) {
        console.log()
        console.log('Chain:')
        for (const link of session.chainLinks) {
          console.log(`  [${link.appliedAt}] ${link.runId}`)
          console.log(`    Task:           ${link.task}`)
          console.log(`    Evidence hash:  ${link.evidenceHash}`)
          console.log(`    Workspace hash: ${link.workspaceManifestHash}`)
        }
      }
      break
    }

    case 'close': {
      const sessionId = args[0]
      if (!sessionId) {
        console.error('Error: session-id is required.')
        console.error('Usage: powerplant session close <session-id>')
        process.exit(1)
      }

      let session
      try {
        session = loadSession(sessionId)
      } catch (err) {
        console.error(`Error: ${String(err).replace('Error: ', '')}`)
        process.exit(1)
      }

      if (session.status === 'closed') {
        console.log(`Session ${sessionId} is already closed.`)
        return
      }

      closeSession(sessionId)
      console.log(`Session ${sessionId} closed.`)
      break
    }

    default: {
      if (subcommand) {
        console.error(`Error: Unknown session subcommand '${subcommand}'`)
      }
      console.error('Usage:')
      console.error('  powerplant session create <project-path>')
      console.error('  powerplant session list')
      console.error('  powerplant session status <session-id>')
      console.error('  powerplant session close <session-id>')
      process.exit(subcommand ? 1 : 0)
    }
  }
}
