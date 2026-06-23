import test from "node:test";
import assert from "node:assert/strict";

import {
  loadLoopConfig,
  runImplementThenReviewLoop,
} from "../../src/implement-then-review/run-loop.mjs";

const config = await loadLoopConfig(
  new URL("../../loops/implement-then-review/loop-config.json", import.meta.url),
);

test("drives implementation and Thermos review in deterministic order", async () => {
  const effects = createEffects();

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "reviewed");
  assert.equal(result.result, "reviewed");
  assert.equal(result.ticketId, "JL-0004");
  assert.equal(
    result.branchName,
    "codex/JL-0004-implement-then-review-harness",
  );
  assert.equal(result.implementationCommit, "impl-abc123");
  assert.equal(result.reviewRecommendation, "approve");
  assert.deepEqual(effects.calls.map((call) => call.name), [
    "readRequiredProjectFiles",
    "readTopBacklogCard",
    "readLinkedPlan",
    "compareCardAndPlan",
    "assertTargetCheckoutClean",
    "assertBaseBranchReady",
    "moveCard",
    "createTicketWorktree",
    "runImplementationAgent",
    "commitImplementation",
    "runThermosReview",
    "writeRunSummary",
  ]);
});

test("records blocking Thermos findings without an automatic fix cycle", async () => {
  const effects = createEffects({
    thermosReview: {
      blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
      nonblockingFindings: [],
      recommendation: "request changes",
      passes: ["thermo-nuclear-review", "thermo-nuclear-code-quality-review"],
    },
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "reviewed");
  assert.equal(result.result, "reviewed-with-blocking-findings");
  assert.deepEqual(result.blockingFindings, [
    "src/example.mjs:1 misses the acceptance behavior",
  ]);
  assert.equal(
    effects.calls.filter((call) => call.name === "runImplementationAgent")
      .length,
    1,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "runThermosReview").length,
    1,
  );
});

test("stops on an unready top Backlog card before branch or agent work", async () => {
  const effects = createEffects({
    card: { ...readyCard(), tags: ["#needs-info"] },
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unready-top-backlog-card");
  assert.deepEqual(effects.calls.map((call) => call.name), [
    "readRequiredProjectFiles",
    "readTopBacklogCard",
    "recordBlockedRun",
  ]);
});

test("retries implementation verification failures and never reviews if they persist", async () => {
  const effects = createEffects({
    implementations: [
      { status: "failed", reason: "unit test failed" },
      { status: "failed", reason: "integration test failed" },
      { status: "failed", reason: "full suite failed" },
    ],
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "repeated-verification-failure");
  assert.equal(
    effects.calls.filter((call) => call.name === "runImplementationAgent")
      .length,
    config.limits.verificationRepairAttempts,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "runThermosReview").length,
    0,
  );
});

function createEffects(overrides = {}) {
  const calls = [];
  const implementations = [
    ...(overrides.implementations ?? []),
    ...Array.from({ length: 10 }, () => readyImplementation()),
  ];

  const effect = (name, fn) => async (args = {}) => {
    calls.push({ name, args });
    return fn(args);
  };

  return {
    calls,
    readRequiredProjectFiles: effect("readRequiredProjectFiles", () => ({
      ok: true,
    })),
    readTopBacklogCard: effect(
      "readTopBacklogCard",
      () => overrides.card ?? readyCard(),
    ),
    readLinkedPlan: effect("readLinkedPlan", ({ card }) => ({
      path: card.planPath,
      text: "# JL-0004 Implement then review harness",
    })),
    compareCardAndPlan: effect("compareCardAndPlan", () => ({
      conflict: false,
    })),
    assertTargetCheckoutClean: effect("assertTargetCheckoutClean", () => ({
      ok: true,
    })),
    assertBaseBranchReady: effect("assertBaseBranchReady", () => ({
      ok: true,
    })),
    moveCard: effect("moveCard", () => ({ ok: true })),
    createTicketWorktree: effect("createTicketWorktree", ({ branchName }) => ({
      path: `/tmp/${branchName.replaceAll("/", "-")}`,
    })),
    runImplementationAgent: effect("runImplementationAgent", () =>
      implementations.shift(),
    ),
    commitImplementation: effect("commitImplementation", () => ({
      commit: "impl-abc123",
    })),
    runThermosReview: effect(
      "runThermosReview",
      () =>
        overrides.thermosReview ?? {
          blockingFindings: [],
          nonblockingFindings: [],
          recommendation: "approve",
          passes: [
            "thermo-nuclear-review",
            "thermo-nuclear-code-quality-review",
          ],
        },
    ),
    writeRunSummary: effect("writeRunSummary", () => ({ ok: true })),
    recordBlockedRun: effect("recordBlockedRun", () => ({ ok: true })),
  };
}

function readyCard() {
  return {
    ticketId: "JL-0004",
    title: "Implement then review harness",
    tags: ["#ready-for-agent"],
    planPath: "docs/plans/JL-0004-implement-then-review-harness.md",
    todo: ["Build the harness"],
    acceptanceCriteria: ["The loop stops after Thermos review"],
    verification: ["npm test"],
  };
}

function readyImplementation() {
  return {
    status: "ready",
    changedFiles: ["src/example.mjs"],
    summary: "Implemented the ticket and reran checks.",
    verification: {
      focused: "passed",
      full: "passed",
      secretScan: "passed",
    },
  };
}
