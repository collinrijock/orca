# Pass 2 — Live-app bugs not yet attempted (need the running Orca app)

Orchestration **2026-07-18** · macOS. These are triaged as REAL bugs whose reproduction needs the running Electron app / visual UI (or a remote host) and were **not** reducible to a headless unit test this pass. Left **unlabeled**. Pick up by driving the live app (or `/run` / orca-cli) and capturing a screenshot/recording, then add a `has_repro`/`cannot_repro` label + writeup.

| Issue | OS | Title | Subsystem / repro idea |
|------:|----|-------|------------------------|
| 9304 | os:macos | [Bug]: Sidebar worktree "Live Ports" (Plug) icon | src/renderer sidebar worktree card LivePorts hover card (Rad — Hovering the Plug icon opens/closes the Live Ports hover card in a loop, likely  |
| 9195 | os:Windows | [Bug]: Even after Orca is exit on Windows, the o | terminal daemon shutdown/parent-exit cleanup (Windows) — After quitting Orca on Windows, orca-terminal-daemon processes remain running. D |
| 9194 | os:macos | [Bug]: Phantom "如果这种情况持续存在，请 提交议题." pane cannot  | Remote Orca Server (beta) terminal lifecycle/reattach — Using Remote Orca Server across two configured URLs (LAN + FRP), a closed remote |
| 9002 | os:Windows | [Bug]: | src/renderer view/route switching, app shell re-render — Clear regression bisected to v1.4.137→v1.4.138 causing ~100-300ms main-thread fr |
| 8381 | os:macos | [Bug]: TCC "access other apps' data" prompt re-a | src/main pty login(1) wrapper / macOS TCC — kTCCServiceSystemPolicyAppData grant for ssh->SecretAgent is written session-pid |
| 8261 | - | [Bug]: App silently quits without any warning wh | src/main updater / quitAndInstall path — Auto-updater does quitAndInstall with no user confirmation, killing all PTY/agen |
| 8139 | os:macos | [Bug]: Keyboard is taken over when using Orca br | browser skill / agent-browser automation focus handling — Agent-driven browser typing steals the OS keyboard focus so the user can't multi |
| 7936 | - | [Bug] macOS logout leaves orphaned PTYs → broken | src/main PTY daemon lifecycle / warm-reattach — Daemon survives a full macOS logout, so on re-login Orca reattaches to orphaned  |
| 7240 | os:Windows | [Bug]: Terminal pane renders garbled/overlapping | src/renderer/src/lib/pane-manager/pane-reveal-repaint.ts (sc — On tab-switch reveal, buffer-diff reports cells unchanged so canvas keeps stale  |
| 6491 | os:macos | [Bug]: Terminal background flickers on every red | src/renderer terminal-pane xterm background/transparency com — With opacity<1 the semi-transparent terminal background re-composites/re-blends  |
| 6357 | - | [Bug] Worktree in a monorepo, can not see files  | folder/project-group workspace diff + git tab selector resol — Folder-workspace (non-git container with child repos) fails diff/file viewer wit |
