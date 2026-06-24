import {
  assertConfigSections,
  assertEffectHandlers,
  fixedClock,
  normalizeReview,
  renderTemplate,
  slugify,
  summarizeLoopEffect,
  validateReadyCard,
} from "../loop-core.mjs";

export { loadLoopConfig, renderTemplate, slugify } from "../loop-core.mjs";

export async function runImplementThenReviewLoop({
  config,
  effects,
  clock = fixedClock,
}) {
  assertConfig(config);
  assertEffects(effects);

  const transcript = [];
  let card;
  let plan;
  let branchName;
  let worktree;
  let implementation;
  let implementationCommit;
  let review;
  let reviewFixCyclesUsed = 0;

  const record = (event, details = {}) => {
    transcript.push({ event, ...details });
  };

  const block = async (reason, details = {}) => {
    record("blocked", { reason, ...details });
    if (typeof effects.recordBlockedRun === "function") {
      await effects.recordBlockedRun({
        reason,
        details,
        ticketId: card?.ticketId,
        transcript: [...transcript],
      });
    }

    return {
      status: "blocked",
      reason,
      ticketId: card?.ticketId,
      branchName,
      implementationCommit: implementationCommit?.commit,
      reviewFixCyclesUsed,
      transcript,
    };
  };

  const ok = async (effectName, args, failureReason) => {
    const value = await effects[effectName](args);
    if (value === false || value?.ok === false) {
      return {
        blocked: true,
        result: await block(value?.reason ?? failureReason, {
          effect: effectName,
          detail: value?.detail,
        }),
      };
    }
    record(effectName, summarizeLoopEffect(value));
    return { blocked: false, value };
  };

  let gate = await ok(
    "readRequiredProjectFiles",
    { paths: config.paths },
    "missing-workflow-docs",
  );
  if (gate.blocked) return gate.result;

  gate = await ok(
    "readTopBacklogCard",
    { selection: config.ticketSelection },
    "missing-top-backlog-card",
  );
  if (gate.blocked) return gate.result;
  card = gate.value;

  const cardBlocker = validateReadyCard(
    card,
    config.ticketSelection.requiredTriageTag,
  );
  if (cardBlocker) {
    return block(cardBlocker.reason, cardBlocker.details);
  }

  gate = await ok(
    "readLinkedPlan",
    { card, plansDir: config.paths.plansDir },
    "missing-linked-plan",
  );
  if (gate.blocked) return gate.result;
  plan = gate.value;

  gate = await ok(
    "compareCardAndPlan",
    { card, plan },
    "card-plan-conflict",
  );
  if (gate.blocked) return gate.result;
  if (gate.value?.conflict) {
    return block("card-plan-conflict", { detail: gate.value.reason });
  }

  for (const [effectName, args, reason] of [
    ["assertTargetCheckoutClean", {}, "dirty-target-checkout"],
    [
      "assertBaseBranchReady",
      { baseBranch: config.branching.baseBranch },
      "missing-base-branch",
    ],
  ]) {
    gate = await ok(effectName, args, reason);
    if (gate.blocked) return gate.result;
  }

  gate = await ok(
    "moveCard",
    { ticketId: card.ticketId, lane: "In Progress" },
    "cannot-move-card-in-progress",
  );
  if (gate.blocked) return gate.result;

  branchName = renderTemplate(config.branching.branchNameTemplate, {
    ticketId: card.ticketId,
    slug: card.slug ?? slugify(card.title),
  });

  gate = await ok(
    "createTicketWorktree",
    { ticketId: card.ticketId, branchName },
    "cannot-create-ticket-worktree",
  );
  if (gate.blocked) return gate.result;
  worktree = gate.value;

  const maxImplementationAttempts =
    config.limits.verificationRepairAttempts ?? 1;

  for (let attempt = 1; attempt <= maxImplementationAttempts; attempt += 1) {
    gate = await ok(
      "runImplementationAgent",
      {
        mode: "implementation",
        attempt,
        ticketId: card.ticketId,
        card,
        plan,
        branchName,
        worktreePath: worktree.path,
        config,
      },
      "implementation-agent-failed",
    );
    if (gate.blocked) return gate.result;

    implementation = gate.value;
    if (implementation.status === "ready") break;
    if (implementation.status === "blocked") {
      return block("implementation-blocked", {
        detail: implementation.reason,
      });
    }
  }

  if (implementation?.status !== "ready") {
    return block("repeated-verification-failure", {
      attempts: maxImplementationAttempts,
    });
  }

  gate = await ok(
    "commitImplementation",
    {
      mode: "implementation",
      cycle: 0,
      ticketId: card.ticketId,
      branchName,
      implementation,
    },
    "implementation-commit-failed",
  );
  if (gate.blocked) return gate.result;
  implementationCommit = gate.value;

  const maxReviewFixCycles = config.limits.reviewFixCycles ?? 0;

  while (true) {
    gate = await ok(
      "runThermosReview",
      {
        cycle: reviewFixCyclesUsed + 1,
        ticketId: card.ticketId,
        card,
        plan,
        branchName,
        baseBranch: config.branching.baseBranch,
        worktreePath: worktree.path,
        implementation,
        implementationCommit,
        reviewSkills: config.agents.reviewSkills,
        aggregateReviewSkill: config.agents.aggregateReviewSkill,
        config,
      },
      "thermos-review-failed",
    );
    if (gate.blocked) return gate.result;
    review = normalizeReview(gate.value);

    if (review.status === "blocked") {
      return block("thermos-review-blocked", { detail: review.reason });
    }

    if (review.blockingFindings.length === 0) break;

    if (reviewFixCyclesUsed >= maxReviewFixCycles) {
      return block("unresolved-blocking-review-findings", {
        findings: review.blockingFindings,
        reviewFixCyclesUsed,
      });
    }

    reviewFixCyclesUsed += 1;
    gate = await ok(
      "runImplementationAgent",
      {
        mode: "review-fix",
        attempt: reviewFixCyclesUsed,
        cycle: reviewFixCyclesUsed,
        ticketId: card.ticketId,
        card,
        plan,
        branchName,
        worktreePath: worktree.path,
        findings: review.blockingFindings,
        previousImplementation: implementation,
        previousReview: review,
        config,
      },
      "review-fix-agent-failed",
    );
    if (gate.blocked) return gate.result;
    implementation = gate.value;

    if (implementation.status !== "ready") {
      return block("repeated-verification-failure", {
        mode: "review-fix",
        reviewFixCyclesUsed,
        detail: implementation.reason,
      });
    }

    gate = await ok(
      "commitImplementation",
      {
        mode: "review-fix",
        cycle: reviewFixCyclesUsed,
        ticketId: card.ticketId,
        branchName,
        implementation,
        findings: review.blockingFindings,
      },
      "implementation-commit-failed",
    );
    if (gate.blocked) return gate.result;
    implementationCommit = gate.value;
  }

  gate = await ok(
    "writeRunSummary",
    {
      ticketId: card.ticketId,
      result: "reviewed",
      completedAt: clock(),
      card,
      plan,
      branchName,
      worktree,
      implementation,
      implementationCommit,
      review,
      reviewFixCyclesUsed,
    },
    "cannot-write-run-summary",
  );
  if (gate.blocked) return gate.result;

  record("reviewed", {
    ticketId: card.ticketId,
    branchName,
    implementationCommit: implementationCommit.commit,
    result: "reviewed",
    reviewFixCyclesUsed,
    recommendation: review.recommendation,
  });

  return {
    status: "reviewed",
    result: "reviewed",
    ticketId: card.ticketId,
    branchName,
    implementationCommit: implementationCommit.commit,
    reviewRecommendation: review.recommendation,
    reviewFixCyclesUsed,
    blockingFindings: review.blockingFindings,
    nonblockingFindings: review.nonblockingFindings,
    transcript,
  };
}

function assertConfig(config) {
  assertConfigSections(config, [
    "paths",
    "ticketSelection",
    "agents",
    "branching",
    "limits",
    "checks",
    "review",
    "handoff",
    "failurePolicy",
    "records",
  ]);
}

function assertEffects(effects) {
  assertEffectHandlers(effects, [
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
}
