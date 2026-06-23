import test from "node:test";
import assert from "node:assert/strict";

import {
  loadLoopConfig,
  runFullE2eMergeLoop,
} from "../../src/full-e2e-merge/run-loop.mjs";

const config = await loadLoopConfig(
  new URL("../../loops/full-e2e-merge/loop-config.json", import.meta.url),
);

test("drives the full happy path in deterministic order", async () => {
  const effects = createEffects();

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "merged");
  assert.equal(result.ticketId, "JL-0003");
  assert.equal(
    result.branchName,
    "codex/JL-0003-deterministic-loop-harness",
  );
  assert.equal(result.pullRequestUrl, "https://example.test/pull/1");
  assert.equal(result.mergeCommit, "merge-abc123");
  assert.deepEqual(effects.calls.map((call) => call.name), [
    "readRequiredProjectFiles",
    "readTopBacklogCard",
    "readLinkedPlan",
    "compareCardAndPlan",
    "assertTargetCheckoutClean",
    "assertGithubReady",
    "assertBaseBranchReady",
    "moveCard",
    "createTicketWorktree",
    "runImplementationAgent",
    "commitPushOpenPullRequest",
    "runReviewerAgent",
    "verifyGreenGate",
    "writeRunSummary",
    "commitRunSummary",
    "squashMergeAndCleanup",
    "completeTicket",
    "confirmTicketCompleted",
  ]);
});

test("stops on an unready top Backlog card before creating branches or agents", async () => {
  const effects = createEffects({
    card: { ...readyCard(), tags: ["#needs-info"] },
  });

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unready-top-backlog-card");
  assert.deepEqual(effects.calls.map((call) => call.name), [
    "readRequiredProjectFiles",
    "readTopBacklogCard",
    "recordBlockedRun",
  ]);
});

test("routes blocking review findings back through implementation until approved", async () => {
  const effects = createEffects({
    reviews: [
      {
        blockingFindings: ["Missing acceptance evidence"],
        recommendation: "request-changes",
      },
      { blockingFindings: [], recommendation: "approve" },
    ],
  });

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "merged");
  assert.equal(result.reviewFixCyclesUsed, 1);
  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "runImplementationAgent")
      .map((call) => call.args.mode),
    ["implementation", "review-fix"],
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "runReviewerAgent").length,
    2,
  );
});

test("stops after the configured review fix cycle limit", async () => {
  const effects = createEffects({
    reviews: [
      { blockingFindings: ["Still wrong"], recommendation: "request-changes" },
      { blockingFindings: ["Still wrong"], recommendation: "request-changes" },
      { blockingFindings: ["Still wrong"], recommendation: "request-changes" },
      { blockingFindings: ["Still wrong"], recommendation: "request-changes" },
    ],
  });

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unresolved-blocking-review-findings");
  assert.equal(result.reviewFixCyclesUsed, config.limits.reviewFixCycles);
  assert.equal(
    effects.calls.filter((call) => call.name === "squashMergeAndCleanup")
      .length,
    0,
  );
});

test("stops before merge when the green gate is stale or false", async () => {
  const effects = createEffects({
    greenGate: {
      green: false,
      reason: "verification evidence is older than the last commit",
    },
  });

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "green-gate-failed");
  assert.equal(
    effects.calls.filter((call) => call.name === "writeRunSummary").length,
    0,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "squashMergeAndCleanup")
      .length,
    0,
  );
});

test("retries implementation verification failures only up to the configured limit", async () => {
  const effects = createEffects({
    implementations: [
      { status: "failed", reason: "unit test failed" },
      { status: "failed", reason: "integration test failed" },
      { status: "failed", reason: "full suite failed" },
    ],
  });

  const result = await runFullE2eMergeLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "repeated-verification-failure");
  assert.equal(
    effects.calls.filter((call) => call.name === "runImplementationAgent")
      .length,
    config.limits.verificationRepairAttempts,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "commitPushOpenPullRequest")
      .length,
    0,
  );
});

function createEffects(overrides = {}) {
  const calls = [];
  const implementations = [
    ...(overrides.implementations ?? []),
    ...Array.from({ length: 10 }, () => readyImplementation()),
  ];
  const reviews = [
    ...(overrides.reviews ?? []),
    ...Array.from({ length: 10 }, () => ({
      blockingFindings: [],
      nonblockingFindings: [],
      recommendation: "approve",
    })),
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
      text: "# JL-0003 Deterministic loop harness",
    })),
    compareCardAndPlan: effect("compareCardAndPlan", () => ({
      conflict: false,
    })),
    assertTargetCheckoutClean: effect("assertTargetCheckoutClean", () => ({
      ok: true,
    })),
    assertGithubReady: effect("assertGithubReady", () => ({ ok: true })),
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
    commitPushOpenPullRequest: effect("commitPushOpenPullRequest", () => ({
      url: "https://example.test/pull/1",
    })),
    runReviewerAgent: effect("runReviewerAgent", () => reviews.shift()),
    updatePullRequestAfterFix: effect("updatePullRequestAfterFix", () => ({
      ok: true,
    })),
    verifyGreenGate: effect(
      "verifyGreenGate",
      () => overrides.greenGate ?? { green: true },
    ),
    writeRunSummary: effect("writeRunSummary", () => ({ ok: true })),
    commitRunSummary: effect("commitRunSummary", () => ({ ok: true })),
    squashMergeAndCleanup: effect("squashMergeAndCleanup", () => ({
      commit: "merge-abc123",
    })),
    completeTicket: effect("completeTicket", () => ({ ok: true })),
    confirmTicketCompleted: effect("confirmTicketCompleted", () => ({
      completed: true,
    })),
    recordBlockedRun: effect("recordBlockedRun", () => ({ ok: true })),
  };
}

function readyCard() {
  return {
    ticketId: "JL-0003",
    title: "Deterministic loop harness",
    tags: ["#ready-for-agent"],
    planPath: "docs/plans/JL-0003-deterministic-loop-harness.md",
    todo: ["Build the harness"],
    acceptanceCriteria: ["The whole loop can be tested deterministically"],
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
