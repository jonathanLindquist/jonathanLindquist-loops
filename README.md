# Agent Loop Templates

Reusable loop scaffolds for project-local agent workflows.

This repository is a template source, not the runtime home for project loop
history. Each loop lives under `loops/<loop-id>/` and is copied into a target
repository that already uses `setup-project-workflow`.

Target repositories should keep each loop isolated under
`docs/agent-loops/<loop-id>/`. Commit concise run summaries there, and keep raw
logs local.

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

Copy into a target project from this repository root:

```bash
TARGET_REPO=/path/to/target-repo
mkdir -p "$TARGET_REPO/docs/agent-loops/full-e2e-merge"
cp -R loops/full-e2e-merge/. "$TARGET_REPO/docs/agent-loops/full-e2e-merge/"
```

Then customize `docs/agent-loops/full-e2e-merge/loop-config.json` for that
project.

## implement-then-review

The smaller loop turns the top ready Backlog ticket into an implemented branch
with a Thermos review result:

1. Read the project workflow docs, Obsidian Kanban board, and linked plan.
2. Work the top Backlog card only when it is `#ready-for-agent`.
3. Create an isolated ticket branch/worktree.
4. Use an implementation subagent to build and verify the change.
5. Create a local implementation commit.
6. Use a Thermos reviewer subagent to run correctness/security and code-quality
   review passes.
7. Write a concise run summary and stop with the branch/worktree left in place.

It does not open a PR, merge, complete the Kanban card, or run automatic
review-fix cycles.

Copy into a target project from this repository root:

```bash
TARGET_REPO=/path/to/target-repo
mkdir -p "$TARGET_REPO/docs/agent-loops/implement-then-review"
cp -R loops/implement-then-review/. "$TARGET_REPO/docs/agent-loops/implement-then-review/"
```

Then customize `docs/agent-loops/implement-then-review/loop-config.json` for
that project.
