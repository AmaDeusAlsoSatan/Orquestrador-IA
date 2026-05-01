import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];

const workspaces = [
  "packages/core",
  "packages/agents",
  "packages/runner",
  "packages/memory",
  "packages/providers",
  "apps/server",
  "apps/cli",
  "apps/web"
];

if (!["build", "clean", "typecheck"].includes(command)) {
  console.error("Usage: node scripts/workspace.mjs <build|clean|typecheck>");
  process.exit(1);
}

for (const workspace of workspaces) {
  const workspaceDir = path.join(rootDir, workspace);

  if (command === "clean") {
    console.log(`clean ${workspace}`);
    rmSync(path.join(workspaceDir, "dist"), { recursive: true, force: true });
    continue;
  }

  const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
  const args = [tscPath, "-p", path.join(workspaceDir, "tsconfig.json")];

  if (command === "typecheck") {
    args.push("--noEmit");
  }

  console.log(`${command} ${workspace}`);
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (command === "build" && workspace === "apps/web") {
    const copyResult = spawnSync(process.execPath, [path.join(workspaceDir, "scripts", "copy-static.mjs")], {
      cwd: rootDir,
      stdio: "inherit",
      shell: false
    });

    if (copyResult.status !== 0) {
      process.exit(copyResult.status ?? 1);
    }
  }
}
