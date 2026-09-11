#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = os.homedir();
const hermesHome = path.resolve(process.env.HERMES_HOME || path.join(home, ".hermes"));
const ompHome = path.resolve(process.env.OMP_HOME || path.join(home, ".omp", "agent"));
const serverEntry = path.join(root, "dist", "index.js");
const requested = [];
let jsonOutput = false;
const args = process.argv.slice(2);
while (args.length) {
  const argument = args.shift();
  if (argument === "--target") requested.push(String(args.shift() || ""));
  else if (argument === "--camofox-url") args.shift();
  else if (argument === "--dry-run") {}
  else if (argument === "--json") jsonOutput = true;
  else if (argument === "--help" || argument === "-h") {
    console.log("Usage: bun scripts/doctor-harnesses.mjs [--target hermes|omp|all] [--json]");
    process.exit(0);
  } else throw new Error(`Unknown option: ${argument}`);
}
const targets = !requested.length || requested.includes("all")
  ? ["hermes", "omp"]
  : [...new Set(requested)];
const invalid = targets.filter((target) => !["hermes", "omp"].includes(target));
if (invalid.length) throw new Error(`Unknown target: ${invalid.join(", ")}`);

const checks = [];
function check(target, name, pass, detail) {
  checks.push({ target, name, pass: Boolean(pass), detail });
}

function commandPath(name) {
  try {
    return execFileSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function readJson(file, fallback = {}) {
  if (!existsSync(file)) return structuredClone(fallback);
  return JSON.parse(readFileSync(file, "utf8"));
}

function sameExecutable(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function hermesArgs(profile, values) {
  return profile === "default" ? values : ["--profile", profile, ...values];
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

function hermesOutput(hermes, profile, values) {
  try {
    return execFileSync(hermes, hermesArgs(profile, values), {
      encoding: "utf8",
      env: { ...process.env, HERMES_HOME: hermesHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function hermesProfiles() {
  const result = [{ name: "default", directory: hermesHome }];
  const profilesRoot = path.join(hermesHome, "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      const directory = path.join(profilesRoot, entry.name);
      if (entry.isDirectory() && existsSync(path.join(directory, "config.yaml"))) {
        result.push({ name: entry.name, directory });
      }
    }
  }
  return result;
}

function ordinaryHermesProfiles(hermes) {
  return hermesProfiles().filter((profile) => hermesGet(hermes, profile.name, "mcp_servers.librarian-okf") === null);
}

function isolatedHermesProfiles(hermes) {
  return hermesProfiles().filter((profile) => hermesGet(hermes, profile.name, "mcp_servers.librarian-okf") !== null);
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

function ompProfiles() {
  const result = [{ name: "default", directory: ompHome, ordinary: true }];
  const profilesRoot = path.join(ompRoot(), "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(profilesRoot, entry.name, "agent");
      const file = path.join(directory, "mcp.json");
      if (!existsSync(file)) continue;
      const servers = readJson(file, {}).mcpServers;
      result.push({ name: entry.name, directory, ordinary: isOrdinaryOmpServerSet(servers) });
    }
  }
  return result;
}

check("core", "source package", existsSync(path.join(root, "package.json")), path.join(root, "package.json"));
check("core", "built stdio entrypoint", existsSync(serverEntry), serverEntry);
check("core", "MCP SDK dependency", existsSync(path.join(root, "node_modules", "@modelcontextprotocol", "sdk")), "official SDK installed");

const bun = commandPath("bun");
check("core", "Bun runtime", Boolean(bun), bun || "not on PATH");

if (targets.includes("hermes")) {
  const hermes = commandPath("hermes");
  check("hermes", "native CLI", Boolean(hermes), hermes || "not on PATH");
  if (hermes) {
    for (const profile of ordinaryHermesProfiles(hermes)) {
      const prefix = profile.name;
      const command = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.command");
      const entry = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.args.0");
      const enabled = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.enabled");
      const url = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.env.CAMOFOX_URL");
      const tools = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp.tools");
      check("hermes", `${prefix} MCP command`, Boolean(command && bun && sameExecutable(command, bun)), command || "missing");
      check("hermes", `${prefix} MCP entrypoint`, path.resolve(entry || "") === serverEntry, entry || "missing");
      check("hermes", `${prefix} enabled`, enabled === "true", `enabled=${enabled}`);
      check("hermes", `${prefix} browser URL`, Boolean(url && /^https?:\/\//.test(url)), url || "missing");
      check("hermes", `${prefix} all MCP tools`, tools === null, tools === null ? "no include/exclude filter" : tools);

      const mcpList = hermesOutput(hermes, profile.name, ["mcp", "list"]);
      const toolList = hermesOutput(hermes, profile.name, ["tools", "list"]);
      check("hermes", `${prefix} native MCP registry`, Boolean(mcpList && /camofox-mcp[\s\S]*enabled/.test(mcpList)), "hermes mcp list");
      check("hermes", `${prefix} native tool registry`, Boolean(toolList && /camofox-mcp\s+all tools enabled/.test(toolList)), "hermes tools list");
    }
    for (const profile of isolatedHermesProfiles(hermes)) {
      const entry = hermesGet(hermes, profile.name, "mcp_servers.camofox-mcp");
      check("hermes", `${profile.name} private profile`, entry === null, "no general browser MCP");
    }
    const hooks = hermesOutput(hermes, "default", ["hooks", "list"]);
    check("hermes", "native hook registry readable", hooks !== null, "hermes hooks list (CamoFox declares no shell hook)");
  }
}

if (targets.includes("omp")) {
  for (const profile of ompProfiles()) {
    const file = path.join(profile.directory, "mcp.json");
    const entry = readJson(file, {}).mcpServers?.camofox;
    if (!profile.ordinary) {
      check("omp", `${profile.name} isolated profile`, !entry, "no general browser MCP");
      continue;
    }
    check("omp", `${profile.name} MCP entry`, Boolean(entry), file);
    check("omp", `${profile.name} MCP command`, Boolean(entry?.command && bun && sameExecutable(entry.command, bun)), entry?.command || "missing");
    check("omp", `${profile.name} MCP entrypoint`, path.resolve(entry?.args?.[0] || "") === serverEntry, entry?.args?.[0] || "missing");
    check("omp", `${profile.name} browser URL`, Boolean(entry?.env?.CAMOFOX_URL && /^https?:\/\//.test(entry.env.CAMOFOX_URL)), entry?.env?.CAMOFOX_URL || "missing");
    check("omp", `${profile.name} enabled`, entry?.enabled !== false, `enabled=${entry?.enabled ?? "implicit"}`);
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ ok: checks.every((item) => item.pass), checks }, null, 2));
} else {
  for (const item of checks) {
    console.log(`${item.pass ? "PASS" : "FAIL"}  ${item.target.padEnd(7)} ${item.name} — ${item.detail}`);
  }
  console.log(`\n${checks.filter((item) => item.pass).length}/${checks.length} checks passed; no browser or model request was made.`);
}
if (checks.some((item) => !item.pass)) process.exitCode = 1;
