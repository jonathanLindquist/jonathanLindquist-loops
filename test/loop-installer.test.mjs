import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { installAgentLoop, toPortablePath } from "../src/loop-installer.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_SCRIPT = join(REPO_ROOT, "scripts/install_agent_loop.mjs");

test("refuses to install into a repo missing setup-project-workflow artifacts", async (t) => {
  const projectRoot = await tempProject(t);

  await assert.rejects(
    installAgentLoop({ projectRoot, loop: "implement-then-review" }),
    /missing setup-project-workflow artifact: AGENTS\.md/,
  );
});

test("creates the thin reference scaffold for a valid loop", async (t) => {
  const projectRoot = await workflowProject(t);

  const result = await installAgentLoop({
    projectRoot,
    loop: "implement-then-review",
  });

  assert.equal(result.status, "installed");
  assert.deepEqual(
    await readJson(
      join(projectRoot, "docs/agent-loops/implement-then-review/loop-ref.json"),
    ),
    {
      schemaVersion: 1,
      loop: "implement-then-review",
      mode: "reference",
      source: "jonathanLindquist-loops",
      referenceRoot: toPortablePath(REPO_ROOT),
      canonicalLoopPath: "loops/implement-then-review",
    },
  );
  assert.deepEqual(
    await readJson(
      join(
        projectRoot,
        "docs/agent-loops/implement-then-review/loop-config.json",
      ),
    ),
    {
      schemaVersion: 1,
      loop: "implement-then-review",
    },
  );
  assert.match(
    await readFile(
      join(
        projectRoot,
        "docs/agent-loops/implement-then-review/runs/.gitignore",
      ),
      "utf8",
    ),
    /\*\/raw\/\*\*/,
  );
  await assert.rejects(
    readFile(
      join(projectRoot, "docs/agent-loops/implement-then-review/loop.md"),
    ),
    /ENOENT/,
  );
});

test("reinstall is idempotent and preserves target-owned config without force", async (t) => {
  const projectRoot = await workflowProject(t);
  await installAgentLoop({ projectRoot, loop: "implement-then-review" });

  const loopDir = join(projectRoot, "docs/agent-loops/implement-then-review");
  const runSummaryPath = join(loopDir, "runs/JL-0001/summary.md");
  const loopConfigPath = join(loopDir, "loop-config.json");
  await mkdir(join(loopDir, "runs/JL-0001"), { recursive: true });
  await writeFile(runSummaryPath, "# Existing summary\n");
  await writeFile(
    loopConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        loop: "implement-then-review",
        branching: { baseBranch: "develop" },
      },
      null,
      2,
    )}\n`,
  );

  const reinstall = await installAgentLoop({
    projectRoot,
    loop: "implement-then-review",
  });
  assert.equal(reinstall.status, "installed");
  assert.equal(
    reinstall.actions.find((action) => action.path === loopConfigPath).type,
    "preserve",
  );
  assert.equal(await readFile(runSummaryPath, "utf8"), "# Existing summary\n");
  assert.equal(
    (await readJson(loopConfigPath)).branching.baseBranch,
    "develop",
  );

  await installAgentLoop({
    projectRoot,
    loop: "implement-then-review",
    force: true,
  });
  assert.equal(await readFile(runSummaryPath, "utf8"), "# Existing summary\n");
  assert.deepEqual(await readJson(loopConfigPath), {
    schemaVersion: 1,
    loop: "implement-then-review",
  });
});

test("CLI installs from a target project cwd and can be run repeatedly", async (t) => {
  const projectRoot = await workflowProject(t);

  const firstRun = await runInstallerCli(projectRoot);
  assert.match(
    firstRun.stdout,
    /Installed loop 'implement-then-review' into .+docs\/agent-loops\/implement-then-review/,
  );
  assert.deepEqual(
    await readJson(
      join(projectRoot, "docs/agent-loops/implement-then-review/loop-ref.json"),
    ),
    {
      schemaVersion: 1,
      loop: "implement-then-review",
      mode: "reference",
      source: "jonathanLindquist-loops",
      referenceRoot: toPortablePath(REPO_ROOT),
      canonicalLoopPath: "loops/implement-then-review",
    },
  );
  assert.notEqual(toPortablePath(REPO_ROOT), toPortablePath(projectRoot));

  const loopConfigPath = join(
    projectRoot,
    "docs/agent-loops/implement-then-review/loop-config.json",
  );
  await writeFile(
    loopConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        loop: "implement-then-review",
        branching: { baseBranch: "develop" },
      },
      null,
      2,
    )}\n`,
  );

  const secondRun = await runInstallerCli(projectRoot);
  assert.match(
    secondRun.stdout,
    /Installed loop 'implement-then-review' into .+docs\/agent-loops\/implement-then-review/,
  );
  assert.equal(
    (await readJson(loopConfigPath)).branching.baseBranch,
    "develop",
  );
});

test("supports dry-run without changing the target repo", async (t) => {
  const projectRoot = await workflowProject(t);

  const result = await installAgentLoop({
    projectRoot,
    loop: "implement-then-review",
    dryRun: true,
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.actions.length, 5);
  await assert.rejects(
    readFile(
      join(projectRoot, "docs/agent-loops/implement-then-review/loop-ref.json"),
    ),
    /ENOENT/,
  );
});

async function runInstallerCli(projectRoot) {
  return execFileAsync(
    process.execPath,
    [
      INSTALL_SCRIPT,
      "--project-root",
      ".",
      "--loop",
      "implement-then-review",
    ],
    { cwd: projectRoot },
  );
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

async function tempProject(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-loop-install-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
