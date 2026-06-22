# JL-0002 Rename loop ID to full-e2e-merge

- Ticket: JL-0002
- Board: derived from `$PROJECT_WORKFLOW_OBSIDIAN_VAULT` and `docs/agents/project-workflow.json`
- Card: JL-0002 Rename loop ID to full-e2e-merge
- Created: 2026-06-22

## Summary

Remove the redundant `-loop` suffix from the existing loop ID while keeping the
root `loops/` catalog directory. The repo should distinguish the loop catalog
from individual loop names so future loops stay easy to add.

## Context

The previous loop ID repeated the category name because the repo, root catalog
directory, and target install path already establish that these artifacts are
loops. The preferred shape is to keep `loops/` as the catalog directory for
current and future loop definitions, but shorten the individual loop ID to
`full-e2e-merge`.

The rename should update source paths and copied target paths together:

- source catalog path: `loops/full-e2e-merge/`
- target project path: `docs/agent-loops/full-e2e-merge/`

## Plan

- [x] Rename the existing loop directory to `loops/full-e2e-merge/`.
- [x] Update `loop-config.json`, README files, prompts, templates, and
  target-project paths to use `full-e2e-merge`.
- [x] Keep the root loops/ directory as the catalog home for current and future loop definitions.

## Acceptance Criteria

- [x] The existing loop ID is full-e2e-merge everywhere the individual loop is named.
- [x] The root loops/ catalog directory remains in place and contains the renamed full-e2e-merge loop directory.
- [x] No publishable file references the previous loop ID or old target-project
  path after the rename.

## Verification

- [x] Run JSON validation for loops/full-e2e-merge/loop-config.json.
- [x] Run a stale-reference search for the previous loop ID and old
  target-project path and confirm no publishable hits.
- [x] Run the project workflow verification command from docs/agents/project-workflow.json.

## Outcome

Renamed the first loop directory to `loops/full-e2e-merge/` and updated the
loop ID, target project paths, README copy, prompts, and run-summary template to
use `full-e2e-merge`. The root `loops/` directory remains the catalog home for
future loop definitions.

Verification passed:

- JSON validation confirmed `loops/full-e2e-merge/loop-config.json` parses,
  uses `full-e2e-merge`, and keeps loop docs scoped to
  `docs/agent-loops/full-e2e-merge`.
- Stale-reference searches found no publishable references to the previous loop
  ID or old target-project path in the repo or Kanban board.
- `node "$HOME/.agents/skills/setup-project-workflow/scripts/verify_project_workflow.mjs" --project-root "$PWD"` passed with 52 checks.
- `git diff --check` passed.

## Progress Notes

- 2026-06-22: Started implementation of the loop ID rename to
  `full-e2e-merge`.
