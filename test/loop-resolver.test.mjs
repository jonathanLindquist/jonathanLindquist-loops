import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installAgentLoop } from "../src/loop-installer.mjs";
import {
  detectProjectFacts,
  resolveLoopConfig,
} from "../src/loop-resolver.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("merges canonical config with empty target loop config", async (t) => {
  const projectRoot = await installedLoopProject(t);

  const resolved = await resolveLoopConfig({
    projectRoot,
    loop: "implement-then-review",
  });

  assert.equal(resolved.config.loop, "implement-then-review");
  assert.equal(resolved.config.branching.baseBranch, "main");
  assert.equal(resolved.loopRef.mode, "reference");
  assert.match(
    resolved.resolvedPaths.loopContract,
    /loops\/implement-then-review\/loop\.md$/,
  );
  assert.deepEqual(resolved.targetLoopConfig, {
    schemaVersion: 1,
    loop: "implement-then-review",
  });
  assert.equal(resolved.referenceRoot, REPO_ROOT);
  assert.equal(
    resolved.resolvedPaths.loopConfig,
    join(projectRoot, "docs/agent-loops/implement-then-review/loop-config.json"),
  );
  assert.equal(resolved.projectFacts.githubRepoUrl, null);
  assert.equal(resolved.projectFacts.baseBranch, "main");
});

test("applies target loop config over canonical config", async (t) => {
  const projectRoot = await installedLoopProject(t);
  await writeTargetLoopConfig(projectRoot, {
    schemaVersion: 1,
    loop: "implement-then-review",
    branching: { baseBranch: "develop" },
    limits: { verificationRepairAttempts: 7 },
    project: { githubRepoUrl: "https://github.com/example/override.git" },
  });

  const resolved = await resolveLoopConfig({
    projectRoot,
    loop: "implement-then-review",
    requiredFacts: ["githubRepoUrl", "baseBranch"],
  });

  assert.equal(resolved.config.branching.baseBranch, "develop");
  assert.equal(resolved.config.branching.oneTicketPerBranch, true);
  assert.equal(resolved.config.limits.verificationRepairAttempts, 7);
  assert.equal(
    resolved.projectFacts.githubRepoUrl,
    "https://github.com/example/override.git",
  );
  assert.equal(resolved.projectFacts.baseBranch, "develop");
});

test("detects GitHub remote URL and origin HEAD branch from the target repo", async (t) => {
  const projectRoot = await installedLoopProject(t);
  git(projectRoot, ["init"]);
  git(projectRoot, [
    "remote",
    "add",
    "origin",
    "https://github.com/example/project.git",
  ]);
  git(projectRoot, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);

  const resolved = await resolveLoopConfig({
    projectRoot,
    loop: "implement-then-review",
    requiredFacts: ["githubRepoUrl", "baseBranch"],
  });

  assert.equal(
    resolved.projectFacts.githubRepoUrl,
    "https://github.com/example/project.git",
  );
  assert.equal(resolved.projectFacts.baseBranch, "main");
});

test("fails clearly when a required project fact is unavailable", async (t) => {
  const projectRoot = await installedLoopProject(t);

  await assert.rejects(
    resolveLoopConfig({
      projectRoot,
      loop: "implement-then-review",
      requiredFacts: ["githubRepoUrl"],
    }),
    /Unable to determine required project fact: githubRepoUrl/,
  );

  await assert.rejects(
    detectProjectFacts({
      projectRoot,
      canonicalConfig: {},
      targetLoopConfig: {},
      requiredFacts: ["baseBranch"],
    }),
    /Unable to determine required project fact: baseBranch/,
  );
});

async function installedLoopProject(t) {
  const projectRoot = await workflowProject(t);
  await installAgentLoop({ projectRoot, loop: "implement-then-review" });
  return projectRoot;
}

async function workflowProject(t) {
  const projectRoot = await tempProject(t);
  await mkdir(join(projectRoot, "docs/agents"), { recursive: true });
  await mkdir(join(projectRoot, "docs/plans"), { recursive: true });
  await writeFile(join(projectRoot, "AGENTS.md"), "# Agent Instructions\n");
  await writeFile(
    join(projectRoot, "docs/agents/project-workflow.json"),
    `${JSON.stringify(
      {
        provider: "obsidian-kanban",
        planDir: "docs/plans",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(projectRoot, "docs/agents/ticket-workflow.md"),
    "# Ticket Workflow\n",
  );
  await writeFile(
    join(projectRoot, "docs/agents/issue-tracker.md"),
    "# Issue Tracker\n",
  );
  return projectRoot;
}

async function writeTargetLoopConfig(projectRoot, config) {
  await writeFile(
    join(
      projectRoot,
      "docs/agent-loops/implement-then-review/loop-config.json",
    ),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function tempProject(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-loop-resolve-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function git(cwd, args) {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
  });
}
