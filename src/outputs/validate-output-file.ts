export interface FileRecord {
  filename: string
  content: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateOutputFile(
  files: FileRecord[],
  expectedFilename: string,
  expectedContent: string,
): ValidationResult {
  if (files.length === 0) {
    return { valid: false, error: 'No output files found' }
  }
  if (files.length > 1) {
    return { valid: false, error: `Expected 1 output file, got ${files.length}` }
  }

  const file = files[0]!

  if (file.filename !== expectedFilename) {
    return { valid: false, error: `Wrong filename: ${file.filename}` }
  }

  if (file.content.trimEnd() !== expectedContent.trimEnd()) {
    return { valid: false, error: 'Content mismatch' }
  }

  return { valid: true }
}
