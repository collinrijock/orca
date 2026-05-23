# Design Review Context

## Document Info
- Path: .stably/docs/source-control-ai-customization.md
- Type: Technical Spec
- Review started: 2026-05-22T20:52:14-07:00

## Design Direction
- Direction confirmed: confirmed
- Chosen approach: replace the commit-message-only AI settings surface with a source-control AI settings surface, keeping one default agent/model and adding operation-specific and repo-specific overrides.
- Alternatives considered: pending review notes
- Key UX decisions: global defaults stay simple; repo settings inherit per field; PR creation defaults use tri-state repo overrides.

## Iteration State
Current iteration: 4
Last completed phase: Fix

## Addressed Issues (Do Not Re-report)
Iteration 1 | P1 | Internal consistency | Legacy `customPrompt` migration only preserved commit-message behavior | Initially fixed by mapping legacy prompt to both operations; later changed by user decision to preserve commit behavior only and add contextual PR instruction guidance.
Iteration 1 | P1 | Architecture | Source-control AI resolution lacked a canonical owner across local, SSH, and runtime paths | Added a resolver ownership contract requiring every path to call a single resolver with settings, repo, operation, and host key.
Iteration 1 | P1 | Operational | Compatibility plan did not define write/read precedence for `commitMessageAi` and `sourceControlAi` | Added canonical source-control settings precedence plus a legacy projection during the compatibility window.
Iteration 1 | P1 | Data model | Repo override type was not explicitly persisted on `Repo` | Added a requirement for `Repo.sourceControlAi?: RepoSourceControlAiOverrides`.
Iteration 1 | P1 | UX | Repo prompt overrides could not express an explicit empty override | Changed repo prompt semantics to field-presence inheritance with an Inherit/Override control.
Iteration 1 | P2 | Internal consistency | Operation model override shape allowed per-operation agent drift | Removed `agentId` from operation model overrides and documented one global agent/custom command.
Iteration 1 | P2 | UX | Auto-generate-on-open relied on underspecified seed comparison | Added per-dialog, per-field dirty-state requirements.
Iteration 1 | P2 | Architecture | Renderer-only `openAfterCreate` leaked into provider input | Removed it from `CreateHostedReviewInput` and kept it as renderer-side UI default behavior.
Iteration 2 | P1 | Internal consistency | Thinking effort had override storage but no resolver precedence | Added thinking-effort precedence and fallback rules tied to the resolved model.

## Skipped Issues (Accepted Risks)
Iteration 1 | P2 | Architecture | `useTemplate` provider semantics still require implementation-time verification | The doc now requires explicit provider support verification and tests; no additional design loop needed before implementation.
Iteration 4 | P1 | Migration compatibility | Legacy `customPrompt` no longer affects PR details after upgrade | Accepted by user; mitigated with Create PR Generate icon guidance linking to Source Control AI instruction settings when no PR instructions exist.

## Invalidated Findings (Do Not Re-report)
[Initially empty]

## Findings History
Iteration 1 | Review found P1 migration, resolver ownership, compatibility, repo persistence, and empty-override gaps; fixed in doc.
Iteration 2 | Review found P1 missing thinking-effort precedence; fixed in doc.
Iteration 3 | Final narrow review found no P0/P1 issues.
Iteration 4 | User accepted legacy PR prompt behavior change; design now maps legacy prompt to commit instructions only and adds conditional instruction-setting guidance on Generate icons.
