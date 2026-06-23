# Deterministic Loop Verification

The loop should be tested as an orchestrator, not as a pile of prompts. The
stable seam is a controller interface that drives adapters for external state:
Obsidian Kanban, linked plans, git, GitHub, subagents, checks, and run records.

`src/full-e2e-merge/run-loop.mjs` is the first executable model of that seam.
It consumes the same `loops/full-e2e-merge/loop-config.json` that the real loop
uses, then calls effect adapters in the order required by the loop contract.
Tests provide scripted adapters, so each scenario is deterministic and has no
network, git, GitHub, Obsidian, or LLM dependency.

Run the harness with:

```bash
npm test
```

## What This Proves

The scenario suite should prove the controller behavior that matters most:

- it selects only the top Backlog card and stops if it is not ready.
- it refuses to start when the card and linked plan are incomplete or
  conflicting.
- it performs preflight before any branch, worktree, or agent side effect.
- it routes implementation failures through the configured repair limit.
- it sends blocking review findings back to implementation.
- it stops after the configured review-fix limit.
- it requires a current green gate before writing the run summary or merging.
- it completes the ticket only after merge and confirms the board lane.

That is the whole loop skeleton. The subagent prompts still matter, but they are
inputs to adapters; they should not be the only executable contract.

## How To Extend It

As the repo grows, add tests in this order:

1. **Controller scenario tests** with fake adapters for every new gate or retry
   policy. These are the fastest tests and should cover most loop behavior.
2. **Parser/adapter tests** for real board-card parsing, plan loading, git
   status parsing, GitHub check interpretation, and summary rendering.
3. **Fixture-repo integration tests** that create a temporary target repo,
   temporary board file, fake `gh`, and fake agent scripts. These should prove
   the real adapters mutate files correctly without touching a real remote.
4. **Live dry-run canaries** behind an explicit opt-in flag. These can use real
   agents, but must stop before merge unless the project config explicitly
   permits merge.

Keep the interface small. If adding a new loop capability requires tests to
learn a lot of internal controller details, push that complexity behind an
adapter or a deeper helper module.
