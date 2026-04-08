import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ECR_REPOSITORY = "115136208505.dkr.ecr.ap-southeast-2.amazonaws.com/mapanim";
export const AWS_REGION = "ap-southeast-2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.resolve(__dirname, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureSuccess(command, result) {
  if (result.error) {
    if (result.error.code === "ENOENT") {
      fail(`Required command not found: ${command}`);
    }

    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });

  ensureSuccess(command, result);
  return result;
}

export function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  });

  ensureSuccess(command, result);
  return result.stdout.trim();
}

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error;
}

export function resolveContainerEngine() {
  if (process.env.MAPANIM_CONTAINER_ENGINE) {
    return process.env.MAPANIM_CONTAINER_ENGINE;
  }

  if (hasCommand("docker")) {
    return "docker";
  }

  if (hasCommand("podman")) {
    return "podman";
  }

  fail("Neither docker nor podman is installed.");
}

export function ensureLocalDockerDirs() {
  mkdirSync(path.join(rootDir, "output"), { recursive: true });
  mkdirSync(path.join(rootDir, "presets"), { recursive: true });
}

export function mountPathSuffix(containerEngine) {
  return containerEngine === "podman" ? ":Z" : "";
}
