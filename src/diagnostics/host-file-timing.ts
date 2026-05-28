import fs from 'fs'
import type { FileExistenceRecord } from './event-ordering.js'

export function checkFileNow(filePath: string, label: string): FileExistenceRecord {
  const checkedAtMs = Date.now()
  const exists = fs.existsSync(filePath)
  return {
    path: filePath,
    label,
    existedAtMs: exists ? checkedAtMs : null,
    checkedAtMs,
  }
}
