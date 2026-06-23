import { readFile } from "node:fs/promises";

export async function loadLoopConfig(configPath) {
  return JSON.parse(await readFile(configPath, "utf8"));
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

export function validateReadyCard(card, requiredTag) {
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

export function normalizeReview(review) {
  return {
    ...review,
    blockingFindings: review?.blockingFindings ?? [],
    nonblockingFindings: review?.nonblockingFindings ?? [],
  };
}

export function summarizeLoopEffect(value) {
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
        "recommendation",
      ].includes(key),
    ),
  );
}

export function fixedClock() {
  return "1970-01-01T00:00:00.000Z";
}

export function assertConfigSections(config, sectionNames) {
  for (const sectionName of sectionNames) {
    if (!config?.[sectionName]) {
      throw new Error(`Missing loop config section: ${sectionName}`);
    }
  }
}

export function assertEffectHandlers(effects, effectNames) {
  for (const effectName of effectNames) {
    if (typeof effects?.[effectName] !== "function") {
      throw new Error(`Missing loop effect: ${effectName}`);
    }
  }
}
