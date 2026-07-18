# Pass 2 — Needs-info bugs (cannot attempt reproduction yet)

Orchestration **2026-07-18** · macOS. These read like real bugs but lack the information needed to attempt a reproduction (no version/steps/logs, or a maintainer already could not reproduce and is waiting on the reporter). Left **unlabeled**. The 'Info needed' column is the concrete blocker to escalate.

| Issue | Title | Info needed to reproduce |
|------:|-------|--------------------------|
| 9196 | [Bug]: Opencode cannot be used | Blank screen when opening Opencode with no steps, logs, or console errors. Real-sounding but missing critical repro detail; would need Opencode installed and DevTools to  |
| 9152 | [Bug][Unable to reproduce]: opencode cant open in or | User reports opencode TUI takes ~20 min to appear only inside Orca on Ubuntu 20.04 with old v1.4.43; labeled Unable to reproduce and lacking logs/current version. Needs u |
| 8539 | [Bug]: Renderer freezes 87s on reconnect with many o | Maintainer replayed the exact 37wt/71tab topology and got 23-33ms reconnect with no long tasks, so cause is unconfirmed and reporter admitted a bad orca-serve launch conf |
| 8368 | Orca Remote: Terminal freezing and workspace conflic | Conflates two vague symptoms (terminal freezing + relay deployed despite existing SSH sessions) with no version, no logs, and broken placeholder screenshots. Cannot infer |
| 8244 | [Bug] Date modal showing up | Native Chrome date picker modal transiently appears over the agent sidebar during headless browser form testing; reporter said behavior is transient and would try to recr |
| 8225 | [Bug] Orca account switcher kills MCP auth? | Speculative report that switching Orca accounts drops Vercel/Linear/RevenueCat MCP auth; no steps, logs, or version. Plausible given profile/session-partition work but ne |
| 8120 | [Bug] PRs stopped auto-linking to their worktree in  | Vague Discord report that PR-to-worktree auto-linking regressed; no version, steps, PR URL, or logs. Cannot infer repro without knowing the linking heuristic input. |
| 8110 | [Bug] Codex hooks failing when launched via Orca (fr | Reporter claims Orca's `if [ -x ... ]; then /bin/sh ...; fi` hook command 127s because Codex argv-splits instead of using a shell, but contributor bbingz refuted this (of |
| 8002 | [Bug]: terminals auto change name | Complaint that pane/terminal titles auto-rename during multi-agent orchestration and orchestration gets confused; maintainer notes title logic improved in later versions  |
| 7951 | [Bug] Terminal UI breakage on switching | Suspected missing winsize push on pane/tab switch leaving degenerate PTY dimensions; window resize fixes it. Maintainer (nwparker) retested on main and could not reproduc |
| 7868 | [Bug]: Regression - files not updating, have to clos | Vague recurring-regression report: editor buffers don't refresh after agents change files on disk, needs close/reopen. No version or concrete steps, so can't reliably rep |
| 7810 | [Bug]: "Invalid host ID" | CLI project setup-create/setup-existing-folder returns Invalid host ID for a paired remote server that shows Connected/Compatible. Needs a paired remote (Tailscale) to re |
| 7705 | [Bug]: con't paset by key board | Body is only a title typo ('con't paset by key board') and an image, with no version, steps, or context. Cannot infer paste flow without more info. |
| 7443 | Terminals unrecoverable (no resume / blocked connect | One-off cluster of symptoms (hang, lost cursor, garbled render, false sandbox, unrecoverable terminals) with no reliable repro steps or logs. Reporter explicitly states f |
| 7048 | [Bug] Linked review branch is unavailable | User consistently hits 'Linked review branch is unavailable' after commit+push, but only a screenshot is provided. Missing provider/branch state and logs to pin the faili |
| 7026 | [Bug] My folder disappeared | Folder (Syncthing/VPS 'remote') vanished from listing after 1.0.114 update but still accessible under agents. No repro steps or logs; unclear folder-workspace-load edge c |
| 6878 | [Bug]: Unable to login in Claude via the terminal | Claude login fails only inside Orca terminal (works in normal terminal), likely env/proxy/PATH difference, but only a screenshot and no logs/error text provided. Needs th |
| 6795 | [Bug] Orca suddenly VERY slow! | Vague 'UI super slow, typing lags 2-5s' report with no resource data, version, or terminal count; maintainer asked diagnostic questions with no reply. Missing critical re |
| 6787 | [Bug] Workspace Board View - Terminal background v.1 | Discord-sourced, only an image and 'Linux Ubuntu 22.04'; no textual description of expected-vs-actual for the terminal background. Cannot infer repro without more detail. |
| 6691 | [Bug]: Claude launch suspense | Vague report of Orca freezing at 100% CPU on claude launch, ancient/odd version v0.14.95, no logs or reliable steps. Too little to reproduce. |
| 6634 | [Bug]: Can`t input | Just a screenshot and 'can't input any' with no steps, logs, or context. Not enough to infer a concrete defect or repro. |
| 6613 | [Bug]: After posting an issue, Start loads Claude bu | Claude launched without --prefill so issue not referenced; maintainer couldn't repro on latest and asked for version/shell/command. Reporter on Windows, works remote not  |
| 6533 | [Bug] Orchestrator | User can't invoke /orchestration despite 6 agents connected; likely config/setup confusion with no version, OS, or logs. Missing critical repro info to distinguish user e |
| 6400 | [Bug]: | Empty body with only an image and no title/steps/version; nothing actionable to reproduce. Needs description of expected-vs-actual behavior. |
| 6268 | [Bug]: Orca embedded-browser cookie/session limitati | Auth0 Universal Login fails in embedded webview (session cookie not sent on cross-doc POST); reporter says it works now and suspects stale imported cookies, offering to f |
| 6186 | [Bug]: Zero-Width Joiner (U+200D) injected into file | Claimed ZWJ injection between 'o' and 'p' in .opencode paths; maintainer ran 10k iterations on current main with zero mutation and requested source app/IME/hex. Not repro |
| 5812 | [Bug]: JIRA login doesn't work. In version 1.4.77 wa | Reported Jira login regression after 1.4.77 on Arch/kwallet; maintainer could not repro and requested WM/auth-method/HTTP-status details. Needs Linux+kwallet env and disp |
| 5157 | [Bug]: Cmd+D split-right animation plays but split i | Reporter's own account is contradictory (direction-specific vs all keyboard splits) and maintainer could not reproduce on 1.4.132; likely fixed or environment-specific, n |
| 5096 | [Bug]: Terminal Cursor and Orca slows doen heavily | Vague long-session UI-lag report; maintainer nwparker could not reproduce in a bounded stress run and requested versions/transcript size/perf dump. |
| 4388 | [Bug]: macOS Option+Tab terminal tab shortcuts fail  | Reporter: Option-held MRU overlay never commits on Option release (commit gated to Control release). Maintainer could not reproduce on 1.4.132 and asked for keyboard-layo |
