# Peek References Scrollbar Stability

## Problem

- Issue: GitHub #7405 reports that Command-clicking a symbol opens Monaco Peek References, but the scrollbar inside the peek panel collapses on its own.
- Recording: `/Users/jinjingliang/Downloads/editor.mp4` shows Monaco's inline `References (9)` widget with a scrollable preview pane and references tree. The vertical thumb is visible immediately after open/scroll, then fades away while the peek panel stays open.
- Orca's full-height source editor mounts `@monaco-editor/react` at `src/renderer/src/components/editor/MonacoEditor.tsx:823`. When `autoHeight` is false, `options.scrollbar` is `undefined` at `src/renderer/src/components/editor/MonacoEditor.tsx:845-850`, so Monaco's default scrollbar visibility applies.
- Monaco's Peek References widget sets the container class to `reference-zone-widget` at `node_modules/monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/peek/referencesWidget.js:280`. Its preview editor scrollbar options set `verticalScrollbarSize: 14` but do not set `vertical: 'visible'` at `referencesWidget.js:289-296`; the references tree is created at `referencesWidget.js:307-332` and is also Monaco-owned.
- Monaco defaults scrollbar visibility to `auto` at `node_modules/monaco-editor/esm/vs/base/browser/ui/scrollbar/scrollableElement.js:584-589`. `ScrollableElement` schedules hide after reveal with `HIDE_TIMEOUT = 500` at `scrollableElement.js:19` and `scrollableElement.js:487-489`. `ScrollbarVisibilityController` changes the DOM node from `visible scrollbar vertical` to `invisible scrollbar vertical fade` at `scrollbarVisibilityController.js:83-89`.

## Root Cause

Peek References uses nested Monaco scrollables whose vertical visibility remains `auto`. When a scrollbar is needed, Monaco can reveal it, then the 500ms hide timer marks it `invisible ... fade`; Monaco's CSS sets that state to `opacity: 0` and `pointer-events: none`. Initially unnecessary scrollbars are plain `invisible`, but a scrollbar that was already hidden with `fade` can keep that class if overflow later disappears. Orca does not currently scope an override to the faded Peek References state, so users lose the visible affordance and drag target inside the inline reference viewer while overflow still exists.

## Non-Goals

- Do not fork, patch, or monkey-patch Monaco package code.
- Do not set the parent `Editor` scrollbar to always visible; that would restyle the normal file editor and still would not directly own the references tree.
- Do not change normal editor, diff editor, sidebar, popover, terminal, or native browser scrollbar behavior.
- Do not alter Peek References layout, result selection, split-pane sizing, colors, language-service behavior, or keyboard handling.
- Do not add a fourth Orca scrollbar class. This is a targeted compatibility override for Monaco-owned DOM, not a reusable app scrollbar style.

## Design

Add one scoped global CSS override in `src/renderer/src/assets/main.css`, near existing Monaco-specific overrides:

```css
.monaco-editor .reference-zone-widget .monaco-scrollable-element > .invisible.scrollbar.vertical.fade {
  opacity: 1;
  pointer-events: auto;
}
```

Include a short "why" comment: Monaco owns Peek References and auto-hides a needed scrollbar while the widget remains open.

Use the exact vertical scrollbar state Monaco emits. The selector is intentionally more specific than Monaco's base `.monaco-scrollable-element > .invisible` rule so it does not rely on CSS import order or `!important` for opacity or hit testing. Do not target `.scrollbar.horizontal`, all `.invisible` scrollbars, all Monaco editors, or Orca's `.scrollbar-*` classes. Do not restyle the slider color, track, width, radius, layout, background, or z-index; Monaco theme variables and component-specific stacking rules should still own the appearance.

This selector does not literally test Monaco's private `_isNeeded` flag because no DOM class exposes it. It relies on `fade` being applied only after a scrollbar was revealed and then hidden. In Monaco 0.55.1, if overflow later disappears while the controller is already hidden, `_hide(false)` can return early and leave the `fade` class on the DOM node. That is the main risk of the CSS-only approach and must be validated directly.

## Data Flow

