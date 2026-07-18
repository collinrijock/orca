# Pass 2 — Not-a-bug / already-fixed / duplicate

Orchestration **2026-07-18** · macOS. Reviewed and determined NOT to be reproducible defects on the current tree. Left **unlabeled** (no `cannot_repro`, since these are working-as-intended, feature requests, or already fixed). Listed for the maintainers to close or re-triage.

## Not a bug (feature request / question / works-as-intended)

| Issue | Title | Determination |
|------:|-------|---------------|
| 9065 | [Bug] How to switch to existing worktree in orca w/o | User question answered in comments: there is a 'hide/unhide non-Orca worktrees' option to surface existing worktrees. Support question, not a defect. |
| 9036 | [Bug] Could not complete the update | Windows update signature-verify step failed due to antivirus scanning the installer; user resolved via manual download. Environment/config issue, not  |
| 8632 | [Bug]: | Config situation: project set to WSL runtime but WSL not available; maintainer gave the settings fix. Working-as-intended message, not a defect. |
| 8405 | [Bug] Access Floating terminal from mobile | Enhancement request to view floating (non-workspace) terminals from the mobile app; maintainer replied it's unsupported and 'will think about how to s |
| 8373 | [Bug] Agent thinks my app is named as workspace name | Feature request: agents assume the app name equals the workspace name; user asks for an automatic disambiguation prompt. Not a concrete defect with ex |
| 8160 | [Not Orca Issue][Bug] In the latest 2 versions, the  | Title itself marks it 'Not Orca Issue'; crash happens during macOS app registration before Orca code runs, only on unreleased macOS 27 beta. Not repro |
| 7830 | [Bug] Can’t Hide Live Keyboard on iOS app once opene | Missing feature on Orca Mobile iOS: no affordance to dismiss the software keyboard. Feature request, not a defect; a contributor commented they are al |
| 7822 | [Bug]: Nested git sub-repos under main repo do not a | Filed as bug but is a feature request: user wants IDE/Trae-style switching among multiple nested sub-repos in the Source Control view. Orca scopes SCM |
| 7441 | [Bug] Persist sessions across system restarts | Feature request: daemon is an unregistered user process killed on OS reboot so no warm reattach exists; resume path gated by recordPaneIsOwnedByPreser |
| 7418 | [Bug]: Explorer preview editor can stay read-only af | Maintainer investigated and attributes stuck-input to an upstream Chromium EditContext bug (Monaco v0.53 default input path), not Orca code — also rep |
| 7370 | [Bug] prefer claude generated title over first promp | Enhancement request to use Claude-generated session titles instead of first-prompt initials in the right sidebar; author already raised PR #7369. Pref |
| 7127 | [Bug]: How to Add a custom CLI agent | A how-to question about custom CLI agents; maintainer replied the doc shipped before the feature and it's coming soon. Not a defect. |
| 6879 | [Bug]: Managed hooks should be injected into setting | Maintainer validated that Claude Code only loads settings.local.json at project scope, so ~/.claude/settings.json is the only supported user-level hoo |
| 6100 | [Bug] Dont notify when Main agent stopped but subage | Feature request to suppress completion notifications while background work runs; maintainer verdict is WONTFIX (no reliable signal) and will only impr |
| 5394 | [Bug] multirepository | User question/config request about a workspace repo containing nested per-service repos not being replicated on worktree create; works-as-intended (ne |
| 5255 | [Feature Request]: move children with the parent int | Explicit feature request (titled Feature Request) to keep child worktrees with a pinned parent; current orphaning is not a defect. |
| 5188 | [Bug]: Docs: note that the CLI binary is orca-ide on | Documentation-improvement request about Linux orca-ide naming (GNOME Orca collision); not a defect. Related to the GNOME collision work in #8347. |
| 4374 | [Bug]: Inconsistent orchestration UI | Mostly a feature request (nested worker indent + hide-worker-tabs preference); nesting was partly implemented then called inconsistent but with no con |
| 1473 | [Bug]: Can't add custom cli agent | Feature request for provider/env-scoped custom CLI agent presets; maintainer says covered by unshipped #2521. No add-custom-agent UI exists yet by des |

## Duplicate or already fixed

| Issue | Title | Determination |
|------:|-------|---------------|
| 8713 | [Bug] Any recent change to Terminal? | User's ~/.zshrc codex() wrapper stopped being used (raw codex invoked, http_proxy lost); maintainer says a 1.4.140 codex-compat regression was fixed i |
| 8324 | [Bug]: Error: Unsupported remote platform on Linux x | Platform-probe misparsed banner-contaminated stdout; contributor confirms fixed by merged #7965 (line-tagged scan) with passing tests. Follow-up comme |
| 8276 | [Bug] Terminal Daemon crash on unrealted split-pane  | Stub Discord report that explicitly points to #8275 for the timeline and diagnostics; a duplicate/pointer of that issue with no independent repro info |
| 8260 | [Bug]: Renderer crashes to white screen on macOS — u | MEMBER confirms fix #8279 merged and released in v1.4.142 (SSH rejection leak guarded, ResizeObserver noise filtered, Windows pty:kill already landed  |
| 8104 | [Bug]: Terminal intermittently stops accepting text  | Terminal stops accepting keystrokes though PTY is connected/writable; byte never reaches PTY. Reporter confirms fix PR #8673 (follow-up to #8630) miss |
| 7947 | [Bug] How to exclude a worktree created manually? | worktrees:remove fails on git-locked worktree ('cannot remove a locked working tree'); maintainer already opened fix PR #7963 to force-delete locked w |
| 7807 | [Bug]: Remote Orca sessions should strech to the ful | Maintainer nwparker confirmed fixed in #8252: mirrored viewer now claims viewport ownership so session sizes to viewer width. Already shipped. |
| 6711 | [Bug]: Browser isn't on latest version | Embedded Chromium trails mainline Chrome so sites flag it as outdated; UA normalization + Electron 43 bump already improved it and 'import cookies' un |
| 6154 | [Bug]: Closing one pane after left/right agent split | Split pane close leaves blank right half; maintainer says 1.4.104 should fix it with no reporter confirmation. Likely fixed but unverified; would need |
| 5960 | [Bug]: Bad screen result when pasting links | Pasting a GitHub PR link garbled fonts/UI; maintainer confirmed resolved in a later RC and could no longer reproduce. Treat as fixed. |
| 5718 | [Bug]: OMP sessions not showing up in Agent Session  | Original 'OMP missing from AI Vault history/filter' was fixed by #7618 (commenters confirm OMP now visible). Remaining asks (nest subagent sessions, O |
