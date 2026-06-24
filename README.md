# Agent Loop Templates

Reusable loop scaffolds for project-local agent workflows.

This repository is the reference source for loop definitions. Each canonical
loop lives under `loops/<loop-id>/`. Target repositories that already use
`setup-project-workflow` install a thin reference marker instead of copying the
full loop by default.

Target repositories should keep each loop isolated under
`docs/agent-loops/<loop-id>/`. That directory owns project-specific loop config
and run history. Commit concise run summaries there, and keep raw logs local.

## Repository Structure

- `loops/full-e2e-merge/`: the first loop definition.
- `loops/implement-then-review/`: a smaller implementation plus Thermos review
  loop.
- `loops/<loop-id>/`: future loop definitions, each with its own config,
  prompts, templates, and run-record policy.
- `src/<loop-id>/`: deterministic controller models for testing loop
  orchestration without real agents or remotes.
- `test/<loop-id>/`: scenario tests for loop gates, retries, and terminal
  authority.
- `scripts/install_agent_loop.mjs`: installs a thin target-project reference to
  a canonical loop in this repo.

## Installing A Loop

Run the installer from the target project root:

```bash
LOOPS_REPO="/path/to/downloaded/jonathanLindquist-loops"
node "$LOOPS_REPO/scripts/install_agent_loop.mjs" \
  --project-root "$PWD" \
  --loop implement-then-review
```

`--project-root` is the repo receiving the loop. The installer discovers the
reference repo from its own script location, so the generated `loop-ref.json`
points back to the downloaded loop repo even when the command runs from a
different project.

The installer creates:

```text
docs/agent-loops/<loop-id>/
|-- loop-ref.json
|-- loop-config.json
`-- runs/
    `-- .gitignore
```

`loop-ref.json` records reference mode without an absolute machine-specific
source path. `loop-config.json` stores project-local loop values. At runtime,
the resolver deep-merges the target repo config over the canonical config from
this repo. Re-run the installer any time; it preserves an existing loop config
unless `--force` is passed.

## Deterministic Verification

Run the current loop harness with:

```bash
npm test
```

The harnesses drive scripted adapters for Obsidian, git, GitHub when a loop
needs it, subagents, checks, and run records. This verifies loop control flow
without needing network access, real repositories, or nondeterministic agent
output. See `docs/testing-loop-verification.md`.

## full-e2e-merge

The first loop turns the top ready Backlog ticket into a merged pull request:

1. Read the project workflow docs, Obsidian Kanban board, and linked plan.
2. Work the top Backlog card only when it is `#ready-for-agent`.
3. Create an isolated ticket branch/worktree.
4. Use implementation and reviewer subagents.
5. Verify ticket checks, repo checks, PR checks, and changed-file secrets.
6. Squash merge when green.
7. Complete the Kanban card and retain a concise run summary.

Install into a target project:

```bash
LOOPS_REPO="/path/to/downloaded/jonathanLindquist-loops"
node "$LOOPS_REPO/scripts/install_agent_loop.mjs" \
  --project-root "$TARGET_REPO" \
  --loop full-e2e-merge
```

Then customize `docs/agent-loops/full-e2e-merge/loop-config.json` only when
that project needs project-specific values.

## implement-then-review

The smaller loop turns the top ready Backlog ticket into an implemented branch
that has passed Thermos review:

1. Read the project workflow docs, Obsidian Kanban board, and linked plan.
2. Work the top Backlog card only when it is `#ready-for-agent`.
3. Create an isolated ticket branch/worktree.
4. Use an implementation subagent to build and verify the change.
5. Create a local implementation commit.
6. Use a Thermos reviewer subagent to run correctness/security and code-quality
   review passes.
7. Send blocking Thermos findings back to the implementation subagent for
   bounded review-fix cycles.
8. Write a concise run summary and stop with the branch/worktree left in place
   once Thermos returns zero blocking findings.

If blocking findings remain after the configured review-fix limit, the loop
stops as blocked. It does not open a PR, merge, or complete the Kanban card.

Install into a target project:

```bash
LOOPS_REPO="/path/to/downloaded/jonathanLindquist-loops"
node "$LOOPS_REPO/scripts/install_agent_loop.mjs" \
  --project-root "$TARGET_REPO" \
  --loop implement-then-review
```

Then customize `docs/agent-loops/implement-then-review/loop-config.json`
only when that project needs project-specific values.
