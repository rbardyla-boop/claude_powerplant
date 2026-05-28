export interface ObservedEvent {
  type: string
  stopReasonType?: string
  toolUseId?: string
  toolName?: string
  timestampMs: number
}

export interface FileExistenceRecord {
  path: string
  label: string
  existedAtMs: number | null
  checkedAtMs: number
}

export interface AlwaysAskConformanceResult {
  conformant: boolean
  anomaly: boolean
  inconclusive: boolean
  requiresActionBeforeConfirmation: boolean
  fileExistedBeforeConfirmation: boolean | null
  fileExistedAfterAllow: boolean | null
  fileExistedAfterDeny: boolean | null
  eventSequence: ObservedEvent[]
  summary: string
}

export interface OutputPathComplianceResult {
  c1AbsoluteWriteSucceeded: boolean | null
  c1FileFoundOnHost: boolean | null
  c2RelativeWriteSucceeded: boolean | null
  c2FileFoundOnHost: boolean | null
  bashWriteSucceeded: boolean | null
  bashFileFoundOnHost: boolean | null
  contractPath: '/mnt/session/outputs'
  summary: string
}

export function classifyAlwaysAskConformance(
  events: ObservedEvent[],
  fileBeforeConfirmation: FileExistenceRecord | null,
  fileAfterAllow: FileExistenceRecord | null,
  fileAfterDeny: FileExistenceRecord | null,
): AlwaysAskConformanceResult {
  // Check whether requires_action arrived before any confirmation was sent
  const requiresActionEvent = events.find(
    e => e.type === 'session.status_idle' && e.stopReasonType === 'requires_action',
  )
  const requiresActionBeforeConfirmation = requiresActionEvent !== undefined

  const fileBeforeConf: boolean | null = fileBeforeConfirmation !== null
    ? fileBeforeConfirmation.existedAtMs !== null
    : null

  const fileAfterAllowExists: boolean | null = fileAfterAllow !== null
    ? fileAfterAllow.existedAtMs !== null
    : null

  const fileAfterDenyExists: boolean | null = fileAfterDeny !== null
    ? fileAfterDeny.existedAtMs !== null
    : null

  // Conformant: requires_action fired, file did NOT exist before confirmation,
  // file appeared after allow (and not after deny in the deny variant)
  const seemsConformant =
    requiresActionBeforeConfirmation &&
    fileBeforeConf === false &&
    fileAfterAllowExists === true

  // Anomaly: file appeared before confirmation could be sent (tool ran without waiting)
  const seemsAnomalous = fileBeforeConf === true

  const inconclusive = !seemsConformant && !seemsAnomalous

  let summary: string
  if (seemsConformant) {
    summary = 'CONFORMANT — requires_action fired before confirmation; file absent before allow; file present after allow.'
  } else if (seemsAnomalous) {
    summary = 'ANOMALY — file appeared before any confirmation was posted; tool did not wait for requires_action confirmation gate.'
  } else {
    summary = 'INCONCLUSIVE — requires_action arrived but file state after confirmation was ambiguous.'
  }

  return {
    conformant: seemsConformant,
    anomaly: seemsAnomalous,
    inconclusive,
    requiresActionBeforeConfirmation,
    fileExistedBeforeConfirmation: fileBeforeConf,
    fileExistedAfterAllow: fileAfterAllowExists,
    fileExistedAfterDeny: fileAfterDenyExists,
    eventSequence: events,
    summary,
  }
}

export function classifyOutputPathCompliance(
  c1AbsoluteWriteIsError: boolean | null,
  c1FileOnHost: boolean,
  c2RelativeWriteIsError: boolean | null,
  c2FileOnHost: boolean,
  bashWriteIsError: boolean | null,
  bashFileOnHost: boolean,
): OutputPathComplianceResult {
  const c1AbsoluteWriteSucceeded = c1AbsoluteWriteIsError === null ? null : !c1AbsoluteWriteIsError
  const c2RelativeWriteSucceeded = c2RelativeWriteIsError === null ? null : !c2RelativeWriteIsError
  const bashWriteSucceeded = bashWriteIsError === null ? null : !bashWriteIsError

  const parts: string[] = []
  if (c1AbsoluteWriteSucceeded === true && c1FileOnHost) {
    parts.push('C1(absolute-path write succeeded, file found on host at /mnt/session/outputs)')
  } else if (c1AbsoluteWriteSucceeded === false) {
    parts.push('C1(absolute-path write failed in container)')
  } else {
    parts.push('C1(inconclusive)')
  }

  if (c2RelativeWriteSucceeded === true && c2FileOnHost) {
    parts.push('C2(relative-path write succeeded, file found on host via workdir mount)')
  } else if (c2RelativeWriteSucceeded === false) {
    parts.push('C2(relative-path write failed in container)')
  } else {
    parts.push('C2(inconclusive)')
  }

  if (bashWriteSucceeded === true && bashFileOnHost) {
    parts.push('D(bash redirect to /mnt/session/outputs succeeded, file found on host)')
  } else if (bashWriteSucceeded === false) {
    parts.push('D(bash redirect failed in container)')
  } else {
    parts.push('D(inconclusive)')
  }

  return {
    c1AbsoluteWriteSucceeded,
    c1FileFoundOnHost: c1FileOnHost,
    c2RelativeWriteSucceeded,
    c2FileFoundOnHost: c2FileOnHost,
    bashWriteSucceeded,
    bashFileFoundOnHost: bashFileOnHost,
    contractPath: '/mnt/session/outputs',
    summary: parts.join('; '),
  }
}
