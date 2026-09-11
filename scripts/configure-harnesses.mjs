#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = os.homedir();
const hermesHome = path.resolve(process.env.HERMES_HOME || path.join(home, ".hermes"));
const ompHome = path.resolve(process.env.OMP_HOME || path.join(home, ".omp", "agent"));
const serverEntry = path.join(root, "dist", "index.js");
const backupRoot = path.join(home, ".local", "state", "camofox-mcp", "backups");
const defaultUrl = "http://localhost:9377";
let backupStamp = "";

function usage() {
  return `Usage: bun scripts/configure-harnesses.mjs [install|uninstall] [options]

  --target hermes|omp|all  target client; repeatable (default: all)
  --camofox-url URL        browser service URL (preserves each existing value by default)
  --dry-run                print operations without writing
  --help                   show this help

Environment: HERMES_HOME, OMP_HOME, CAMOFOX_URL, CAMOFOX_API_KEY`;
}

function parseArgs(argv) {
  const result = {
    action: "install",
    targets: [],
    dryRun: false,
    url: process.env.CAMOFOX_URL || "",
  };
  const args = [...argv];
  if (["install", "uninstall"].includes(args[0])) result.action = args.shift();
  while (args.length) {
    const argument = args.shift();
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--target") result.targets.push(String(args.shift() || ""));
    else if (argument === "--camofox-url") result.url = String(args.shift() || "");
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!result.targets.length || result.targets.includes("all")) result.targets = ["hermes", "omp"];
  result.targets = [...new Set(result.targets)];
  const invalid = result.targets.filter((target) => !["hermes", "omp"].includes(target));
  if (invalid.length) throw new Error(`Unknown target: ${invalid.join(", ")}`);
  if (result.url) result.url = normalizeUrl(result.url);
  return result;
}

const options = parseArgs(process.argv.slice(2));

