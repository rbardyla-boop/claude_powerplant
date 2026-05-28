import fs from 'fs'
import path from 'path'

export interface MountManifest {
  runId: string
  originalSourceMounted: false
  sanitizedWorkspaceMounted: true
  mountedHostPath: string
  containerMountPath: '/workspace/project'
  mountMode: 'read_only'
  projectEnvMounted: false
  homeDirectoryMounted: false
  dockerSocketMounted: false
  apiKeyPassedToWorker: false
  clearedForRealProjectMounting: false
  timestamp: string
}

const RUNTIME_PATH_MARKER = '.powerplant/runtime/'

export function createMountManifest(params: {
  runId: string
  mountedHostPath: string
  reportsDir: string
}): MountManifest {
  const { runId, mountedHostPath, reportsDir } = params

  // Invariant: sanitized workspace must be under .powerplant/runtime/ — never the real project
  if (!mountedHostPath.includes(RUNTIME_PATH_MARKER)) {
    throw new Error(
      `Mount manifest invariant violated: mountedHostPath "${mountedHostPath}" ` +
      `must contain "${RUNTIME_PATH_MARKER}". Never mount a real project root.`,
    )
  }

  const manifest: MountManifest = {
    runId,
    originalSourceMounted: false,
    sanitizedWorkspaceMounted: true,
    mountedHostPath,
    containerMountPath: '/workspace/project',
    mountMode: 'read_only',
    projectEnvMounted: false,
    homeDirectoryMounted: false,
    dockerSocketMounted: false,
    apiKeyPassedToWorker: false,
    clearedForRealProjectMounting: false,
    timestamp: new Date().toISOString(),
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const manifestPath = path.join(reportsDir, `sprint3r-sanitizer-manifest-${ts}.json`)
  fs.mkdirSync(reportsDir, { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  return manifest
}
