# JL-0003 Make implement-then-review run review-fix cycles

- Ticket: JL-0003
- Board: derived from `$PROJECT_WORKFLOW_OBSIDIAN_VAULT` and `docs/agents/project-workflow.json`
- Card: JL-0003 Make implement-then-review run review-fix cycles
- Created: 2026-06-24

## Summary

Change implement-then-review from a one-shot Thermos review handoff into a bounded prompt-driven implement, review, and fix loop. Keep controller code thin and deterministic: it should route gates, render directives, and stop only when Thermos returns zero blocking findings or the configured review-fix limit is exhausted.

## Context

The current `implement-then-review` loop is intentionally one-shot: it
implements once, creates a local implementation commit, runs Thermos review once,
writes a summary, and stops even when Thermos returns blocking findings. That
was useful as a smaller handoff loop, but it does not match the intended
agent-loop shape.

The preferred model is prompt-driven gate execution with minimal controller
code:

- code owns deterministic routing, retry limits, terminal statuses, and evidence
  shape.
- prompts/directives own what each agent does at a gate.
- the implementation gate should invoke the implementation discipline.
- the review gate should invoke Thermos review skills.
- blocking review findings should be passed back to implementation as the next
  gate directive.
- the loop should repeat until the reviewer returns zero blocking findings or a
  configured limit stops the run.

`full-e2e-merge` already models the review-fix cycle in its controller. This
ticket adapts that control shape to `implement-then-review` without importing
PR, merge, branch cleanup, or Kanban completion authority.

This ticket does not need to build a production non-interactive agent runtime.
The live execution model remains a controller agent following the canonical
controller prompt and spawning subagents with the canonical implementation and
review prompts. The deterministic code path should remain a small controller
model with injected effects so the loop contract is testable without real LLMs,
git remotes, GitHub, or Obsidian writes.

## Test Seam

Use the existing deterministic controller seam:

- `src/implement-then-review/run-loop.mjs`
- `test/implement-then-review/run-loop.test.mjs`
- `loops/implement-then-review/loop-config.json`
- `loops/implement-then-review/prompts/*.md`

The fake `runImplementationAgent` effect should receive enough directive data
to distinguish initial implementation from review-fix work. The fake
`runThermosReview` effect should be able to return blocking findings across
multiple cycles so tests can prove routing and limits.

## Design Direction

Keep the external controller interface small. Do not add a broad plugin system
or a command-line live runner as part of this ticket.

The controller should do only these things:

1. Preflight ticket, plan, checkout, base branch, and worktree setup.
2. Run the implementation agent in `implementation` mode.
3. Commit the implementation once the initial implementation gate is ready.
4. Run Thermos review against the current branch diff and latest implementation
   evidence.
5. If there are no blocking findings, write the run summary and return
   `reviewed`.
6. If there are blocking findings and cycles remain, run the implementation
   agent in `review-fix` mode with those findings.
7. Commit or otherwise stabilize the review-fix diff before the next review,
   using the existing commit effect or a clearly named replacement if the old
   interface no longer matches.
8. If blocking findings remain after the configured limit, stop with a blocked
   result and record unresolved findings.

The prompts should make the agent behavior explicit:

- controller prompt: "spawn implementation subagent", "spawn Thermos reviewer
  subagent", "return blocking findings to implementation", "repeat until zero
  blocking findings or limit".
- implementation prompt: accept `mode: implementation` and `mode: review-fix`;
  in review-fix mode, address only blocking findings and rerun evidence after
  the final fix.
- reviewer prompt: return structured blocking and nonblocking findings,
  acceptance status, verification evidence status, completed Thermos passes, and
  recommendation.

## Plan

- [x] Update implement-then-review docs, README, and loop config to describe bounded review-fix cycles and limits.reviewFixCycles.
- [x] Update controller, implementation-agent, and reviewer-agent prompt templates so blocking Thermos findings are passed back to implementation in review-fix mode.
- [x] Extend runImplementThenReviewLoop to iterate Thermos review and review-fix implementation attempts until zero blocking findings or the configured cycle limit.
- [x] Update deterministic tests for review-fix success, review-fix exhaustion, no PR or merge authority, and current verification evidence after fixes.
- [x] Update testing documentation if needed so implement-then-review review-fix coverage is explicitly described.

