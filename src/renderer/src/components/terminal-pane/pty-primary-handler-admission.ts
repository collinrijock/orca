import type { PtyDataMeta } from './pty-primary-handler-registry'

type PtyPrimaryHandlerAdmissionRegistry = {
  dataHandlers: Map<string, (data: string, meta?: PtyDataMeta) => void>
  replayHandlers: Map<string, (data: string) => void>
  exitHandlers: Map<string, (code: number) => void>
  teardownHandlers: Map<string, () => void>
  drainData: (
    ptyId: string,
    handler: (data: string, meta?: PtyDataMeta) => void,
    isCurrent?: () => boolean
  ) => void
  drainExit: (ptyId: string, handler: (code: number) => void) => boolean
}

export type PtyPrimaryHandlerAdmissionSnapshot = {
  ptyId: string
  dataOwner?: PtyPrimaryHandlerOwner
  exitOwner?: PtyPrimaryHandlerOwner
  dataHandler?: (data: string, meta?: PtyDataMeta) => void
  replayHandler?: (data: string) => void
  exitHandler?: (code: number) => void
  teardownHandler?: () => void
}

export type PtyPrimaryHandlerOwner = {
  active: boolean
}

const primaryDataHandlerOwners = new Map<string, PtyPrimaryHandlerOwner>()
const primaryExitHandlerOwners = new Map<string, PtyPrimaryHandlerOwner>()

export function createPtyPrimaryHandlerOwner(): PtyPrimaryHandlerOwner {
  return { active: true }
}

function publishOwner(
  owners: Map<string, PtyPrimaryHandlerOwner>,
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  const previousOwner = owners.get(ptyId)
  if (previousOwner && previousOwner !== owner) {
    previousOwner.active = false
  }
  owner.active = true
  owners.set(ptyId, owner)
}

function revokeOwner(
  owners: Map<string, PtyPrimaryHandlerOwner>,
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  owner.active = false
  if (owners.get(ptyId) === owner) {
    owners.delete(ptyId)
  }
}

export function publishPtyPrimaryDataHandlerOwner(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  publishOwner(primaryDataHandlerOwners, ptyId, owner)
}

export function revokePtyPrimaryDataHandlerOwner(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  revokeOwner(primaryDataHandlerOwners, ptyId, owner)
}

export function suspendPtyPrimaryDataHandlerOwner(
  ptyId: string
): PtyPrimaryHandlerOwner | undefined {
  const owner = primaryDataHandlerOwners.get(ptyId)
  primaryDataHandlerOwners.delete(ptyId)
  return owner
}

export function restorePtyPrimaryDataHandlerOwner(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner | undefined
): boolean {
  if (!isOwnerCurrent(primaryDataHandlerOwners, ptyId, owner)) {
    return false
  }
  primaryDataHandlerOwners.set(ptyId, owner)
  return true
}

export function isPtyPrimaryDataHandlerOwnerCurrent(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner | undefined
): boolean {
  return Boolean(owner?.active && primaryDataHandlerOwners.get(ptyId) === owner)
}

export function publishPtyPrimaryExitHandlerOwner(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  publishOwner(primaryExitHandlerOwners, ptyId, owner)
}

export function revokePtyPrimaryExitHandlerOwner(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner
): void {
  revokeOwner(primaryExitHandlerOwners, ptyId, owner)
}

export function getPtyPrimaryExitHandlerOwner(ptyId: string): PtyPrimaryHandlerOwner | undefined {
  return primaryExitHandlerOwners.get(ptyId)
}

export function isPtyPrimaryExitHandlerOwnerCurrent(
  ptyId: string,
  owner: PtyPrimaryHandlerOwner | undefined
): boolean {
  return Boolean(owner?.active && primaryExitHandlerOwners.get(ptyId) === owner)
}

function isOwnerCurrent(
  owners: Map<string, PtyPrimaryHandlerOwner>,
  ptyId: string,
  owner: PtyPrimaryHandlerOwner | undefined
): owner is PtyPrimaryHandlerOwner {
  const currentOwner = owners.get(ptyId)
  return Boolean(owner?.active && (!currentOwner || currentOwner === owner))
}

