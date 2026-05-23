# Source Control AI Customization

## Current behavior (code-checked)

- `settings.commitMessageAi` is the single settings object for source-control text generation.
- Commit message generation and pull request detail generation both resolve through the same agent, model, thinking effort, custom command, and `customPrompt`.
- PR detail generation uses the commit-message settings resolver, then builds a PR-specific base prompt with the same custom prompt suffix.
- Model discovery already has host-scoped storage for SSH targets via `selectedModelByAgentByHost` and `discoveredModelsByAgentByHost`.
- Repos already support persisted repo-specific settings through `Repo` and `updateRepo(...)` for fields such as base branch, issue source, hooks, and symlink paths.
- Hosted review creation is provider-neutral at the type boundary, but the current create implementation only supports GitHub pull requests.

## Goal

Replace the commit-message-only settings surface with a source-control AI settings surface that supports:

- separate custom instructions for commit messages and PR details.
- optional separate model choices for commit-message generation and PR-detail generation.
- per-repo overrides for model, prompt, and PR creation defaults.
- PR creation options that remain provider-neutral in shared types and UI wording.

The default experience should stay simple: one enabled toggle, one agent, and one default model that both commit messages and PR generation inherit.

## Non-goals

- No provider-specific review creation UI beyond the options that the current provider can actually honor.
- No automatic per-repo prompt import from repository files in the first pass.
- No prompt template language, variables, or shell-style interpolation.
- No separate custom agent command per operation in the first pass.
- No live sharing of repo-level prompt edits across multiple open windows beyond existing settings/store propagation behavior.

## UX Overview

Rename the current `AI Commit Messages` section under `Settings > Git` to `Source Control AI`.

### Global Settings

Global section structure:

1. `Enable Source Control AI`
   - Replaces `Enable AI commit messages`.
   - Enables the commit-message Generate button and PR-detail Generate button.

2. `Agent`
   - Shared across commit-message and PR generation.
   - Keeps the current preset agent picker and `Custom` command option.
   - Copy should describe local vs SSH execution because the selected CLI must exist where the worktree is hosted.

3. `Default model`
   - The model used by all source-control AI operations unless an operation override exists.
   - Uses the current model picker, refresh behavior, host-scoped discovery, and thinking effort controls.

4. `Advanced model overrides`
   - Collapsible or visually secondary.
   - `Commit message model`: `Inherit default` or explicit model.
   - `PR details model`: `Inherit default` or explicit model.
   - Each override has its own thinking effort when the resolved model supports it.

5. `Commit message instructions`
   - Text box for commit-message-only custom instructions.
   - Replaces the current single `Custom prompt` for commit messages.
   - Appended only to the commit-message base prompt.

6. `Pull request instructions`
   - Text box for PR-title/body/draft generation only.
   - Appended only to the PR-detail base prompt.
   - Must never affect commit message generation.

7. `PR creation defaults`
   - `Draft by default`.
   - `Use PR template when available`.
   - `Generate details when opening Create PR`.
   - `Open PR after creation`.
   - Future provider-supported fields can extend this group: reviewers, assignees, labels, milestone/project fields, allow maintainer edits.

### Instruction Discovery Guidance

The commit-message Generate control and Create PR Generate control should include a lightweight tooltip/popover on the AI icon that points users to the new instruction settings.

- Show it only when there are no configured instructions for that operation: no repo override is present and the global operation instructions are empty after trim.
- Do not show it when a repo override exists, including an explicit empty override, because that represents a user choice.
- The content should name the destination: `Settings > Git > Source Control AI` for global instructions and `Repo Settings > Source Control AI` for repo-specific instructions.
- Include an action that opens the relevant settings section. From a repo-backed Source Control surface, prefer the repo `Source Control AI` section; otherwise open the global `Source Control AI` section.
- Keep the normal Generate action unchanged. The guidance is informational and must not block generation.

### Repo Settings

Add a `Source Control AI` section to Repo Settings.

There is no repo-level master `Use global settings` toggle. Every field inherits independently unless the user sets a repo value.

