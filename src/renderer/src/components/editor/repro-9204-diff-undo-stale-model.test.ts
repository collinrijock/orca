/**
 * Repro for issue #9204: "Undo (Cmd/Ctrl+Z) fails in Diff View after saving,
 * and manually reverting changes forces previously edited code to reappear."
 *
 * This test PINS the CURRENT (buggy) behavior. It PASSES on the current tree
 * while asserting the WRONG result; assertions that encode the bug are marked
 * with "BUG:" and the correct behavior is noted next to them.
 *
 * What is REAL product code here (imported, not reimplemented):
 *   - getDiffContentSignature()            (./diff-content-signature)
 *   - getDiffViewerMonacoModelPaths()      (./diff-monaco-model-disposal)
 *   These are exactly what EditorContent.tsx uses to build the diff tab's React
 *   `key`, the `modifiedModelKey`, and DiffViewer's `modifiedModelPath`
 *   (EditorContent.tsx:962-966, DiffViewer.tsx:456-458).
 *
 * What is a FAITHFUL, source-verified stand-in (third-party, not product):
 *   - `getOrCreateModel` / the Monaco model registry mirror the exact logic in
 *     @monaco-editor/react@4.7.0 `DiffEditor` (node_modules/@monaco-editor/react/
 *     dist/index.js): `b(monaco,value,lang,path) = getModel(path) || createModel(value,path)`.
 *     With `keepCurrentModifiedModel` the old modified model is NOT disposed on
 *     unmount, so a model URI can be resurrected on a later mount, returning its
 *     STALE content and IGNORING the `modified` prop.
 *
 * Root cause: the modified-side model identity (React key + modifiedModelPath) is
 * a pure function of getDiffContentSignature(dc.modifiedContent). A save mutates
 * dc.modifiedContent to the just-saved text (useEditorPanelExternalContentEvents
 * .ts:91-97), so the model URI rotates on every save -> the DiffViewer remounts
 * with a brand-new Monaco model (empty undo stack). Because content signatures
 * repeat, reverting to a previous value rotates the URI back to a KEPT stale
 * model that still holds the earlier edit -> the edited code reappears.
 */
import { describe, expect, it } from 'vitest'
import { getDiffContentSignature } from './diff-content-signature'
import { getDiffViewerMonacoModelPaths } from './diff-monaco-model-disposal'

// --- Faithful port of Monaco's model registry (documented API contract) ------
type FakeModel = { uri: string; value: string; readonly createdSeq: number }

class FakeMonaco {
  private models = new Map<string, FakeModel>()
  private seq = 0
  createdCount = 0

  // Monaco: editor.getModel(uri) -> existing model or null.
  getModel(uri: string): FakeModel | null {
    return this.models.get(uri) ?? null
  }

  // Monaco: editor.createModel(value, lang, uri).
  createModel(value: string, uri: string): FakeModel {
    const model: FakeModel = { uri, value, createdSeq: (this.seq += 1) }
    this.models.set(uri, model)
    this.createdCount += 1
    return model
  }
}

// @monaco-editor/react 4.7.0 `b()`: getModel(path) || createModel(value, path).
function getOrCreateModel(monaco: FakeMonaco, value: string, path: string): FakeModel {
  return monaco.getModel(path) ?? monaco.createModel(value, path)
}

// Mirror of EditorContent.tsx:962-966 model-identity derivation (REAL fns).
function deriveModifiedModelPath(params: {
  diffViewStateKey: string
  fetchedModifiedContent: string // dc.modifiedContent
  diffReloadNonce: number
}): string {
  const { diffViewStateKey, fetchedModifiedContent, diffReloadNonce } = params
  const modifiedModelKey = `${diffViewStateKey}:modified:${getDiffContentSignature(
    fetchedModifiedContent
  )}:${diffReloadNonce}`
  return getDiffViewerMonacoModelPaths({
    modelKey: diffViewStateKey,
    originalModelKey: `${diffViewStateKey}:original:orig`,
    modifiedModelKey,
    generationSuffix: ''
  }).modifiedModelPath
}

// React `key` for the DiffViewer (EditorContent.tsx:966). Changing this remounts
// the DiffEditor, which is why saving wipes the undo stack.
function deriveViewerKey(fetchedModifiedContent: string, diffReloadNonce: number): string {
  return `scope:${diffReloadNonce}:${getDiffContentSignature(fetchedModifiedContent)}`
}

/**
 * Minimal simulation of the editable unstaged diff tab lifecycle, wiring the REAL
 * identity fns to the FAITHFUL Monaco registry. `dc.modifiedContent` starts as
 * the git-fetched working-tree content and is overwritten with the saved content
 * on save (the exact reducer in useEditorPanelExternalContentEvents.ts:91-97).
 */
class DiffTabHarness {
  private readonly diffViewStateKey = 'wt1:foo.ts:unstaged'
  private readonly nonce = 0
  private fetchedModified: string // dc.modifiedContent
  private editBuffer: string | undefined // editorDrafts[id]
  private mountedModelPath: string
  private mountedModel: FakeModel
  mountedViewerKey: string

  constructor(private readonly monaco: FakeMonaco, initialWorkingTree: string) {
    this.fetchedModified = initialWorkingTree
    this.editBuffer = undefined
    this.mountedModelPath = deriveModifiedModelPath({
      diffViewStateKey: this.diffViewStateKey,
      fetchedModifiedContent: this.fetchedModified,
      diffReloadNonce: this.nonce
    })
    this.mountedViewerKey = deriveViewerKey(this.fetchedModified, this.nonce)
    // Fresh mount: DiffEditor calls getOrCreateModel(modified prop, path).
    this.mountedModel = getOrCreateModel(this.monaco, this.displayedModified(), this.mountedModelPath)
  }

