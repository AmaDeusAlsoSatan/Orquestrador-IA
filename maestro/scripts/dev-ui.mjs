import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

const build = spawnSync(node, [path.join(rootDir, "scripts", "workspace.mjs"), "build"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const children = [
  spawn(node, [path.join(rootDir, "apps", "server", "dist", "index.js")], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, MAESTRO_SERVER_PORT: process.env.MAESTRO_SERVER_PORT || "4317" }
  }),
  spawn(node, [path.join(rootDir, "apps", "web", "scripts", "dev-server.mjs")], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, MAESTRO_WEB_PORT: process.env.MAESTRO_WEB_PORT || "5173" }
  })
];

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}