Repo model overrides:

- `Commit message model`
  - Default value: `Inherit global`.
  - Selecting a concrete model overrides global commit-message model resolution for this repo.
  - Selecting `Inherit global` clears the repo override.

- `PR details model`
  - Same behavior, separate from commit messages.

Repo prompt overrides:

- `Commit message instructions`
  - Uses an `Inherit` / `Override` mode control plus a text box.
  - `Inherit` clears the repo override and uses the global commit-message instructions.
  - `Override` replaces the global commit-message instructions for this repo.
  - An empty override is valid and means "use no extra instructions for this repo."

- `Pull request instructions`
  - Same behavior, separate from commit messages.
  - An empty override is valid and means "use no extra PR instructions for this repo."

Repo PR defaults:

- Use tri-state controls for boolean defaults: `Inherit`, `On`, `Off`.
- A normal checkbox is insufficient because it cannot distinguish inherited `false` from explicit `false`.

For inherited prompt fields, show the global value as muted helper text or placeholder. Do not save inherited values into the repo record. Switching back to `Inherit` deletes the repo override; clearing text while `Override` is selected persists an explicit empty override.

## Data Model

Add source-control AI types in `src/shared/` rather than expanding the commit-message-specific type in place.

Proposed shape:

```ts
export type SourceControlAiOperation = 'commitMessage' | 'pullRequest'

export type SourceControlAiModelChoice = {
  selectedModelByAgent?: Partial<Record<TuiAgent, string>>
  selectedModelByAgentByHost?: Partial<Record<string, Partial<Record<TuiAgent, string>>>>
  selectedThinkingByModel?: Record<string, string>
}

export type SourceControlAiPrCreationDefaults = {
  draft?: boolean
  useTemplate?: boolean
  generateDetailsOnOpen?: boolean
  openAfterCreate?: boolean
}

export type SourceControlAiSettings = {
  enabled: boolean
  agentId: TuiAgent | 'custom' | null
  selectedModelByAgent: Partial<Record<TuiAgent, string>>
  selectedModelByAgentByHost?: Partial<Record<string, Partial<Record<TuiAgent, string>>>>
  discoveredModelsByAgent?: Partial<Record<TuiAgent, CommitMessageAiModelCapability[]>>
  discoveredModelsByAgentByHost?: Partial<
    Record<string, Partial<Record<TuiAgent, CommitMessageAiModelCapability[]>>>
  >
  selectedThinkingByModel: Record<string, string>
  customAgentCommand: string
  instructionsByOperation: Partial<Record<SourceControlAiOperation, string>>
  modelOverridesByOperation?: Partial<Record<SourceControlAiOperation, SourceControlAiModelChoice>>
  prCreationDefaults?: SourceControlAiPrCreationDefaults
}

export type RepoSourceControlAiOverrides = {
  modelOverridesByOperation?: Partial<Record<SourceControlAiOperation, SourceControlAiModelChoice>>
  instructionsByOperation?: Partial<Record<SourceControlAiOperation, string>>
  prCreationDefaults?: {
    draft?: boolean | null
    useTemplate?: boolean | null
    generateDetailsOnOpen?: boolean | null
    openAfterCreate?: boolean | null
  }
}
```

Notes:

- The exact type names can be refined during implementation, but avoid new generic files named `helpers` or `utils`.
- `Repo` must gain `sourceControlAi?: RepoSourceControlAiOverrides`; defining the override type alone is not sufficient persistence.
- Operation model overrides never change the agent or custom command in this pass. The global `agentId` and `customAgentCommand` remain the single source of truth for all source-control AI operations.
- Reuse existing model capability and discovery metadata where possible to keep the migration small.
- Keep `commitMessageAi` reads for backward compatibility until persisted profiles are migrated or normalized on load.
- Global prompt instructions are trimmed before use; empty global instructions mean no extra instructions.
- Repo prompt override semantics are based on field presence. Missing, `null`, or `undefined` means inherit global; a stored string, including `''` or whitespace, is an explicit repo override after trimming.
- Repo boolean override semantics use `null` or `undefined` for inherit, `true`/`false` for explicit override.

