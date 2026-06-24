# implement-then-review

Canonical loop definition for taking one ready ticket through scoped
implementation and a Thermos review pass.

Install a thin target-project reference with:

```bash
LOOPS_REPO="/path/to/downloaded/jonathanLindquist-loops"
node "$LOOPS_REPO/scripts/install_agent_loop.mjs" \
  --project-root "$PWD" \
  --loop implement-then-review
```

The installer treats `--project-root` as the target repo and derives the
reference repo from its own script location.

## Files

- `loop.md`: the operating contract for implementing the top ready Backlog
  ticket and stopping after Thermos review.
- `loop-config.json`: machine-readable project policy for the loop.
- `prompts/`: reusable prompt templates for controller, implementation, and
  Thermos reviewer agents.
- `templates/run-summary.md`: summary format for each ticket run.

Target projects store only `loop-ref.json`, `loop-config.json`, and `runs/`
under `docs/agent-loops/implement-then-review/`.

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

## Non-Goals

This loop does not open pull requests, merge branches, complete Kanban cards, or
run automatic review-fix cycles. It leaves a reviewed implementation branch for
a human or a later loop to decide what happens next.