- User Command-clicks a symbol, or uses the platform equivalent, in Orca's Monaco editor.
- Monaco opens `ReferenceWidget` inside the editor as `.reference-zone-widget`.
- The preview editor and/or references tree reveals a vertical scrollbar, then Monaco's hide timer assigns `invisible scrollbar vertical fade`.
- Orca CSS keeps only that faded vertical scrollbar in the peek widget visible and draggable.
- Other Monaco and Orca scrollbars continue through their existing hide/reveal paths.

## Edge Cases

- Result count fits without overflow on initial open: should not show a fake scrollbar because Monaco starts unneeded scrollbars as `invisible scrollbar vertical` without `fade`.
- Preview editor and references tree both overflow: both vertical thumbs should remain visible after the 500ms hide timeout and still visible after the native 800ms fade window would have completed.
- Widget/window resize after a scrollbar has already faded: verify a scrollbar does not remain visibly stale if the same pane grows large enough to no longer overflow. Monaco may keep `invisible ... fade` after `_isNeeded` flips false because the controller is already hidden, so this is a blocking validation case for the CSS-only approach.
- Horizontal overflow in a long reference line: horizontal scrollbars must still fade normally.
- Main file editor, diff editor, combined diff review, sidebars, popovers, and terminal: no visual or hit-target changes.
- Dark and light themes: keep Monaco's own scrollbar colors, background, and stacking; only visibility and pointer events are restored.
- Mouse, trackpad, keyboard navigation, and screen-reader state: no listeners, timers, ARIA, focus, or scroll-position code changes are added.
- Multi-window and concurrent widgets: the override is renderer-local CSS and has no shared state. Multiple windows or multiple peek widgets get the same scoped behavior independently.
- External file/reference mutations while peek is open: Monaco still owns reference data and layout. If references shrink or preview content changes under the same open widget, verify the rendered scrollbar state still matches actual overflow.
- SSH/remote worktrees: renderer-only CSS change, no local path, provider, process, or IPC assumptions.
- Monaco upgrade: if Monaco renames `reference-zone-widget`, `monaco-scrollable-element`, or scrollbar state classes, the fix silently stops applying. Keep this risk in the implementation comment or PR notes.

## Test Plan

- Static: inspect the final selector and confirm it includes `.reference-zone-widget`, `.monaco-scrollable-element >`, `.scrollbar.vertical.invisible.fade`, and does not target `.horizontal` or all `.invisible` scrollbars.
- Lint: run `pnpm lint`. This exercises the repo's normal lint gates and the JSX styled-scrollbar policy, but it does not prove the new CSS selector is semantically correct.
- Type: run `pnpm typecheck` as the standard broad gate; no TypeScript behavior should change.
- Build: run `pnpm build:electron-vite` once so `main.css` is parsed and bundled; lint/typecheck do not validate raw CSS syntax.
- Electron validation: open a code file with enough references, use the platform shortcut or references command to open Peek References, move the pointer outside the peek widget/editor scrollable area, wait at least 1.5 seconds, and confirm the Peek References vertical scrollbar remains visible and draggable.
- Electron DOM check: for the post-idle golden path, verify the tested vertical scrollbar is in Monaco's `invisible ... fade` state with restored computed `opacity` and `pointer-events`; a hover-revealed `.visible` scrollbar must not count as a pass.
- Electron resize/content-fit validation: after the scrollbar has faded, enlarge the editor/window or use a low-reference symbol if available and confirm no stale fake vertical scrollbar is shown when the pane does not overflow. Treat this as blocking if neither path can exercise the edge.
- Electron regression smoke: scroll the main editor outside Peek References and confirm its normal overlay scrollbar still fades as before.
- Electron visual: validate dark theme from the recording path and light theme if available without changing app state.
- No unit test is required unless a stable Monaco DOM fixture already exists; this behavior depends on third-party runtime classes and needs Electron validation.

## UI Quality Bar

The fix is UI-visible but chrome-only. Peek References should still look like Monaco/VS Code: same colors, borders, row density, selected result, split-pane geometry, and internal alignment. The only intended difference is that needed vertical scrollbars inside the peek panel remain present and usable after idle. No overlap, clipping, layout shift, new color, new radius, or app scrollbar styling should appear.

## Review Screenshots