## Resolution Rules

Add a single canonical resolver, for example `resolveSourceControlAiForOperation(...)`, and use it from every generation and PR-default entry point. The resolver input must include:

- settings, including `sourceControlAi` and legacy `commitMessageAi`.
- the repo record, or `null` when no repo applies.
- the operation: `commitMessage` or `pullRequest`.
- the model-discovery host key for local, SSH, or runtime environment execution.
- product defaults for PR creation behavior.

All local IPC, SSH, and runtime RPC paths should resolve after they have both settings and repo context. Renderer code may call the same pure resolver for UI seeding, but the main/runtime side must re-resolve before invoking an agent so stale renderer state cannot choose the wrong model or prompt.

Resolve model settings per operation with this order:

1. Repo operation override.
2. Global operation override.
3. Global source-control default.
4. Legacy `commitMessageAi` fallback for upgraded profiles.
5. Agent default model.

Resolve thinking effort after resolving the agent and model, using the same precedence:

1. Repo operation override for the resolved model.
2. Global operation override for the resolved model.
3. Global source-control default for the resolved model.
4. Legacy `commitMessageAi` selected thinking for the resolved model.
5. The resolved model's default thinking level.

If the resolved model does not expose thinking levels, omit thinking effort entirely. If a persisted thinking value is no longer supported by the resolved model, ignore it and fall back to the model default.

Resolve the agent once from the global source-control AI settings, then legacy `commitMessageAi`, then the default agent. Repo and operation overrides do not change the agent in the first pass.

For prompt instructions:

1. If the repo operation instruction field is present, use its trimmed value. Empty means no custom instructions.
2. Else use the global operation instructions.
3. Else pass no custom instructions.

Repo operation instructions replace global instructions. They are not additive.

For PR creation defaults:

1. Repo explicit value (`true` or `false`).
2. Global value.
3. Product default.

## Prompt Contract

Keep separate base prompts:

- Commit-message base prompt returns raw commit message text.
- PR-details base prompt returns compact JSON with `base`, `title`, `body`, and `draft`.

Custom instructions are appended after the base prompt, but only for the matching operation.

For PR details, place user instructions before a final non-negotiable output guard that repeats the compact JSON-only contract. This is required from the first implementation, not only after a parsing regression, because user instructions can naturally ask for prose or templates that would otherwise break parsing.

## Creation Options Contract

Extend `CreateHostedReviewInput` with provider-neutral options where they are creation-time behavior:

```ts
export type CreateHostedReviewInput = {
  provider: HostedReviewProvider
  base: string
  head?: string
  title: string
  body?: string
  draft?: boolean
  worktreePath?: string
  useTemplate?: boolean
}
```

Provider-specific creation flags should be introduced behind explicit provider support checks. For example, a future `allowMaintainerEdits` field should be surfaced only when the target provider supports it.

`openAfterCreate` is renderer behavior, not a hosted-review API behavior. Keep it in the resolved UI defaults and consume it after a successful create result; do not add it to `CreateHostedReviewInput` or provider adapters.

`useTemplate` is provider behavior, but it must be handled explicitly. For GitHub, verify whether the chosen CLI/API path supports combining a template with an explicit body. If it does not, seed the dialog body from the template before submit or let the explicit body win; do not silently pass mutually exclusive provider flags.

## UI Behavior Details

- The Source Control primary action remains unchanged unless generation is explicitly invoked or `generateDetailsOnOpen` is enabled.
- The Create PR dialog should seed `draft` from resolved PR defaults, then let the user edit it before submit.
- If `generateDetailsOnOpen` is enabled, generation should run only once per dialog-open instance for the current branch.
- Track explicit per-field dirty flags from the moment the dialog seeds `base`, `title`, `body`, and `draft`. Do not infer user edits only by comparing strings, because template seeding, whitespace normalization, and async eligibility refreshes can produce false matches.
- User edits always win over late AI generation results, matching the current stale-request guard. AI results may update only fields that are still pristine for that request.
- Generated PR details should not silently change the selected repo-level defaults.

