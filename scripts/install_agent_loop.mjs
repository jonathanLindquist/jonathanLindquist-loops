#!/usr/bin/env node

import { installAgentLoop } from "../src/loop-installer.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await installAgentLoop(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.status === "dry-run") {
    process.stdout.write(
      [
        `Would install loop '${result.loop}' into ${result.projectRoot}`,
        ...result.actions.map((action) => `- ${action.type}: ${action.path}`),
        "",
      ].join("\n"),
    );
  } else {
    process.stdout.write(
      `Installed loop '${result.loop}' into ${result.paths.loopDir}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    force: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-root") {
      options.projectRoot = readValue(args, (index += 1), arg);
    } else if (arg === "--loop") {
      options.loop = readValue(args, (index += 1), arg);
    } else if (arg === "--reference-root") {
      options.referenceRoot = readValue(args, (index += 1), arg);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${helpText()}`);
    }
  }

  return options;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function helpText() {
  return `Usage:
  node scripts/install_agent_loop.mjs --project-root <path> --loop <loop-id> [options]

Options:
  --dry-run          Print planned writes without changing files.
  --force            Replace an existing loop-config.json.
  --json             Print machine-readable output.
  --reference-root   Override the reference repo root. Defaults to the repo containing this installer, not the current working directory.
`;
}
