import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { ProjectContract } from './project-contract.js'

export interface WorkspaceFile {
  relativePath: string
  sha256: string
}

export interface SanitizedWorkspace {
  workspacePath: string
  manifest: {
    projectId: string
    sourcePath: string
    files: WorkspaceFile[]
    createdAt: string
  }
}

/**
 * Single-pass tokenizer that converts a glob pattern to a regex. Handles:
 *   dir/**   → anything under dir/ (including nested)
 *   **\/*.ext → any file with that extension at any depth
 *   name*.ext → name prefix with extension
 *   .name.*  → dotfile with any extension
 *   exact     → exact path match
 * Sequential string replacements are intentionally avoided — they corrupt
 * their own output when intermediate results contain `*`.
 */
export function matchesGlob(relativePath: string, pattern: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')

  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regexStr += '(?:[^/]+/)*'
        i += 3
      } else {
        regexStr += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      regexStr += '[^/]*'
      i += 1
    } else {
      regexStr += (pattern[i] ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i += 1
    }
  }

  try {
    return new RegExp(`^${regexStr}$`).test(normalized)
  } catch {
    return normalized === pattern
  }
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isDirectoryExcluded(relDirPath: string, excludePaths: string[]): boolean {
  // Test relDirPath + '/' so that dir/** patterns match the directory itself.
  // e.g. ".venv/**" regex is ^\.venv\/.*$ which matches ".venv/" (empty tail is ok).
  return excludePaths.some(p => matchesGlob(relDirPath + '/', p))
}

function walkDir(
  dir: string,
  base: string,
  includePaths: string[],
  excludePaths: string[],
  results: string[],
): void {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const relPath = path.relative(base, fullPath).replace(/\\/g, '/')
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink()) {
      // Only reject symlinks that would enter the sanitized snapshot.
      // Symlinks inside excluded directories (e.g. node_modules/.bin/) are skipped.
      const wouldInclude = includePaths.some(p => matchesGlob(relPath, p))
        && !excludePaths.some(p => matchesGlob(relPath, p))
      if (wouldInclude) {
        throw new Error(`Symlink rejected: ${relPath}`)
      }
      continue
    }
    if (stat.isDirectory()) {
      // Prune entire directory trees matched by an exclude pattern — avoids
      // walking .venv/ (18k+ files) or node_modules/ even when **/*.py is broad.
      if (!isDirectoryExcluded(relPath, excludePaths)) {
        walkDir(fullPath, base, includePaths, excludePaths, results)
      }
    } else {
      results.push(fullPath)
    }
  }
}

function assertSafePath(relativePath: string, sourcePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute path rejected: ${relativePath}`)
  }
  if (relativePath.includes('..')) {
    throw new Error(`Path traversal rejected: ${relativePath}`)
  }
  // Verify resolved destination stays inside sourcePath
  const resolved = path.resolve(sourcePath, relativePath)
  if (!resolved.startsWith(path.resolve(sourcePath) + path.sep) && resolved !== path.resolve(sourcePath)) {
    throw new Error(`Path escape rejected: ${relativePath}`)
  }
}

export function buildSanitizedWorkspace(
  contract: ProjectContract,
  outputPath: string,
): SanitizedWorkspace {
  const sourcePath = path.resolve(contract.sourcePath)

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path does not exist: ${sourcePath}`)
  }

  // Collect all files reachable from the source directory.
  // walkDir already prunes directories matched by excludePaths for performance.
  const allFiles: string[] = []
  walkDir(sourcePath, sourcePath, contract.includePaths, contract.excludePaths, allFiles)

  // Copy files that are included AND not excluded.
  // excludePaths wins over includePaths — this is the enforce step for any
  // files that survived directory pruning but still match an exclude pattern.
  const copiedFiles: WorkspaceFile[] = []

  for (const fullPath of allFiles) {
    const relativePath = path.relative(sourcePath, fullPath).replace(/\\/g, '/')

    const included = contract.includePaths.some(p => matchesGlob(relativePath, p))
    if (!included) continue

    const excluded = contract.excludePaths.some(p => matchesGlob(relativePath, p))
    if (excluded) continue

    // Safety checks only run for files that will actually enter the snapshot.
    assertSafePath(relativePath, sourcePath)

    const destPath = path.join(outputPath, relativePath)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(fullPath, destPath)

    copiedFiles.push({
      relativePath,
      sha256: sha256ofFile(fullPath),
    })
  }

  return {
    workspacePath: outputPath,
    manifest: {
      projectId: contract.projectId,
      sourcePath: contract.sourcePath,
      files: copiedFiles,
      createdAt: new Date().toISOString(),
    },
  }
}
