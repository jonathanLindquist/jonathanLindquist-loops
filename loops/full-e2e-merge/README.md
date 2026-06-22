# full-e2e-merge

Project-local loop definition and run records for taking one ready ticket all
the way through implementation, review, pull request, merge, and closeout.

Copy this directory into a target repository as
`docs/agent-loops/full-e2e-merge/`.

## Files

- `loop.md`: the operating contract for taking the top ready Backlog ticket
  through implementation, review, PR, merge, and Kanban closeout.
- `loop-config.json`: machine-readable project policy for the loop.
- `prompts/`: reusable prompt templates for controller, implementation, and
  reviewer agents.
- `templates/run-summary.md`: committed summary format for each ticket run.
- `runs/`: project-local run history. Commit `summary.md`; keep `raw/` logs
  ignored.

## Required Project Shape

This loop requires:

- `AGENTS.md`
- `docs/agents/project-workflow.json`
- `docs/agents/ticket-workflow.md`
- `docs/agents/issue-tracker.md`
- an Obsidian Kanban board configured by `setup-project-workflow`
- linked ticket plans under `docs/plans/`

If those files are missing, run or repair `setup-project-workflow` before using
this loop.
