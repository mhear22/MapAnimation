import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

const children = new Set();

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });

  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });

  return child;
}

function shutdown(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(143);
});

const server = spawnChild(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: process.env.PORT ?? "4822"
  }
});

const vite = spawnChild(process.execPath, [viteBin, ...process.argv.slice(2)]);

server.on("exit", (code) => {
  if (code && !vite.killed) {
    vite.kill("SIGTERM");
    process.exit(code);
  }
});

vite.on("exit", (code) => {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
  process.exit(code ?? 0);
});
