# full-e2e-merge

Canonical loop definition for taking one ready ticket all the way through
implementation, review, pull request, merge, and closeout.

Install a thin target-project reference with:

```bash
LOOPS_REPO="/path/to/downloaded/jonathanLindquist-loops"
node "$LOOPS_REPO/scripts/install_agent_loop.mjs" \
  --project-root "$PWD" \
  --loop full-e2e-merge
```

The installer treats `--project-root` as the target repo and derives the
reference repo from its own script location.

## Files

- `loop.md`: the operating contract for taking the top ready Backlog ticket
  through implementation, review, PR, merge, and Kanban closeout.
- `loop-config.json`: machine-readable project policy for the loop.
- `prompts/`: reusable prompt templates for controller, implementation, and
  reviewer agents.
- `templates/run-summary.md`: committed summary format for each ticket run.

Target projects store only `loop-ref.json`, `loop-config.json`, and `runs/`
under `docs/agent-loops/full-e2e-merge/`.

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
