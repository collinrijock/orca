# Orca Skill Naming

## Goal

I want the default Orca skill name to be short enough for daily use, but still clear about what it owns.

The common path is supervised orchestration: coordinating workers, waiting on lifecycle events, managing task DAGs, and handling escalation or `worker_done` flows. That path should be easy to invoke.

At the same time, `orca` should not become a giant catch-all skill for every Orca surface. It should be a router-first skill that handles the common orchestration path and points users to narrower skills when the intent is desktop control, emulator work, or Linear.

## Decision

Use `orca` as the primary Orca skill.

`orca` should cover:

- supervised orchestration
- the Orca CLI rules needed to distinguish supervised orchestration from a full handoff
- routing to narrower Orca skills when the request is outside orchestration

The CLI piece needs a careful review. I only want `orca` to absorb CLI guidance that affects orchestration, handoffs, worktrees, terminals, or runtime state. If `orca-cli` also works as a general CLI reference, that broader reference should probably stay separate.

Keep `orca-computer-use` as the desktop-control skill. It is explicit, Orca-scoped, and avoids confusion with host-agent computer-use tools.

## Final Skill Names


| Current or candidate    | Final name              | Purpose                                                                                                             |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `orchestration`         | `orca`                  | Primary skill for supervised coordination, task DAGs, worker lifecycle, decision gates, and related Orca CLI rules. |
| `orca-cli`              | `orca` or `orca-cli`    | Move routing-critical CLI rules into `orca`. Keep a separate `orca-cli` skill if users still need a general CLI reference. |
| `computer-use`          | `orca-computer-use`     | Orca desktop, browser, app UI, and webview control through `orca computer ...`.                                     |
| `orca-emulator`         | `orca-emulator`         | iOS and mobile emulator workflows.                                                                                  |
| `orca-emulator-android` | `orca-emulator-android` | Android emulator workflows.                                                                                         |
| `orca-linear`           | `orca-linear`           | Linear issue workflows through Orca.                                                                                |
| `linear-tickets`        | `orca-linear`           | Keep only for backward-compatible detection or migration support.                                                   |


## Why `orca`

`orca` is the shortest and easiest name for the workflow people will use most often.

I do not want `orca-orchestration` as the primary name. It is accurate, but too long for a high-frequency skill. I also do not want clever or vague alternatives like `orcastrate`, `orca-run`, or `orca-agents`; they either hide the purpose or sound like something other than coordination.

The tradeoff is that `orca` is broad. The way to make that safe is to make it a router, not a mega-skill.

## Architecture

Use this pattern:


| Pattern                               | Decision                    | Reason                                                                                    |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| One giant `orca` skill                | Reject                      | Too much context, harder maintenance, and unclear ownership.                              |
| `orca` router plus specialized skills | Choose                      | Keeps the common path short while preserving focused skills for lower-frequency surfaces. |
| Only explicit specialized names       | Reject for the primary path | Clean separation, but too clunky for frequent orchestration use.                          |


`orca` should contain enough routing logic to classify the request. It should not duplicate the full instructions from `orca-computer-use`, `orca-emulator`, `orca-emulator-android`, `orca-linear`, or a broader CLI reference if that remains separate.

## Routing Contract

`orca` should classify intent before giving commands.

Use supervised orchestration when the user asks to:

- coordinate, supervise, monitor, or wait for workers
- use `worker_done`, escalation, or heartbeats
- dispatch tasks with `taskId` or `dispatchId`
- manage a DAG, dependency graph, or decision gate
- use threaded messages, `ask`, `reply`, or inbox flows

Use a non-lifecycle Orca CLI handoff when the user asks to:

- hand off or give work to another agent
- create another worktree or fresh agent to own the task
- use a custom agent model or reasoning effort without asking for supervision

In the handoff case, `orca` should use worktree or terminal commands, deliver the prompt, and stop monitoring. It should not create orchestration lifecycle state unless the user explicitly asks for supervision.

Route to another skill when the request belongs elsewhere:


