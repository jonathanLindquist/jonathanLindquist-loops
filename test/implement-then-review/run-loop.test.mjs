import test from "node:test";
import assert from "node:assert/strict";

import {
  loadLoopConfig,
  runImplementThenReviewLoop,
} from "../../src/implement-then-review/run-loop.mjs";

const config = await loadLoopConfig(
  new URL("../../loops/implement-then-review/loop-config.json", import.meta.url),
);

test("drives implement-jl and review-jl in deterministic order", async () => {
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
    "runReviewAgent",
    "writeRunSummary",
  ]);
  assert.equal(
    effects.calls.find((call) => call.name === "runImplementationAgent").args
      .implementationSkill,
    "implement-jl",
  );
  assert.equal(
    effects.calls.find((call) => call.name === "runReviewAgent").args
      .reviewSkill,
    "review-jl",
  );
});

test("routes blocking review-jl findings through review-fix until approved", async () => {
  const effects = createEffects({
    reviews: [
      {
        blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      },
      {
        blockingFindings: [],
        nonblockingFindings: [],
        recommendation: "approve",
        passes: ["review-jl"],
      },
    ],
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "reviewed");
  assert.equal(result.result, "reviewed");
  assert.equal(result.reviewFixCyclesUsed, 1);
  assert.deepEqual(result.blockingFindings, []);
  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "runImplementationAgent")
      .map((call) => call.args.mode),
    ["implementation", "review-fix"],
  );
  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "commitImplementation")
      .map((call) => call.args.mode),
    ["implementation", "review-fix"],
  );
  assert.deepEqual(
    effects.calls.find(
      (call) =>
        call.name === "runImplementationAgent" &&
        call.args.mode === "review-fix",
    ).args.findings,
    ["src/example.mjs:1 misses the acceptance behavior"],
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "runReviewAgent").length,
    2,
  );
});

test("stops after the configured review-fix cycle limit", async () => {
  const effects = createEffects({
    reviews: [
      ...Array.from({ length: config.limits.reviewFixCycles + 1 }, () => ({
        blockingFindings: [
          "src/example.mjs:1 misses the acceptance behavior",
        ],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      })),
    ],
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unresolved-blocking-review-findings");
  assert.equal(result.reviewFixCyclesUsed, config.limits.reviewFixCycles);
  assert.equal(
    effects.calls.filter((call) => call.name === "runImplementationAgent")
      .length,
    config.limits.reviewFixCycles + 1,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "runReviewAgent").length,
    config.limits.reviewFixCycles + 1,
  );
  assert.equal(
    effects.calls.filter((call) => call.name === "writeRunSummary").length,
    0,
  );
});

test("does not require PR, merge, cleanup, or Kanban completion effects", async () => {
  const effects = createEffects();

  await runImplementThenReviewLoop({ config, effects });

  assert.deepEqual(
    effects.calls
      .map((call) => call.name)
      .filter((name) =>
        [
          "commitPushOpenPullRequest",
          "updatePullRequestAfterFix",
          "squashMergeAndCleanup",
          "completeTicket",
          "confirmTicketCompleted",
        ].includes(name),
      ),
    [],
  );
});

test("review-fix implementation failures block before re-review", async () => {
  const effects = createEffects({
    implementations: [
      readyImplementation(),
      { status: "failed", reason: "full suite failed after review fix" },
    ],
    reviews: [
      {
        blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      },
    ],
  });

  const result = await runImplementThenReviewLoop({ config, effects });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "repeated-verification-failure");
  assert.equal(result.reviewFixCyclesUsed, 1);
  assert.equal(
    effects.calls.filter((call) => call.name === "runReviewAgent").length,
    1,
  );
  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "runImplementationAgent")
      .map((call) => call.args.mode),
    ["implementation", "review-fix"],
  );
});

test("passes current implementation evidence into each review-jl review", async () => {
  const effects = createEffects({
    implementations: [
      readyImplementation({ summary: "Initial implementation." }),
      readyImplementation({ summary: "Review fix with fresh checks." }),
    ],
    reviews: [
      {
        blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      },
      {
        blockingFindings: [],
        nonblockingFindings: [],
        recommendation: "approve",
        passes: ["review-jl"],
      },
    ],
  });

  await runImplementThenReviewLoop({ config, effects });

  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "runReviewAgent")
      .map((call) => call.args.implementation.summary),
    ["Initial implementation.", "Review fix with fresh checks."],
  );
  assert.deepEqual(
    effects.calls
      .filter((call) => call.name === "runReviewAgent")
      .map((call) => call.args.implementationCommit.commit),
    ["impl-abc123", "impl-fix-1"],
  );
});

test("review-fix cycle count is included in the run summary payload", async () => {
  const effects = createEffects({
    reviews: [
      {
        blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      },
      {
        blockingFindings: [],
        nonblockingFindings: [],
        recommendation: "approve",
        passes: ["review-jl"],
      },
    ],
  });

  await runImplementThenReviewLoop({ config, effects });

  const summaryCall = effects.calls.find(
    (call) => call.name === "writeRunSummary",
  );
  assert.equal(summaryCall.args.result, "reviewed");
  assert.equal(summaryCall.args.reviewFixCyclesUsed, 1);
});

test("blocking review-jl findings are not a successful reviewed terminal state", async () => {
  const effects = createEffects({
    reviews: [
      {
        blockingFindings: ["src/example.mjs:1 misses the acceptance behavior"],
        nonblockingFindings: [],
        recommendation: "request changes",
        passes: ["review-jl"],
      },
    ],
  });
  const noFixConfig = {
    ...config,
    limits: { ...config.limits, reviewFixCycles: 0 },
  };

  const result = await runImplementThenReviewLoop({
    config: noFixConfig,
    effects,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unresolved-blocking-review-findings");
  assert.deepEqual(result.transcript.at(-1), {
    event: "blocked",
    reason: "unresolved-blocking-review-findings",
    findings: [
      "src/example.mjs:1 misses the acceptance behavior",
    ],
    reviewFixCyclesUsed: 0,
  });
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
    effects.calls.filter((call) => call.name === "runReviewAgent").length,
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
    ...(overrides.reviews ?? (overrides.review ? [overrides.review] : [])),
    ...Array.from({ length: 10 }, () => ({
      blockingFindings: [],
      nonblockingFindings: [],
      recommendation: "approve",
      passes: ["review-jl"],
    })),
  ];
  let commitCount = 0;

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
    commitImplementation: effect("commitImplementation", () => {
      const commit =
        commitCount === 0 ? "impl-abc123" : `impl-fix-${commitCount}`;
      commitCount += 1;
      return { commit };
    }),
    runReviewAgent: effect("runReviewAgent", () => reviews.shift()),
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
    acceptanceCriteria: ["The loop passes only after review-jl approves"],
    verification: ["npm test"],
  };
}

function readyImplementation(overrides = {}) {
  return {
    status: "ready",
    changedFiles: ["src/example.mjs"],
    summary: "Implemented the ticket and reran checks.",
    verification: {
      focused: "passed",
      full: "passed",
      secretScan: "passed",
    },
    ...overrides,
  };
}
