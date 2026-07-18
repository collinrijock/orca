# Pass 2 — OS-blocked bugs (deferred, need a non-macOS host)

Orchestration **2026-07-18** · macOS host. These are genuine-looking bugs that can only be reproduced at runtime on Windows, Linux, or a mobile device. Not labeled `cannot_repro` (we did not fail to reproduce — we are blocked from attempting). Pick up on the matching OS.

> Security: never execute user-attached binaries/scripts from these issues. Recreate fixtures on the target OS.

## Windows / Linux

| Issue | OS | Title | What to do on that host |
|------:|----|-------|-------------------------|
| 9197 | windows | [Bug]: 无法删除 WSL 环境中的工作树 | worktrees:remove fails with selector_not_found on WSL \\wsl.localhost UNC paths. Genuine bug but tied to Windows/WSL path resolution at runtime; the s |
| 8972 | linux | [Bug]: white border on tiling window manager | Under a Linux tiling WM, maximize hides the border but a white border remains otherwise; a rendering/frame issue that needs a Linux tiling-WM environm |
| 7438 | windows | [Bug]: Remote host filesystem picker cannot navigate to othe | Picker roots '/' to C: and typed absolute path M:\ only filters instead of navigating on Windows remote host. Requires a Windows host to reproduce dri |
| 6635 | linux | [Bug]: Headless 'orca serve' SIGABRT — uncaught Napi::Error  | Non-deterministic native watcher-teardown crash in headless serve killing all agent terminals; cross-platform but reported on Linux/WSL2 and not deter |
| 6600 | mobile | [Bug]: Couldn't save the host when pairing on Orca Mobile | Android mobile app fails to encrypt/save host token in ExpoSecureStore keychain, losing pairings daily. Requires Android device runtime; maintainer ac |
| 6162 | windows | [Bug] NPX skills update | npx skills update fails on Windows+Node24 due to shell:true+arg-array spawn in upstream skills CLI; requires Windows runtime to reproduce. Maintainer  |

## Mobile (iOS / Android / iPad / DeX)

| Issue | Title | Notes |
|------:|-------|-------|
| 9302 | [user-report][unverified] iOS: app runs hot and drains  | Unverified me-too iOS battery/heat report explicitly collecting upvotes with no confirmed repro. Requires physical iOS device profiling (Instruments)  |
| 9000 | [Bug] iPad app: Native hardware keyboard arrow keys and | iPad app intercepts hardware keyboard events so arrow keys and Cmd shortcuts don't work as native iPadOS input; also reported on Android. Requires iPa |
| 8933 | [Bug] Android Terminal Overlap | Android app: bottom terminal lines are occluded by the keyboard accessory bar; needs the Android device to observe the inset layout bug. |
| 8700 | [Bug] Bug: interacting with Browser tab on mobile hides | Mobile: tapping an element in the browser preview tab swaps view to another terminal/agent tab, likely agent-turn focus-pull; needs the mobile app to  |
| 8592 | [Bug]: Orca Mobile is unusable in Samsung DeX (severe l | Needs a Samsung Android device in DeX desktop mode to observe layout/repaint failures; not reproducible on a macOS dev host. |
| 8313 | [Bug] No caret visible on Claude Code on iPhone | Flashing text caret not rendered in the mobile iOS terminal (iPhone/iPad); works fine on macOS. Requires the mobile app/webview to observe, so not mac |
| 7350 | [Bug] Codex runs under the prompt in mobile | Mobile agent terminal over-fits PTY rows before the input dock lays out, so Claude/Codex bottom-pinned input renders behind the bar. Layout-timing rac |
| 7094 | [Bug]: Android mobile terminal drops characters when ty | Android mobile app drops typed characters under moderate speed/latency. Requires the Android device/app runtime to reproduce. |
| 6928 | [Bug]: Connectivity Issues when mobile app is paired to | Mobile app fails to reach a headless server when also paired to a desktop (over tailscale); needs mobile device + multi-host pairing to reproduce. Mai |
| 6600 | [Bug]: Couldn't save the host when pairing on Orca Mobi | Android mobile app fails to encrypt/save host token in ExpoSecureStore keychain, losing pairings daily. Requires Android device runtime; maintainer ac |

### Pure mobile-beta issues (not triaged individually — device required)

| Issue | Title |
|------:|-------|
| 8818 | [Bug]: Android built-in terminal does not receive external mouse event |
| 8666 | [Bug]: app freezes when I try to delete or rename the host |
| 8411 | [Bug]: mobile source control view is “jumping” after open |
| 7495 | [Bug]: Chinese IME input does not work in the mobile app |
| 7427 | [Bug]: Orca Mobile terminal cannot enter Japanese via flick or romaji  |
| 7345 | [Bug]: Terminal closed from mobile app reappears as a brand-new termin |
| 6995 | [Bug]: Orca mobile Android, Korean Hangul input is decomposed into sep |
| 6927 | [Bug]: Mobile cannot close tabs |
| 6863 | [Bug]: Unable to scroll Claude Code on Android |
| 6713 | [Bug]: When the connection is cut in iOS, it is not possible to type i |
| 5421 | [Bug]: iOS Workspace Tabs Won’t Open |
| 4606 | [Bug]: iOS non direct terminal entry text should enable auto correct i |
