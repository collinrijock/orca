import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./use-mobile-dictation.ts', import.meta.url), 'utf8')
const audioChunkSource = readFileSync(
  new URL('./mobile-dictation-audio-chunk.ts', import.meta.url),
  'utf8'
)
const keepAwakeSource = readFileSync(
  new URL('./mobile-dictation-keep-awake.ts', import.meta.url),
  'utf8'
)
const desktopStartSource = readFileSync(
  new URL('./mobile-dictation-desktop-start.ts', import.meta.url),
  'utf8'
)
const sessionStateSource = readFileSync(
  new URL('./mobile-dictation-session-state.ts', import.meta.url),
  'utf8'
)

function sliceSource(sourceText: string, startPattern: string, endPattern: string): string {
  const start = sourceText.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sourceText.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return sourceText.slice(start, end)
}

function sliceBetween(startPattern: string, endPattern: string): string {
  return sliceSource(source, startPattern, endPattern)
}

function sliceDesktopStartBetween(startPattern: string, endPattern: string): string {
  return sliceSource(desktopStartSource, startPattern, endPattern)
}

describe('useMobileDictation source invariants', () => {
  it('publishes live option refs from committed renders before passive Effects flush', () => {
    const refDeclarations = sliceBetween(
      'const clientRef = useRef(client)',
      'useLayoutEffect(() => {'
    )
    expect(refDeclarations).not.toContain('.current =')

    const mirrorEffect = sliceBetween('useLayoutEffect(() => {', 'const reportError =')
    expect(mirrorEffect).toContain('clientRef.current = client')
    expect(mirrorEffect).toContain('enabledRef.current = enabled')
    expect(mirrorEffect).toContain('onTranscriptRef.current = onTranscript')
    expect(mirrorEffect).toContain('onErrorRef.current = onError')
    expect(mirrorEffect).toContain('}, [client, enabled, onTranscript, onError])')
  })

  it('reserves pending audio bytes before encoding microphone chunks', () => {
    const microphoneEffect = sliceSource(
      audioChunkSource,
      'export function enqueueMobileDictationAudioChunk',
      '  queue.pendingChunks.add(sendChunk)'
    )

    const reserveIndex = microphoneEffect.indexOf('tryReserve(byteLength)')
    const encodeIndex = microphoneEffect.indexOf('bytesToBase64(bytes)')
    expect(reserveIndex).toBeGreaterThanOrEqual(0)
    expect(encodeIndex).toBeGreaterThanOrEqual(0)
    expect(reserveIndex).toBeLessThan(encodeIndex)
    expect(microphoneEffect).toContain('MOBILE_DICTATION_CONNECTION_SLOW_ERROR_MESSAGE')
    expect(microphoneEffect).toContain('queue.pendingAudioBudget.release(byteLength)')
    expect(source).toContain('enqueueMobileDictationAudioChunk(client, dictationId, event')
  })

  it('reuses audio chunk queue wiring across microphone events', () => {
    const queueIndex = source.indexOf('const audioChunkQueue =')
    const listenerIndex = source.indexOf("addExpoTwoWayAudioEventListener('onMicrophoneData'")

    expect(queueIndex).toBeGreaterThanOrEqual(0)
    expect(queueIndex).toBeLessThan(listenerIndex)
    expect(source).toContain(
      'enqueueMobileDictationAudioChunk(client, dictationId, event, audioChunkQueue)'
    )
  })

  it('resets pending audio bytes whenever pending chunk tracking is cleared', () => {
    const pendingChunkClears = source.match(/pendingChunksRef\.current\.clear\(\)/g) ?? []
    const pendingAudioResets = source.match(/pendingAudioBudgetRef\.current\.reset\(\)/g) ?? []

    expect(pendingAudioResets).toHaveLength(pendingChunkClears.length)
  })

  it('keeps mobile dictation keep-awake ownership beside the hook', () => {
    expect(source).toContain(
      "import { createMobileDictationKeepAwakeOwner } from './mobile-dictation-keep-awake'"
    )
    expect(source).toContain(
      'const keepAwakeOwner = useMemo(createMobileDictationKeepAwakeOwner, [])'
    )
    expect(keepAwakeSource).toContain('activateKeepAwakeAsync')
    expect(keepAwakeSource).toContain('deactivateKeepAwake')
    expect(keepAwakeSource).not.toMatch(/\bactivateKeepAwake\s*\(/)
  })

  it('acquires keep-awake only after desktop start and stale-start guards', () => {
    const hookStartBody = sliceBetween('const start = useCallback(async () => {', 'const stop =')
    const startBody = sliceDesktopStartBetween(
      'export async function startMobileDictationDesktopSession',
      '  return true'
    )
    const desktopStartIndex = startBody.indexOf(
      "client.sendRequest('speech.dictation.start', { dictationId })"
    )
    const acquireIndex = startBody.indexOf('await keepAwakeOwner.acquire(dictationId)')
    const desktopSessionIndex = hookStartBody.indexOf('await startMobileDictationDesktopSession')
    const toggleRecordingIndex = hookStartBody.indexOf('toggleRecording(true)')

    expect(desktopStartIndex).toBeGreaterThanOrEqual(0)
    expect(acquireIndex).toBeGreaterThan(desktopStartIndex)
    expect(desktopSessionIndex).toBeGreaterThanOrEqual(0)
    expect(toggleRecordingIndex).toBeGreaterThan(desktopSessionIndex)

    const beforeAcquire = startBody.slice(desktopStartIndex, acquireIndex)
    expect(beforeAcquire).toContain('isCurrentStart(options)')
    expect(desktopStartSource).toContain('options.getCurrentGeneration()')
    expect(desktopStartSource).toContain('options.getEnabled()')
    expect(desktopStartSource).toContain('options.getActiveId()')
    expect(sessionStateSource).toContain(
      'currentGeneration === generation && enabled && activeId === dictationId'
    )
  })

  it('re-checks stale-start guards after awaited keep-awake acquisition', () => {
    const startBody = sliceDesktopStartBetween(
      'export async function startMobileDictationDesktopSession',
      '  return true'
    )
    const acquireIndex = startBody.indexOf('await keepAwakeOwner.acquire(dictationId)')
    const returnStartedIndex = startBody.indexOf('return true')
    const afterAcquire = startBody.slice(acquireIndex, returnStartedIndex)

    expect(afterAcquire).toContain('isCurrentStart(options)')
    expect(desktopStartSource).toContain('options.getCurrentGeneration()')
    expect(desktopStartSource).toContain('options.getEnabled()')
    expect(desktopStartSource).toContain('options.getActiveId()')
    expect(afterAcquire).toContain(
      'await keepAwakeOwner.release(dictationId).catch(() => undefined)'
    )
    expect(afterAcquire).toContain("client.sendRequest('speech.dictation.cancel', { dictationId })")
  })

  it('only reports keep-awake acquisition failures for the current start', () => {
    const startBody = sliceDesktopStartBetween(
      'export async function startMobileDictationDesktopSession',
      '  return true'
    )
    const acquireIndex = startBody.indexOf('await keepAwakeOwner.acquire(dictationId)')
    const catchIndex = startBody.indexOf('} catch (err)', acquireIndex)
    const staleCleanupIndex = startBody.indexOf('await keepAwakeOwner.release', catchIndex)
    expect(catchIndex).toBeGreaterThan(acquireIndex)
    expect(staleCleanupIndex).toBeGreaterThan(catchIndex)
    const acquireFailurePath = startBody.slice(catchIndex, staleCleanupIndex)

    expect(acquireFailurePath).toContain('catch (err)')
    expect(acquireFailurePath).toContain('isCurrentStart(options)')
    expect(acquireFailurePath).toContain('return')
    expect(acquireFailurePath).toContain('options.clearActiveId(dictationId)')
    expect(acquireFailurePath).toContain('setIdleIfGenerationCurrent(options)')
    expect(acquireFailurePath).toContain('throw err')
    expect(acquireFailurePath).not.toContain('keepAwakeOwner.release')
  })

  it('releases keep-awake on all dictation cleanup paths without delaying recording shutdown', () => {
    const closeAudio = sliceBetween(
      'const closeDictationAudio = useCallback(',
      'const failActiveDictation ='
    )
    expect(closeAudio.indexOf('toggleRecording(false)')).toBeLessThan(
      closeAudio.indexOf('void keepAwakeOwner.release')
    )
    expect(closeAudio).toContain('.catch(() => undefined)')

    const cleanupSlices = [
      sliceBetween('const failActiveDictation = useCallback(', 'useEffect(() => {'),
      sliceBetween('const cancel = useCallback(async () => {', 'useEffect(() => {\n    const sub'),
      sliceBetween('return () => {\n      const dictationId = activeIdRef.current', '  return {')
    ]

    for (const cleanupSlice of cleanupSlices) {
      expect(cleanupSlice).toContain('closeDictationAudio(dictationId)')
    }

    const stopBody = sliceBetween('const stop = useCallback(async () => {', 'const cancel =')
    expect(stopBody.indexOf('toggleRecording(false)')).toBeLessThan(
      stopBody.indexOf('void keepAwakeOwner.release')
    )
    expect(stopBody.indexOf('void keepAwakeOwner.release')).toBeLessThan(
      stopBody.indexOf('await Promise.allSettled')
    )
    expect(stopBody.indexOf('void keepAwakeOwner.release')).toBeLessThan(
      stopBody.indexOf('speech.dictation.finish')
    )
  })

  it('routes disabled state and audio interruptions through cancel cleanup', () => {
    const interruptionEffect = sliceBetween(
      "addExpoTwoWayAudioEventListener('onAudioInterruption'",
      'return () => sub.remove()'
    )
    const disabledEffect = sliceBetween(
      'useEffect(() => {\n    if (!enabled) {',
      '  }, [cancel, enabled])'
    )

    expect(interruptionEffect).toContain("event.data === 'began' || event.data === 'blocked'")
    expect(interruptionEffect).toContain('void cancel()')
    expect(disabledEffect).toContain('void cancel()')
  })

  it('uses per-owner dictation keep-awake tags and serializes async ownership changes', () => {
    expect(keepAwakeSource).toContain('private readonly ownerId = createOwnerId()')
    expect(keepAwakeSource).toContain(
      '`${MOBILE_DICTATION_KEEP_AWAKE_TAG_PREFIX}:${this.ownerId}:${dictationId}`'
    )
    expect(keepAwakeSource).toContain('let keepAwakeOperation: Promise<void> = Promise.resolve()')
    expect(keepAwakeSource).toContain('const pendingCleanupTags = new Set<string>()')
    expect(keepAwakeSource.match(/enqueueKeepAwakeOperation/g)?.length).toBeGreaterThanOrEqual(3)
    expect(keepAwakeSource).toContain(
      'const targetTag = dictationId ? this.createTag(dictationId) : null'
    )
    expect(keepAwakeSource).toContain('if (!tag || (targetTag && tag !== targetTag))')
    expect(keepAwakeSource).toContain('await cleanupPendingTags()')
  })
})
