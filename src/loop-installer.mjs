import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REFERENCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REQUIRED_WORKFLOW_PATHS = [
  "AGENTS.md",
  "docs/agents/project-workflow.json",
  "docs/agents/ticket-workflow.md",
  "docs/agents/issue-tracker.md",
  "docs/plans",
];

export async function installAgentLoop({
  projectRoot,
  loop,
  referenceRoot = DEFAULT_REFERENCE_ROOT,
  dryRun = false,
  force = false,
} = {}) {
  if (!projectRoot) throw new Error("Missing required option: projectRoot");
  if (!loop) throw new Error("Missing required option: loop");

  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedReferenceRoot = resolve(referenceRoot);
  await assertLoopExists(resolvedReferenceRoot, loop);
  await assertProjectWorkflowReady(resolvedProjectRoot);

  const loopDir = join(resolvedProjectRoot, "docs/agent-loops", loop);
  const runsDir = join(loopDir, "runs");
  const loopRefPath = join(loopDir, "loop-ref.json");
  const loopConfigPath = join(loopDir, "loop-config.json");
  const runsGitignorePath = join(runsDir, ".gitignore");

  const loopConfigExists = await pathExists(loopConfigPath);
  const shouldWriteLoopConfig = force || !loopConfigExists;
  if (loopConfigExists && !force) {
    await assertExistingLoopConfig(loopConfigPath, loop);
  }

  const actions = [
    { type: "mkdir", path: loopDir },
    { type: "mkdir", path: runsDir },
    { type: "write", path: loopRefPath },
    {
      type: shouldWriteLoopConfig ? "write" : "preserve",
      path: loopConfigPath,
    },
    { type: "write", path: runsGitignorePath },
  ];

  if (dryRun) {
    return {
      status: "dry-run",
      projectRoot: resolvedProjectRoot,
      loop,
      actions,
    };
  }

  await mkdir(runsDir, { recursive: true });
  await writeFile(
    loopRefPath,
    `${JSON.stringify(createLoopRef(loop, resolvedReferenceRoot), null, 2)}\n`,
  );
  if (shouldWriteLoopConfig) {
    await writeFile(
      loopConfigPath,
      `${JSON.stringify(createTargetLoopConfig(loop), null, 2)}\n`,
    );
  }
  await writeFile(runsGitignorePath, createRunsGitignore());

  return {
    status: "installed",
    projectRoot: resolvedProjectRoot,
    loop,
    paths: {
      loopDir,
      loopRef: loopRefPath,
      loopConfig: loopConfigPath,
      runsGitignore: runsGitignorePath,
    },
    actions,
  };
}

async function assertExistingLoopConfig(path, loop) {
  const config = await parseJsonFile(path);
  if (config.loop !== loop) {
    throw new Error(
      `Existing loop config mismatch: expected ${loop}, found ${config.loop}`,
    );
  }
}

export async function assertProjectWorkflowReady(projectRoot) {
  for (const relativePath of REQUIRED_WORKFLOW_PATHS) {
    const fullPath = join(projectRoot, relativePath);
    if (!(await pathExists(fullPath))) {
      throw new Error(
        `Target repo is missing setup-project-workflow artifact: ${relativePath}`,
      );
    }
  }

  await parseJsonFile(join(projectRoot, "docs/agents/project-workflow.json"));
}

export function createLoopRef(loop, referenceRoot) {
  return {
    schemaVersion: 1,
    loop,
    mode: "reference",
    source: "jonathanLindquist-loops",
    referenceRoot: toPortablePath(referenceRoot),
    canonicalLoopPath: `loops/${loop}`,
  };
}

export function createTargetLoopConfig(loop) {
  return {
    schemaVersion: 1,
    loop,
  };
}

export function toPortablePath(path) {
  const resolvedPath = resolve(path);
  const home = resolve(homedir());
  if (resolvedPath === home) return "$HOME";

  const pathFromHome = relative(home, resolvedPath);
  if (
    pathFromHome &&
    pathFromHome !== ".." &&
    !pathFromHome.startsWith(`..${sep}`)
  ) {
    return `$HOME/${toPosixPath(pathFromHome)}`;
  }

  return toPosixPath(resolvedPath);
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

export function createRunsGitignore() {
  return [
    "# Commit concise per-ticket summaries only when a target project wants them.",
    "# Keep verbose/raw loop output local.",
    "*/raw/",
    "*/raw/**",
    "",
  ].join("\n");
}

async function assertLoopExists(referenceRoot, loop) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(loop)) {
    throw new Error(`Invalid loop id: ${loop}`);
  }

  const loopConfigPath = join(referenceRoot, "loops", loop, "loop-config.json");
  if (!(await pathExists(loopConfigPath))) {
    throw new Error(`Unknown loop '${loop}' in reference repo: ${referenceRoot}`);
  }

  await parseJsonFile(loopConfigPath);
}

async function parseJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse JSON file ${path}: ${error.message}`);
  }
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
