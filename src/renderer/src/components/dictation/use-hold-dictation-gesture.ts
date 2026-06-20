import { useEffect, type MutableRefObject } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction, type KeybindingOverrides } from '../../../../shared/keybindings'
import type { DictationState } from '../../../../shared/speech-types'
import type { GlobalSettings } from '../../../../shared/types'
import type { DictationInsertionTarget } from './dictation-insertion-target'

type HoldDictationGestureOptions = {
  dictationStateRef: MutableRefObject<DictationState>
  holdGestureActiveRef: MutableRefObject<boolean>
  insertionTargetRef: MutableRefObject<DictationInsertionTarget | null>
  intentionalTargetCancellationRef: MutableRefObject<boolean>
  keybindings: KeybindingOverrides
  settings: GlobalSettings | null
  startDictation: () => Promise<void> | void
  stopDictation: () => Promise<void> | void
}

export function useHoldDictationGesture({
  dictationStateRef,
  holdGestureActiveRef,
  insertionTargetRef,
  intentionalTargetCancellationRef,
  keybindings,
  settings,
  startDictation,
  stopDictation
}: HoldDictationGestureOptions): void {
  // Why: hold mode uses renderer-side DOM events instead of the IPC path
  // (before-input-event). Electron suppresses keyUp after preventDefault()
  // there, so the renderer owns both press and release.
  useEffect(() => {
    const mode = settings?.voice?.dictationMode ?? 'toggle'
    if (mode !== 'hold') {
      return
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (keybindingMatchesAction('voice.dictation', e, getShortcutPlatform(), keybindings)) {
        if (!settings?.voice?.enabled || !settings.voice.sttModel) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
        holdGestureActiveRef.current = true
        if (dictationStateRef.current === 'idle') {
          void startDictation()
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (!holdGestureActiveRef.current) {
        return
      }
      // Why: releasing the modifier (e.g. Cmd) before the main key leaves
      // neither keyup matching the full chord — the Meta-up reports key 'Meta'
      // and the E-up reports metaKey=false. Treat releasing a held modifier as
      // ending the hold so dictation stops on any chord-breaking release, not
      // only when the main key is released last.
      const isModifierRelease =
        e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift'
      if (
        !isModifierRelease &&
        !keybindingMatchesAction('voice.dictation', e, getShortcutPlatform(), keybindings)
      ) {
        return
      }
      if (dictationStateRef.current === 'idle' || dictationStateRef.current === 'stopping') {
        holdGestureActiveRef.current = false
        return
      }
      holdGestureActiveRef.current = false
      void stopDictation()
    }

    const handleBlur = (): void => {
      if (!holdGestureActiveRef.current) {
        return
      }
      holdGestureActiveRef.current = false
      if (dictationStateRef.current !== 'idle' && dictationStateRef.current !== 'stopping') {
        insertionTargetRef.current = null
        intentionalTargetCancellationRef.current = true
        void stopDictation()
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') {
        handleBlur()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      handleBlur()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    settings?.voice?.dictationMode,
    settings?.voice?.enabled,
    settings?.voice?.sttModel,
    keybindings,
    startDictation,
    stopDictation,
    dictationStateRef,
    holdGestureActiveRef,
    insertionTargetRef,
    intentionalTargetCancellationRef
  ])
}