export function suspendPtyPrimaryHandlersForAdmission(
  registry: PtyPrimaryHandlerAdmissionRegistry,
  ptyId: string
): PtyPrimaryHandlerAdmissionSnapshot {
  const snapshot: PtyPrimaryHandlerAdmissionSnapshot = {
    ptyId,
    dataOwner: suspendPtyPrimaryDataHandlerOwner(ptyId),
    exitOwner: primaryExitHandlerOwners.get(ptyId),
    dataHandler: registry.dataHandlers.get(ptyId),
    replayHandler: registry.replayHandlers.get(ptyId),
    exitHandler: registry.exitHandlers.get(ptyId),
    teardownHandler: registry.teardownHandlers.get(ptyId)
  }
  registry.dataHandlers.delete(ptyId)
  registry.replayHandlers.delete(ptyId)
  registry.exitHandlers.delete(ptyId)
  registry.teardownHandlers.delete(ptyId)
  primaryExitHandlerOwners.delete(ptyId)
  return snapshot
}

export function restorePtyPrimaryHandlersAfterFailedAdmission(
  registry: PtyPrimaryHandlerAdmissionRegistry,
  snapshot: PtyPrimaryHandlerAdmissionSnapshot
): void {
  let restoredDataHandler: PtyPrimaryHandlerAdmissionSnapshot['dataHandler']
  let restoredExitHandler: PtyPrimaryHandlerAdmissionSnapshot['exitHandler']
  const dataSlotsAvailable =
    (!snapshot.dataHandler || !registry.dataHandlers.has(snapshot.ptyId)) &&
    (!snapshot.replayHandler || !registry.replayHandlers.has(snapshot.ptyId))
  if (
    dataSlotsAvailable &&
    (snapshot.dataHandler || snapshot.replayHandler) &&
    isOwnerCurrent(primaryDataHandlerOwners, snapshot.ptyId, snapshot.dataOwner)
  ) {
    if (snapshot.dataHandler) {
      registry.dataHandlers.set(snapshot.ptyId, snapshot.dataHandler)
      restoredDataHandler = snapshot.dataHandler
    }
    if (snapshot.replayHandler) {
      registry.replayHandlers.set(snapshot.ptyId, snapshot.replayHandler)
    }
    primaryDataHandlerOwners.set(snapshot.ptyId, snapshot.dataOwner)
  }
  const exitSlotsAvailable =
    (!snapshot.exitHandler || !registry.exitHandlers.has(snapshot.ptyId)) &&
    (!snapshot.teardownHandler || !registry.teardownHandlers.has(snapshot.ptyId))
  if (
    exitSlotsAvailable &&
    (snapshot.exitHandler || snapshot.teardownHandler) &&
    isOwnerCurrent(primaryExitHandlerOwners, snapshot.ptyId, snapshot.exitOwner)
  ) {
    if (snapshot.exitHandler) {
      registry.exitHandlers.set(snapshot.ptyId, snapshot.exitHandler)
      restoredExitHandler = snapshot.exitHandler
    }
    if (snapshot.teardownHandler) {
      registry.teardownHandlers.set(snapshot.ptyId, snapshot.teardownHandler)
    }
    primaryExitHandlerOwners.set(snapshot.ptyId, snapshot.exitOwner)
  }
  // Why: events emitted while admission owned no primary handler still belong
  // to the restored generation when the replacement request itself failed.
  if (restoredDataHandler) {
    registry.drainData(snapshot.ptyId, restoredDataHandler, () => {
      return (
        snapshot.dataOwner?.active === true &&
        primaryDataHandlerOwners.get(snapshot.ptyId) === snapshot.dataOwner &&
        registry.dataHandlers.get(snapshot.ptyId) === restoredDataHandler
      )
    })
  }
  if (
    restoredExitHandler &&
    snapshot.exitOwner?.active === true &&
    primaryExitHandlerOwners.get(snapshot.ptyId) === snapshot.exitOwner &&
    registry.exitHandlers.get(snapshot.ptyId) === restoredExitHandler
  ) {
    registry.drainExit(snapshot.ptyId, restoredExitHandler)
  }
}
