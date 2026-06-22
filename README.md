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
- `loops/<loop-id>/`: future loop definitions, each with its own config,
  prompts, templates, and run-record policy.

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
