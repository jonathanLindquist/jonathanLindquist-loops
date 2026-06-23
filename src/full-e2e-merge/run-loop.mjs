import { readFile } from "node:fs/promises";

export async function loadLoopConfig(configPath) {
  return JSON.parse(await readFile(configPath, "utf8"));
}

export async function runFullE2eMergeLoop({ config, effects, clock = fixedClock }) {
  assertConfig(config);
  assertEffects(effects);

  const transcript = [];
  let card;
  let plan;
  let branchName;
  let worktree;
  let implementation;
  let pullRequest;
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
      pullRequestUrl: pullRequest?.url,
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
    record(effectName, summarize(value));
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
    ["assertGithubReady", {}, "missing-github-auth"],
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
    "commitPushOpenPullRequest",
    { ticketId: card.ticketId, branchName, implementation },
    "cannot-open-pull-request",
  );
  if (gate.blocked) return gate.result;
  pullRequest = gate.value;

  const maxReviewFixCycles = config.limits.reviewFixCycles ?? 0;

  while (true) {
    gate = await ok(
      "runReviewerAgent",
      {
        ticketId: card.ticketId,
        card,
        plan,
        pullRequest,
        implementation,
        config,
        cycle: reviewFixCyclesUsed + 1,
      },
      "reviewer-agent-failed",
    );
    if (gate.blocked) return gate.result;
    review = normalizeReview(gate.value);

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
        ticketId: card.ticketId,
        card,
        plan,
        branchName,
        worktreePath: worktree.path,
        pullRequest,
        findings: review.blockingFindings,
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
      "updatePullRequestAfterFix",
      { ticketId: card.ticketId, pullRequest, implementation },
      "cannot-update-pull-request-after-fix",
    );
    if (gate.blocked) return gate.result;
  }

  gate = await ok(
    "verifyGreenGate",
    {
      ticketId: card.ticketId,
      card,
      plan,
      branchName,
      pullRequest,
      implementation,
      review,
    },
    "green-gate-failed",
  );
  if (gate.blocked) return gate.result;
  if (gate.value?.green !== true) {
    return block("green-gate-failed", { detail: gate.value?.reason });
  }

  gate = await ok(
    "writeRunSummary",
    {
      ticketId: card.ticketId,
      result: "merged",
      completedAt: clock(),
      card,
      plan,
      branchName,
      pullRequest,
      implementation,
      review,
      reviewFixCyclesUsed,
    },
    "cannot-write-run-summary",
  );
  if (gate.blocked) return gate.result;

  gate = await ok(
    "commitRunSummary",
    { ticketId: card.ticketId, branchName },
    "cannot-commit-run-summary",
  );
  if (gate.blocked) return gate.result;

  gate = await ok(
    "squashMergeAndCleanup",
    { ticketId: card.ticketId, branchName, pullRequest, worktree },
    "cannot-merge-or-clean-up",
  );
  if (gate.blocked) return gate.result;
  const merge = gate.value;

  gate = await ok(
    "completeTicket",
    {
      ticketId: card.ticketId,
      planPath: card.planPath,
      merge,
      pullRequest,
    },
    "cannot-complete-ticket",
  );
  if (gate.blocked) return gate.result;

  gate = await ok(
    "confirmTicketCompleted",
    { ticketId: card.ticketId },
    "kanban-completion-unconfirmed",
  );
  if (gate.blocked) return gate.result;
  if (gate.value?.completed !== true) {
    return block("kanban-completion-unconfirmed", { detail: gate.value });
  }

  record("merged", {
    ticketId: card.ticketId,
    branchName,
    pullRequestUrl: pullRequest.url,
    mergeCommit: merge.commit,
  });

  return {
    status: "merged",
    ticketId: card.ticketId,
    branchName,
    pullRequestUrl: pullRequest.url,
    mergeCommit: merge.commit,
    reviewFixCyclesUsed,
    transcript,
  };
}

export function renderTemplate(template, values) {
  return template.replaceAll(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return values[key];
  });
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function validateReadyCard(card, requiredTag) {
  if (!card) return { reason: "missing-top-backlog-card" };
  if (!Array.isArray(card.tags) || !card.tags.includes(requiredTag)) {
    return {
      reason: "unready-top-backlog-card",
      details: { requiredTag },
    };
  }
  if (!card.ticketId || !card.title || !card.planPath) {
    return {
      reason: "incomplete-card",
      details: { missing: ["ticketId", "title", "planPath"] },
    };
  }

  for (const [sectionName, items] of Object.entries({
    todo: card.todo,
    acceptanceCriteria: card.acceptanceCriteria,
    verification: card.verification,
  })) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        reason: "incomplete-card",
        details: { missingSection: sectionName },
      };
    }
  }

  return null;
}

function normalizeReview(review) {
  return {
    ...review,
    blockingFindings: review?.blockingFindings ?? [],
    nonblockingFindings: review?.nonblockingFindings ?? [],
  };
}

function summarize(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) =>
      [
        "ticketId",
        "title",
        "planPath",
        "path",
        "url",
        "status",
        "green",
        "completed",
        "commit",
        "conflict",
      ].includes(key),
    ),
  );
}

function fixedClock() {
  return "1970-01-01T00:00:00.000Z";
}

function assertConfig(config) {
  for (const path of [
    "paths",
    "ticketSelection",
    "branching",
    "limits",
    "checks",
    "merge",
  ]) {
    if (!config?.[path]) throw new Error(`Missing loop config section: ${path}`);
  }
}

function assertEffects(effects) {
  for (const effectName of [
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
    "updatePullRequestAfterFix",
    "verifyGreenGate",
    "writeRunSummary",
    "commitRunSummary",
    "squashMergeAndCleanup",
    "completeTicket",
    "confirmTicketCompleted",
  ]) {
    if (typeof effects?.[effectName] !== "function") {
      throw new Error(`Missing loop effect: ${effectName}`);
    }
  }
}