1. Peek References immediately after open, showing preview editor, references tree, and surrounding Orca editor context.
2. Same Peek References panel after moving the pointer outside the peek/widget scrollable area and waiting at least 1.5 seconds, showing the faded-state vertical scrollbar still visible.
3. Same panel after internal scroll/drag, then moving the pointer away and waiting again, showing the scrollbar remains visible and rows/preview alignment remain correct.
4. Resize or content-fit case after idle, showing no stale scrollbar when a pane does not overflow.
5. Main editor outside Peek References after a normal scroll, showing adjacent editor scrollbar behavior is not visually restyled.

## Rollout

1. Add the scoped CSS override and short "why" comment in `main.css` near the existing Monaco overrides.
2. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build:electron-vite`.
3. Validate in Electron with the screenshots above before PR review.
4. If the resize/content-fit check shows a stale visible scrollbar, do not ship the CSS-only fix as-is. Revisit with a more precise integration that can check actual overflow instead of widening CSS.

## Lightweight Eng Review

- Scope: kept to one scoped CSS compatibility override. This is the smallest viable surface because Peek References internals are Monaco-owned; no Monaco patch, monkey patch, parent editor option, React state, IPC, or reusable scrollbar class is warranted.
- Architecture/data flow: renderer CSS only; it targets Monaco's `.reference-zone-widget` DOM and direct `.monaco-scrollable-element > .scrollbar.vertical.invisible.fade` children. Editor components, language services, IPC, persistence, providers, SSH paths, and cross-window state are untouched.
- Failure modes covered:
  - Faded needed peek scrollbar becomes invisible and non-interactive.
  - Never-revealed or initially non-overflowing scrollables should stay hidden because they are plain `invisible`, not `invisible fade`.
  - Resize/content-fit after a scrollbar has faded can expose a stale fake scrollbar because CSS cannot read Monaco's current `_isNeeded` flag.
  - Horizontal scrollbars, main editor scrollbars, diff scrollbars, and app scrollbars should not be restyled.
  - Dark/light colors remain Monaco-owned.
  - Multi-window/concurrent peek behavior has no shared invalidation problem.
- Test coverage required:
  - Static selector inspection in `src/renderer/src/assets/main.css`.
  - `pnpm lint` for repo lint gates, with the caveat that styled-scrollbar policy does not validate raw CSS.
  - `pnpm typecheck` as a broad no-regression gate.
  - `pnpm build:electron-vite` for CSS parse/bundle coverage.
  - Electron golden path: cold Peek References open, post-idle scrollbar visible/draggable with pointer parked outside the peek/widget scrollable area, DOM confirmation that the tested scrollbar is `invisible ... fade`, and internal scroll/drag.
  - Electron failure-mode check: resize/content-fit or low-reference symbol after fade must not show a stale fake scrollbar.
  - Electron adjacent-feature smoke: normal editor scrolling outside Peek References still fades.
- Performance/blast radius: low. Evidence: code inspection shows one static CSS selector scoped to mounted `.reference-zone-widget` DOM; it adds no JavaScript, listeners, polling, fanout, IPC, subprocess/API calls, telemetry, storage, file watching, layout measurement, or memory growth. It is not literally "free"; it participates in normal renderer style recalculation when Monaco creates/toggles peek scrollbar classes, but the DOM scope is tiny.
- UI quality bar: must remain Monaco-adjacent and neutral per `docs/STYLEGUIDE.md:224-230`; this is not a new app scrollbar style.
- Required review screenshots:
  1. Peek References immediately after open.
  2. Peek References after at least 1.5 seconds idle with the pointer outside the peek/widget scrollable area and the faded-state vertical scrollbar still visible.
  3. Peek References after internal scroll/drag, then pointer-away idle.
  4. Resize/content-fit or no-overflow peek state after idle, showing no stale fake scrollbar.
  5. Adjacent normal editor scrolling outside Peek References.
- Residual risks: the CSS-only approach is invalid if the resize/content-fit check fails because Monaco leaves stale faded DOM state; do not ship by accepting a stale scrollbar. The selector also depends on Monaco 0.55.1 DOM/class names, so Monaco upgrades require revalidation.