## Detailed Implementation Plan

1. Update canonical loop policy.

   - Add `limits.reviewFixCycles`, defaulting to `3`, in
     `loops/implement-then-review/loop-config.json`.
   - Replace the previous no-fix review repair policy with a bounded review-fix
     policy.
   - Replace the previous record-and-stop blocking-findings policy with one
     that routes blocking findings to implementation while cycles remain, then
     blocks with unresolved findings.
   - Keep `handoff.createPullRequest`, `handoff.merge`, and
     `handoff.completeKanbanCard` as `false`.

2. Update human-readable loop docs.

   - Update `README.md` so `implement-then-review` no longer claims it always
     stops after the first Thermos review.
   - Update `loops/implement-then-review/README.md` and
     `loops/implement-then-review/loop.md` to describe the new loop diagram:
     implementation -> local commit -> Thermos review -> blocking findings? ->
     implementation review-fix -> review again -> summary.
   - Update terminal status wording:
     - `reviewed` means zero blocking Thermos findings.
     - `blocked` with `unresolved-blocking-review-findings` means the configured
       fix cycle limit was exhausted.
   - Keep the no-PR, no-merge, no-Kanban-completion boundary visible.

3. Update prompt templates.

   - In `prompts/controller.md`, instruct the controller to repeat
     implementation/review gates until zero blocking findings or
     `limits.reviewFixCycles`.
   - In `prompts/implementation-agent.md`, add inputs for `mode`,
     `review cycle`, and `blocking findings` and state that review-fix mode is
     scoped to those findings plus any directly required tests/checks.
   - In `prompts/reviewer-agent.md`, tighten the return contract so the
     controller can route findings deterministically.
   - Keep the Thermos skills explicit:
     `thermos:thermo-nuclear-review` first, then
     `thermos:thermo-nuclear-code-quality-review`, then synthesis.

4. Update controller model.

   - Add `reviewFixCyclesUsed`.
   - After the initial implementation and local commit, run `runThermosReview`
     in a loop.
   - If `review.blockingFindings.length === 0`, write the run summary and return
     `reviewed`.
   - If blocking findings exist and `reviewFixCyclesUsed` is already at
     `limits.reviewFixCycles`, call `block("unresolved-blocking-review-findings",
     ...)`.
   - Otherwise increment `reviewFixCyclesUsed` and call
     `runImplementationAgent` with:
     - `mode: "review-fix"`
     - `attempt` or `cycle`
     - latest `blockingFindings`
     - prior implementation summary/evidence
     - ticket, plan, branch, worktree, and config
   - Require the review-fix implementation result to be `ready`.
   - Stabilize the diff before re-review. Prefer reusing
     `commitImplementation` if it can represent subsequent commits cleanly;
     otherwise introduce a narrowly named effect such as
     `commitReviewFixImplementation`.
   - Include `reviewFixCyclesUsed` and final review status in the run summary
     payload.

5. Update tests first or alongside implementation.

   - Replace the current "records blocking Thermos findings without an
     automatic fix cycle" test.
   - Add a test where the first Thermos review returns a blocking finding, the
     implementation agent is called again in `review-fix` mode, the second
     Thermos review approves, and the result is `reviewed`.
   - Add a test where every Thermos review returns blocking findings until the
     cycle limit is exhausted, and the loop returns `blocked` with
     `unresolved-blocking-review-findings`.
   - Add assertions that no PR, merge, branch cleanup, or Kanban completion
     effects are required by `implement-then-review`.
   - Preserve tests for unready top Backlog card and repeated initial
     implementation verification failure.

6. Update verification docs if the wording is stale.

   - `docs/testing-loop-verification.md` should continue to say the harness is
     local-only and fake-adapter based.
   - Update any wording that implies only `full-e2e-merge` sends blocking review
     findings back to implementation.

7. Clean up stale policy references.

   - Search for legacy no-fix policy names, stale record-and-stop policy names,
     and the old reviewed-with-blocking terminal result.
   - Remove or rewrite stale references so the docs, config, prompts, and tests
     agree on the new behavior.