function normalizeUrl(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("CAMOFOX_URL must use http:// or https://.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

function log(message) {
  process.stdout.write(`${options.dryRun ? "[dry-run] " : ""}${message}\n`);
}

function commandPath(name) {
  try {
    return execFileSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function run(command, args, environment = {}) {
  log(`run ${[command, ...args].map((value) => JSON.stringify(value)).join(" ")}`);
  if (options.dryRun) return;
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
}

function readJson(file, fallback = {}) {
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`Cannot parse JSON ${file}: ${cause.message}`);
  }
}

function backup(file) {
  if (!existsSync(file) || options.dryRun) return;
  if (!backupStamp) backupStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relative = file.replace(/^[/\\]+/, "").replace(/:/g, "");
  const destination = path.join(backupRoot, backupStamp, relative);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(file, destination);
}

function atomicWrite(file, content, mode = 0o600) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (existing === normalized) {
    log(`unchanged ${file}`);
    return;
  }
  log(`${existing === null ? "create" : "update"} ${file}`);
  if (options.dryRun) return;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  backup(file);
  const temporary = `${file}.camofox-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, normalized, { mode });
  renameSync(temporary, file);
  chmodSync(file, mode);
}

function hermesArgs(profile, args) {
  return profile === "default" ? args : ["--profile", profile, ...args];
}

function hermesGet(hermes, profile, key) {
  try {
    return execFileSync(hermes, hermesArgs(profile, ["config", "get", key]), {
      encoding: "utf8",
      env: { ...process.env, HERMES_HOME: hermesHome },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function hermesProfiles({ configuredOnly = false } = {}) {
  const profiles = [{ name: "default", directory: hermesHome }];
  const profilesRoot = path.join(hermesHome, "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      const directory = path.join(profilesRoot, entry.name);
      if (entry.isDirectory() && existsSync(path.join(directory, "config.yaml"))) {
        profiles.push({ name: entry.name, directory });
      }
    }
  }
  const hermes = commandPath("hermes");
  if (!hermes) throw new Error("Hermes is not on PATH; its native configuration command is required.");
  return profiles.filter((profile) => {
    const privateWorker = hermesGet(hermes, profile.name, "mcp_servers.librarian-okf") !== null;
    if (privateWorker) return false;
    return !configuredOnly || hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp") !== null;
  });
}

function profileUrl(existingUrl) {
  return normalizeUrl(options.url || existingUrl || defaultUrl);
}

function installHermes() {
  const hermes = commandPath("hermes");
  if (!hermes) throw new Error("Hermes is not on PATH; its native configuration command is required.");
  for (const profile of hermesProfiles()) {
    const existingUrl = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.env.CAMOFOX_URL");
    const existingKey = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.env.CAMOFOX_API_KEY");
    const environment = { CAMOFOX_URL: profileUrl(existingUrl) };
    const apiKey = process.env.CAMOFOX_API_KEY || existingKey;
    if (apiKey) environment.CAMOFOX_API_KEY = apiKey;
    const server = {
      command: process.execPath,
      args: [serverEntry],
      cwd: root,
      env: environment,
      enabled: true,
    };
    run(
      hermes,
      hermesArgs(profile.name, ["config", "set", "--force", "mcp_servers.camofox-mcp", JSON.stringify(server)]),
      { HERMES_HOME: hermesHome },
    );
  }
}

function uninstallHermes() {
  const hermes = commandPath("hermes");
  if (!hermes) throw new Error("Hermes is not on PATH; its native configuration command is required.");
  for (const profile of hermesProfiles({ configuredOnly: true })) {
    run(
      hermes,
      hermesArgs(profile.name, ["config", "unset", "mcp_servers.camofox-mcp"]),
      { HERMES_HOME: hermesHome },
    );
  }
}

function ompRoot() {
  return path.basename(ompHome) === "agent"
    ? path.dirname(ompHome)
    : path.resolve(process.env.OMP_ROOT || path.join(home, ".omp"));
}

function isOrdinaryOmpServerSet(servers) {
  if (!servers || typeof servers !== "object" || Object.hasOwn(servers, "librarian-okf")) return false;
  return ["retrieval", "camofox", "localflame", "context-mode", "codebase-memory-mcp"]
    .some((name) => Object.hasOwn(servers, name));
}

function ompAgentDirectories({ configuredOnly = false } = {}) {
  const directories = [ompHome];
  const profilesRoot = path.join(ompRoot(), "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(profilesRoot, entry.name, "agent");
      const mcpPath = path.join(directory, "mcp.json");
      if (!existsSync(mcpPath)) continue;
      const servers = readJson(mcpPath, {}).mcpServers;
      if (isOrdinaryOmpServerSet(servers)) directories.push(directory);
    }
  }
  return [...new Set(directories.map((directory) => path.resolve(directory)))]
    .filter((directory) => {
      if (!configuredOnly) return true;
      const file = path.join(directory, "mcp.json");
      return existsSync(file) && Boolean(readJson(file, {}).mcpServers?.camofox);
    });
}

function installOmp() {
  for (const directory of ompAgentDirectories()) {
    const file = path.join(directory, "mcp.json");
    const config = readJson(file, {
      $schema: "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
      mcpServers: {},
    });
    config.mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
    const existing = config.mcpServers.camofox && typeof config.mcpServers.camofox === "object"
      ? config.mcpServers.camofox
      : {};
    const environment = existing.env && typeof existing.env === "object" ? { ...existing.env } : {};
    environment.CAMOFOX_URL = profileUrl(environment.CAMOFOX_URL);
    if (process.env.CAMOFOX_API_KEY) environment.CAMOFOX_API_KEY = process.env.CAMOFOX_API_KEY;
    config.mcpServers.camofox = {
      type: "stdio",
      command: process.execPath,
      args: [serverEntry],
      cwd: root,
      env: environment,
      enabled: true,
    };
    if (Array.isArray(config.disabledServers)) {
      config.disabledServers = config.disabledServers.filter((name) => name !== "camofox");
    }
    atomicWrite(file, JSON.stringify(config, null, 2));
  }
}

function uninstallOmp() {
  for (const directory of ompAgentDirectories({ configuredOnly: true })) {
    const file = path.join(directory, "mcp.json");
    const config = readJson(file, {});
    delete config.mcpServers.camofox;
    atomicWrite(file, JSON.stringify(config, null, 2));
  }
}

if (!existsSync(serverEntry) && options.action === "install" && !options.dryRun) {
  throw new Error(`Built MCP entrypoint is missing: ${serverEntry}`);
}

const actions = {
  install: { hermes: installHermes, omp: installOmp },
  uninstall: { hermes: uninstallHermes, omp: uninstallOmp },
};
for (const target of options.targets) {
  log(`${options.action} ${target}`);
  actions[options.action][target]();
}
if (backupStamp) log(`backups: ${path.join(backupRoot, backupStamp)}`);