  private displayedModified(): string {
    // EditorContent.tsx: modifiedDiffContent = editBuffers[id] ?? dc.modifiedContent
    return this.editBuffer ?? this.fetchedModified
  }

  /** User types in the modified pane (mutates the live Monaco model in place). */
  type(next: string): void {
    this.editBuffer = next
    this.mountedModel.value = next // onDidChangeModelContent -> setEditorDraft
  }

  /** What the user currently sees in the modified pane. */
  visibleContent(): string {
    return this.mountedModel.value
  }

  /** True if the currently mounted model was created on the latest mount. */
  undoStackIsFreshFromLastMount(mountSeqBefore: number): boolean {
    return this.mountedModel.createdSeq > mountSeqBefore
  }

  modelSeq(): number {
    return this.mountedModel.createdSeq
  }

  /**
   * Cmd/Ctrl+S: write editBuffer to disk, FILE_SAVED updates dc.modifiedContent
   * to the saved text and clears the draft, then React re-renders. If the viewer
   * key changed, the DiffEditor remounts (keepCurrentModifiedModel keeps the old
   * model alive). Returns the mount seq observed *before* the (possible) remount.
   */
  save(): { remounted: boolean; mountSeqBefore: number } {
    const saved = this.displayedModified()
    // useEditorPanelExternalContentEvents.ts:91-97 — dc.modifiedContent := saved.
    this.fetchedModified = saved
    this.editBuffer = undefined // clearEditorDraft (editor-autosave-controller.ts:156)

    const nextViewerKey = deriveViewerKey(this.fetchedModified, this.nonce)
    const nextModelPath = deriveModifiedModelPath({
      diffViewStateKey: this.diffViewStateKey,
      fetchedModifiedContent: this.fetchedModified,
      diffReloadNonce: this.nonce
    })
    const mountSeqBefore = this.mountedModel.createdSeq
    const remounted = nextViewerKey !== this.mountedViewerKey
    if (remounted) {
      // NOTE: keepCurrentModifiedModel=true => old model is NOT disposed here.
      this.mountedViewerKey = nextViewerKey
      this.mountedModelPath = nextModelPath
      this.mountedModel = getOrCreateModel(this.monaco, saved, nextModelPath)
    }
    return { remounted, mountSeqBefore }
  }
}

describe('issue #9204 — diff-view undo/stale-model desync after save', () => {
  it('rotates the modified model URI on save, then collides it on revert', () => {
    // The model identity is a pure function of the fetched modified content, so
    // A -> B changes the URI (remount) and B -> A returns to the SAME URI as A.
    const key = 'wt1:foo.ts:unstaged'
    const pathA = deriveModifiedModelPath({
      diffViewStateKey: key,
      fetchedModifiedContent: 'line one\n',
      diffReloadNonce: 0
    })
    const pathB = deriveModifiedModelPath({
      diffViewStateKey: key,
      fetchedModifiedContent: 'line one EDITED\n',
      diffReloadNonce: 0
    })
    const pathAAgain = deriveModifiedModelPath({
      diffViewStateKey: key,
      fetchedModifiedContent: 'line one\n',
      diffReloadNonce: 0
    })

    // Correct design would keep ONE stable modified model for the tab's lifetime.
    // BUG: saving rotates the URI (forces a new model => undo stack reset).
    expect(pathB).not.toBe(pathA)
    // BUG: reverting rotates the URI back to a URI that already exists and is
    // kept alive with stale content (resurrection).
    expect(pathAAgain).toBe(pathA)
  })

  it('SYMPTOM 1: undo stack is wiped after saving (new Monaco model on save)', () => {
    const monaco = new FakeMonaco()
    const tab = new DiffTabHarness(monaco, 'const x = 1\n')
    const originalModelSeq = tab.modelSeq()

    tab.type('const x = 2\n') // user edits the modified pane
    const { remounted, mountSeqBefore } = tab.save() // Cmd/Ctrl+S

    // BUG: a save remounts the DiffEditor and creates a brand-new Monaco model,
    // so the edit history the user needs for Cmd/Ctrl+Z is gone. Correct
    // behavior: the same model (and its undo stack) survives a save.
    expect(remounted).toBe(true)
    expect(tab.undoStackIsFreshFromLastMount(mountSeqBefore)).toBe(true)
    expect(tab.modelSeq()).not.toBe(originalModelSeq)
  })

  it('SYMPTOM 2: manual revert + save resurrects the previously edited content', () => {
    const monaco = new FakeMonaco()
    const tab = new DiffTabHarness(monaco, 'hello world\n')

    // Step 2-3: edit to the "bad" text and save it.
    tab.type('hello EDITED\n')
    tab.save()
    expect(tab.visibleContent()).toBe('hello EDITED\n')

    // Step 5: manually revert back to the original text and save again.
    tab.type('hello world\n')
    tab.save()

    // Expected: the pane shows the restored original 'hello world\n'.
    // BUG: the modified model URI rotated back to the original URI, whose KEPT
    // (never-disposed) model still holds 'hello EDITED\n'. @monaco-editor/react
    // reuses that stale model as-is and ignores the `modified` prop, so the
    // previously edited code reappears, overwriting the manual restoration.
    expect(tab.visibleContent()).toBe('hello EDITED\n')
    expect(tab.visibleContent()).not.toBe('hello world\n')
  })
})
