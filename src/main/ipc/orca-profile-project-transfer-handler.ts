import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  TransferOrcaProfileProjectArgs,
  TransferOrcaProfileProjectResult
} from '../../shared/orca-profiles'
import { getOrcaProfileListState, setActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { transferOrcaProfileProject } from '../orca-profiles/profile-project-transfer'

export function registerOrcaProfileProjectTransferHandler(
  store: Store,
  options: {
    onBeforeRelaunch?: () => void | Promise<void>
    runBeforeProfileRelaunch: (callback?: () => void | Promise<void>) => Promise<void>
    scheduleProfileRelaunch: () => void
  }
): void {
  ipcMain.handle(
    'orcaProfiles:transferProject',
    async (
      _event,
      rawArgs: TransferOrcaProfileProjectArgs
    ): Promise<TransferOrcaProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getOrcaProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_orca_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        return moveProjectFromActiveProfile(store, args, options)
      }
      // Why: offline transfer reads the just-flushed file as ownership authority;
      // a swallowed disk error could otherwise commit stale topology and claims.
      store.flushOrThrow()
      return transferOrcaProfileProject(args, getProfileUserDataPath())
    }
  )
}

async function moveProjectFromActiveProfile(
  store: Store,
  args: TransferOrcaProfileProjectArgs,
  options: {
    onBeforeRelaunch?: () => void | Promise<void>
    runBeforeProfileRelaunch: (callback?: () => void | Promise<void>) => Promise<void>
    scheduleProfileRelaunch: () => void
  }
): Promise<TransferOrcaProfileProjectResult> {
  // Why: transfer before any relaunch side effect so validation failures do
  // not strand the app in a quitting state.
  store.flushOrThrow()
  let sourcePendingCommitted = false
  try {
    const result = transferOrcaProfileProject(args, getProfileUserDataPath(), {
      onSourcePendingCommitted: () => {
        sourcePendingCommitted = true
        // Why: stale active Store memory must not overwrite durable recovery state.
        store.freezeWrites()
      }
    })
    if (result.status === 'transferred') {
      store.freezeWrites()
      await options.runBeforeProfileRelaunch(options.onBeforeRelaunch)
      setActiveOrcaProfile(args.targetProfileId)
      options.scheduleProfileRelaunch()
      return { ...result, willRelaunch: true }
    }
    return result
  } catch (error) {
    if (sourcePendingCommitted) {
      await options.runBeforeProfileRelaunch(options.onBeforeRelaunch).catch((relaunchError) => {
        console.error('[profiles] Failed partial-transfer relaunch teardown:', relaunchError)
      })
      // Why: reload from durable source-pending state instead of frozen stale memory.
      options.scheduleProfileRelaunch()
    }
    throw error
  }
}

function transferProjectArgsFromUnknown(args: unknown): TransferOrcaProfileProjectArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_orca_profile_project_transfer')
  }
  const candidate = args as TransferOrcaProfileProjectArgs
  const sourceProfileId = candidate.sourceProfileId?.trim()
  const targetProfileId = candidate.targetProfileId?.trim()
  const repoId = candidate.repoId?.trim()
  const mode = candidate.mode
  if (!sourceProfileId || !targetProfileId || !repoId || (mode !== 'move' && mode !== 'copy')) {
    throw new Error('invalid_orca_profile_project_transfer')
  }
  return { sourceProfileId, targetProfileId, repoId, mode }
}