| Intent                                                                             | Route                   |
| ---------------------------------------------------------------------------------- | ----------------------- |
| Desktop UI, browser windows, webviews, or Orca app UI outside the embedded browser | `orca-computer-use`     |
| Mobile emulator, iOS simulator, or emulator streaming                              | `orca-emulator`         |
| Android emulator-specific work                                                     | `orca-emulator-android` |
| Linear issue or ticket work                                                        | `orca-linear`           |


Practical boundary: `orca` owns Orca-managed agent coordination and runtime state. It should not become the universal skill for every Orca product surface.

## What Belongs In `orca`

Include:

- routing rules for other Orca skill surfaces
- the orchestration command reference
- the CLI, worktree, and terminal rules required for handoffs and coordination
- enough context to know when not to create lifecycle state

Do not include:

- detailed `orca computer ...` operating instructions
- emulator setup and streaming procedures
- Linear workflow details
- general CLI reference material that is unrelated to orchestration or handoff routing
- long references for lower-frequency surfaces just because they are Orca-branded

If a user enters through `orca` but the task is actually Computer Use, emulator, or Linear work, the correct behavior is to invoke or consult the narrower skill.

## Invocation Controls

Some runtimes can hide a skill from user slash invocation, disable automatic invocation, or make a skill agent-invoked only. When that exists, use it for internal support or leaf skills that should not clutter the user's visible namespace.

That supports this split:

- user-facing skills stay short and intentional
- leaf skills stay separate and maintainable
- the router can invoke the leaf skill without making users remember every leaf name

Codex Recursor does not currently have the same practical control surface, so naming and descriptions matter more there. For Codex, keep the visible first-class namespace small:

- `orca`
- `orca-computer-use`
- `orca-emulator`
- `orca-emulator-android`
- `orca-linear`

## `orca` Skill Description

Suggested frontmatter:

```yaml
name: orca
description: >-
  Use Orca for Orca-managed agent coordination, worktree and terminal handoffs,
  supervised task dispatch, worker_done/escalation waits, DAGs, decision gates,
  threaded ask/reply flows, and Orca CLI actions where runtime state matters.
  Route desktop UI or visible browser control to orca-computer-use, mobile
  emulator work to orca-emulator or orca-emulator-android, and Linear work to
  orca-linear.
```

The body should open with a small router table, then the orchestration path, then full-handoff and CLI reference sections. That keeps `/orca` fast for the high-frequency path while still correcting wrong-surface invocations.

## Migration And Compatibility

- Bundle `skills/orca/SKILL.md` as the preferred primary skill.
- Bundle `skills/orca-computer-use/SKILL.md` for Computer Use.
- Do not bundle `skills/orca-orchestration`.
- Do not bundle `skills/orca-computer`.
- Do not present `orca-cli` as a first-class skill unless the general CLI reference is useful enough to keep separate.
- Keep compatibility detection for old installs named `orchestration`, `orca-cli`, `computer-use`, and `linear-tickets`.
- Treat `linear-tickets` as a legacy alias for `orca-linear` only.

Feature setup can still show separate product concepts such as Agent Orchestration, Orca CLI, and Computer Use. Installed-skill detection should understand that `orca` satisfies old orchestration guidance. It should satisfy old Orca CLI guidance only if the checked guidance is the handoff/runtime subset now covered by `orca`.

## Implementation Checklist

1. Rename or replace bundled skill directories so the final first-class set is `orca`, `orca-computer-use`, `orca-emulator`, `orca-emulator-android`, and `orca-linear`.
2. Merge orchestration guidance into `orca`, with routing at the top and no detailed duplication of Computer Use, emulator, or Linear instructions.
3. Audit `orca-cli` before retiring it. Move handoff/runtime guidance into `orca`; keep broader CLI reference material separate if users still need it.
4. Update setup, onboarding, and skill-detection copy to prefer `orca`.
5. Preserve legacy detection aliases: `orchestration`, `orca-cli`, `computer-use`, and `linear-tickets`.
6. Add tests proving legacy installs still satisfy the relevant setup checks.
7. Add tests proving `orca-computer-use` is the final Computer Use name and `orca-computer` is not.
