import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_REFERENCE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function resolveLoopConfig({
  projectRoot,
  loop,
  referenceRoot,
  requiredFacts = [],
} = {}) {
  if (!projectRoot) throw new Error("Missing required option: projectRoot");
  if (!loop) throw new Error("Missing required option: loop");

  const resolvedProjectRoot = resolve(projectRoot);
  const loopRef = await readJson(
    join(resolvedProjectRoot, "docs/agent-loops", loop, "loop-ref.json"),
  );
  const resolvedReferenceRoot = resolveReferenceRoot({
    referenceRoot,
    loopRef,
    projectRoot: resolvedProjectRoot,
  });
  const canonicalConfig = await readJson(
    join(resolvedReferenceRoot, "loops", loop, "loop-config.json"),
  );
  const targetLoopConfig = await readJson(
    join(resolvedProjectRoot, "docs/agent-loops", loop, "loop-config.json"),
  );

  if (loopRef.loop !== loop) {
    throw new Error(
      `Loop reference mismatch: expected ${loop}, found ${loopRef.loop}`,
    );
  }
  if (loopRef.mode !== "reference") {
    throw new Error(`Unsupported loop reference mode: ${loopRef.mode}`);
  }
  if (targetLoopConfig.loop !== loop) {
    throw new Error(
      `Project loop config mismatch: expected ${loop}, found ${targetLoopConfig.loop}`,
    );
  }

  const config = deepMerge(canonicalConfig, targetLoopConfig);
  const projectFacts = await detectProjectFacts({
    projectRoot: resolvedProjectRoot,
    canonicalConfig,
    targetLoopConfig,
    requiredFacts,
  });

  return {
    loop,
    referenceRoot: resolvedReferenceRoot,
    projectRoot: resolvedProjectRoot,
    loopRef,
    canonicalConfig,
    targetLoopConfig,
    config,
    resolvedPaths: createResolvedPaths({
      referenceRoot: resolvedReferenceRoot,
      projectRoot: resolvedProjectRoot,
      loop,
      config,
    }),
    projectFacts,
  };
}

export async function detectProjectFacts({
  projectRoot,
  canonicalConfig,
  targetLoopConfig = {},
  requiredFacts = [],
}) {
  const githubRepoUrl =
    targetLoopConfig.project?.githubRepoUrl ??
    (await tryGit(projectRoot, ["remote", "get-url", "origin"]));

  const baseBranch =
    targetLoopConfig.branching?.baseBranch ??
    (await detectOriginHeadBranch(projectRoot)) ??
    canonicalConfig.branching?.baseBranch ??
    null;

  const projectFacts = {
    githubRepoUrl: githubRepoUrl || null,
    baseBranch: baseBranch || null,
  };

  for (const fact of requiredFacts) {
    if (!projectFacts[fact]) {
      throw new Error(`Unable to determine required project fact: ${fact}`);
    }
  }

  return projectFacts;
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
}

export function createResolvedPaths({ referenceRoot, projectRoot, loop, config }) {
  return {
    canonicalLoopDir: join(referenceRoot, "loops", loop),
    canonicalLoopConfig: join(referenceRoot, "loops", loop, "loop-config.json"),
    loopContract: join(referenceRoot, "loops", loop, "loop.md"),
    runSummaryTemplate: join(
      referenceRoot,
      "loops",
      loop,
      "templates/run-summary.md",
    ),
    targetLoopDir: join(projectRoot, "docs/agent-loops", loop),
    loopRef: join(projectRoot, "docs/agent-loops", loop, "loop-ref.json"),
    loopConfig: join(
      projectRoot,
      "docs/agent-loops",
      loop,
      "loop-config.json",
    ),
    runSummaryPathTemplate: join(
      projectRoot,
      config.paths.runSummaryPathTemplate,
    ),
    rawLogPathTemplate: join(projectRoot, config.paths.rawLogPathTemplate),
  };
}

function resolveReferenceRoot({ referenceRoot, loopRef, projectRoot }) {
  if (referenceRoot) return resolve(referenceRoot);
  if (loopRef.referenceRoot) {
    return expandPortablePath(loopRef.referenceRoot, projectRoot);
  }
  return DEFAULT_REFERENCE_ROOT;
}

export function expandPortablePath(path, baseDir = process.cwd()) {
  if (path === "$HOME" || path === "~") return homedir();
  if (path.startsWith("$HOME/")) return join(homedir(), path.slice(6));
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(baseDir, path);
}

async function detectOriginHeadBranch(projectRoot) {
  const originHead = await tryGit(projectRoot, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (!originHead) return null;
  return originHead.replace(/^origin\//, "");
}

async function tryGit(projectRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectRoot,
      timeout: 10_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON file ${path}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