## Out Of Scope

- Building a live CLI that directly launches real Codex or Claude subagents.
- Opening pull requests, pushing branches, merging, deleting worktrees, or
  completing Kanban cards from `implement-then-review`.
- Changing `full-e2e-merge` behavior except for shared docs that need clearer
  distinction.
- Designing a generic multi-loop runtime or plugin adapter layer.

## Risks And Checks

- Risk: accidentally importing `full-e2e-merge` merge authority into the smaller
  loop. Check the effect list and config to keep PR/merge/Kanban completion
  absent.
- Risk: stale verification evidence after a review fix. Prompts and tests
  should require evidence after the final review-fix change.
- Risk: ambiguous terminal states. Use `reviewed` only for zero blocking
  findings and `blocked` for exhausted unresolved findings.
- Risk: prompts and controller diverge. Treat the config, loop docs, prompt
  templates, controller model, and tests as one contract.

## Acceptance Criteria

- [x] implement-then-review no longer treats blocking Thermos findings as a successful terminal reviewed state before configured review-fix cycles are exhausted.
- [x] Docs, config, and prompt templates agree that code owns deterministic gate routing while subagent prompts own implementation and review directives.
- [x] The controller keeps implement-then-review scoped to local branch, local commit, Thermos review, and run summary; it does not gain PR, merge, or Kanban completion authority.
- [x] Tests prove blocking Thermos findings are sent back to the implementation agent and review repeats until zero blocking findings.
- [x] Tests prove unresolved blocking findings after the review-fix limit stop the loop with a clear blocked result.

## Verification

- [x] npm test
- [x] node -e 'JSON.parse(require("node:fs").readFileSync("loops/implement-then-review/loop-config.json", "utf8")); console.log("implement-then-review config ok")'
- [x] rg -n 'bounded-review-fix-cycles|route-to-implementation-until-limit|reviewFixCycles' README.md loops/implement-then-review src test docs/testing-loop-verification.md
- [x] git diff --check

## Outcome

Implemented bounded review-fix cycles for `implement-then-review`.

Summary:

- Added `limits.reviewFixCycles` to the loop config and changed the review
  policy to route blocking Thermos findings back to implementation until the
  configured limit is exhausted.
- Updated `runImplementThenReviewLoop` so initial implementation uses
  `mode: implementation`, review-fix work uses `mode: review-fix`, the current
  implementation evidence is passed into each Thermos review, and unresolved
  blocking findings block the run instead of returning a reviewed terminal
  state.
- Updated controller, implementation-agent, and reviewer-agent prompts so the
  prompt directives match the deterministic gate routing.
- Updated README, loop docs, run-summary template, and deterministic
  verification docs to describe the new behavior without granting PR, merge,
  cleanup, or Kanban completion authority.
- Expanded `test/implement-then-review/run-loop.test.mjs` with review-fix
  success, exhausted review-fix limit, no PR/merge authority, review-fix
  failure, current evidence, run-summary payload, and no successful
  reviewed-with-blocking terminal state coverage.

Verification passed on 2026-06-24:

- `node --test test/implement-then-review/run-loop.test.mjs`
- `npm test`
- `node -e 'JSON.parse(require("node:fs").readFileSync("loops/implement-then-review/loop-config.json", "utf8")); console.log("implement-then-review config ok")'`
- `rg -n 'bounded-review-fix-cycles|route-to-implementation-until-limit|reviewFixCycles' README.md loops/implement-then-review src test docs/testing-loop-verification.md`
- `rg -n 'no-automatic-review-fix-cycle|record-and-stop-after-review|reviewed-with-blocking-findings' README.md loops/implement-then-review src test docs --glob '!docs/plans/JL-0003-*'` returned no hits.
- `git diff --check`
- Changed-file secret scan found only intentional documentation/test references
  to secret-scan concepts, not credentials.

## Progress Notes

- 2026-06-24: Started implementation of bounded review-fix cycles for implement-then-review.

## Completion Notes

- 2026-06-24: Implemented bounded implement-then-review review-fix cycles, updated prompts/docs/config, expanded deterministic tests, and verified with npm test plus config, policy-search, secret-scan, and diff checks.