## SSH and Runtime Considerations

- Model discovery and selection remain host-scoped, because local and SSH hosts may expose different CLI model catalogs.
- Repo overrides must apply equally to local, SSH, and remote runtime RPC paths.
- Prompt and model resolution should happen on the side that already has settings plus repo context before invoking generation.
- Do not assume repo paths are local filesystem paths when routing runtime calls.

## Migration and Compatibility

- Keep accepting `settings.commitMessageAi`.
- Inspect the raw parsed settings before merging defaults. If `sourceControlAi` is missing in the raw file, synthesize it from `commitMessageAi`; do not let `getDefaultSettings()` hide the missing-field check.
- Map legacy `customPrompt` to `instructionsByOperation.commitMessage` only.
- PR instructions default to empty, even for users whose legacy `customPrompt` previously affected PR details. This is an accepted behavior change: commit-message behavior is preserved, and PR customization becomes an explicit new setting.
- Preserve existing model selections, host-scoped discovered models, selected thinking levels, enabled state, agent id, and custom command.
- New builds treat `sourceControlAi` as authoritative once present. During the compatibility window, settings writes should also update a legacy `commitMessageAi` projection for rollback and older code paths; new resolvers must prefer `sourceControlAi` when both fields exist.
- Mixed-version concurrent editing is not supported. If an older build edits only `commitMessageAi` after a newer build has created `sourceControlAi`, the newer build keeps using `sourceControlAi`.
- Existing users should see their current commit-message generation behavior unchanged after upgrade. Existing PR-detail generation may stop receiving the legacy prompt until the user adds Pull request instructions.

## Tests Required

- Shared resolver tests:
  - global default model is used by both operations.
  - operation model override wins over global default.
  - repo operation model override wins over global operation override.
  - thinking effort follows the same repo/global/legacy/model-default precedence as the resolved model.
  - unsupported persisted thinking effort falls back to the resolved model default.
  - missing repo prompt inherits global prompt.
  - explicit empty repo prompt suppresses global prompt.
  - non-empty repo prompt replaces global prompt.
  - repo tri-state PR defaults resolve through inherit/on/off.

- Migration tests:
  - raw persisted settings without `sourceControlAi` synthesize the new field before default merging can mask absence.
  - legacy `commitMessageAi.customPrompt` becomes commit-message instructions only.
  - legacy PR instructions default to empty.
  - legacy model selections and host-scoped discovery caches are preserved.
  - missing new settings field gets a stable default.
  - settings writes maintain the legacy `commitMessageAi` projection during the compatibility window.

- Main/runtime generation tests:
  - commit generation receives commit instructions only.
  - PR generation receives PR instructions only.
  - an explicit empty repo instruction override suppresses a non-empty global instruction.
  - SSH discovery host key still chooses host-scoped models.
  - remote runtime RPC carries enough settings/repo context to resolve overrides.

- Renderer tests:
  - `Source Control AI` section renders separate commit and PR instruction boxes.
  - repo settings render inherited placeholders without persisting inherited text.
  - repo settings can persist an explicit empty instruction override and can switch back to inheritance.
  - selecting `Inherit global` clears repo model override.
  - commit and PR Generate icons show instruction-setting guidance only when that operation has no repo override and no global instructions.
  - guidance action opens repo Source Control AI settings when repo context exists, otherwise global Source Control AI settings.
  - PR creation dialog seeds defaults from resolved settings.
  - auto-generate-on-open runs once per dialog-open instance and does not overwrite dirty fields.

- Hosted review creation tests:
  - new PR options are forwarded only where supported.
  - `openAfterCreate` is consumed in renderer and is not passed to hosted-review provider APIs.
  - unsupported provider options are ignored or disabled with clear UI gating.
  - open-after-create opens the created review URL after successful creation.
