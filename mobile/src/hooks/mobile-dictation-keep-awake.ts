import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

const MOBILE_DICTATION_KEEP_AWAKE_TAG_PREFIX = 'orca-mobile-dictation'

let nextOwnerId = 0
let keepAwakeOperation: Promise<void> = Promise.resolve()
const activeTags = new Set<string>()
const pendingCleanupTags = new Set<string>()

function createOwnerId(): string {
  nextOwnerId += 1
  return `${Date.now()}-${nextOwnerId}-${Math.random().toString(36).slice(2)}`
}

function enqueueKeepAwakeOperation(action: () => Promise<void>): Promise<void> {
  const operation = keepAwakeOperation.then(action)
  keepAwakeOperation = operation.catch(() => undefined)
  return operation
}

async function deactivateTrackedTag(tag: string): Promise<void> {
  try {
    await deactivateKeepAwake(tag)
  } catch (err) {
    // A replacement hook must be able to retry cleanup after Android replaces
    // an Activity and the owner that acquired this tag has unmounted.
    pendingCleanupTags.add(tag)
    throw err
  }
  activeTags.delete(tag)
  pendingCleanupTags.delete(tag)
}

async function cleanupPendingTags(): Promise<void> {
  for (const tag of Array.from(pendingCleanupTags)) {
    await deactivateTrackedTag(tag)
  }
}

export class MobileDictationKeepAwakeOwner {
  private readonly ownerId = createOwnerId()
  private acquiredTag: string | null = null

  acquire(dictationId: string): Promise<void> {
    const tag = this.createTag(dictationId)
    return enqueueKeepAwakeOperation(async () => {
      await cleanupPendingTags()
      if (this.acquiredTag && !activeTags.has(this.acquiredTag)) {
        this.acquiredTag = null
      }
      if (this.acquiredTag === tag) {
        return
      }
      if (this.acquiredTag) {
        const previousTag = this.acquiredTag
        await deactivateTrackedTag(previousTag)
        this.acquiredTag = null
      }
      await activateKeepAwakeAsync(tag)
      activeTags.add(tag)
      this.acquiredTag = tag
    })
  }

  release(dictationId?: string): Promise<void> {
    const targetTag = dictationId ? this.createTag(dictationId) : null
    return enqueueKeepAwakeOperation(async () => {
      const tag = this.acquiredTag
      if (!tag || (targetTag && tag !== targetTag)) {
        return
      }
      if (!activeTags.has(tag)) {
        this.acquiredTag = null
        return
      }
      await deactivateTrackedTag(tag)
      this.acquiredTag = null
    })
  }

  private createTag(dictationId: string): string {
    return `${MOBILE_DICTATION_KEEP_AWAKE_TAG_PREFIX}:${this.ownerId}:${dictationId}`
  }
}

export function createMobileDictationKeepAwakeOwner(): MobileDictationKeepAwakeOwner {
  return new MobileDictationKeepAwakeOwner()
}
