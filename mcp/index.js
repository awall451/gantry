#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import os from "os";

const GANTRY_API = process.env.GANTRY_API || "http://localhost:3001";
const SERVICES_DIR = process.env.GANTRY_SERVICES_DIR || join(os.homedir(), "services");
mkdirSync(SERVICES_DIR, { recursive: true });

const HOSTNAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const REPO_URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)[A-Za-z0-9._:\/@~+-]+$/;
const DIR_NAME_RE = /^[A-Za-z0-9._-]+$/;

async function gantryFetch(path, options = {}) {
  const url = `${GANTRY_API}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

function execFile(file, args, opts = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(file, args, { encoding: "utf8", timeout: 120000, ...opts }).trim(),
    };
  } catch (e) {
    return { ok: false, output: e.stderr?.toString().trim() || e.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function matchesProject(containerName, projectName) {
  if (!containerName) return false;
  return (
    containerName === projectName ||
    containerName.startsWith(`${projectName}-`) ||
    containerName.startsWith(`${projectName}_`)
  );
}

function getUsedPorts() {
  const result = execFile("ss", ["-ltn"]);
  if (!result.ok) return [];
  const ports = new Set();
  for (const line of result.output.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    const local = cols[3];
    if (!local) continue;
    const m = local.match(/:(\d+)$/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

const server = new McpServer({
  name: "gantry",
  version: "1.0.0",
});

// ── Low-level: Route management ──────────────────────────────────────────

server.tool("list_routes", "List all Gantry proxy routes (auto-discovered and manual aliases)", {}, async () => {
  const { status, data } = await gantryFetch("/api/routes");
  if (status !== 200) return { content: [{ type: "text", text: `Error ${status}: ${JSON.stringify(data)}` }] };
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  "add_route_alias",
  "Add a short hostname alias for a container (e.g. 'timelog' → timelog.localhost). Caddy appends the configured base domain (default .localhost) — and the Tailscale domain too when that is enabled in Settings.",
  {
    container_name: z.string().describe("Full container name (e.g. timelog-vibed-frontend-1)"),
    hostname: z.string().describe("Short hostname, stored bare — Caddy appends the base domain (default .localhost)"),
    target_port: z.number().int().positive().describe("Port the container listens on"),
  },
  async ({ container_name, hostname, target_port }) => {
    if (!HOSTNAME_RE.test(hostname)) {
      return { content: [{ type: "text", text: `Invalid hostname: ${hostname}. Allowed: [a-z0-9-], up to 63 chars, must start alnum.` }] };
    }
    const { status, data } = await gantryFetch("/api/routes", {
      method: "POST",
      body: JSON.stringify({ container_name, hostname, target_port }),
    });
    if (status >= 400) return { content: [{ type: "text", text: `Error ${status}: ${JSON.stringify(data)}` }] };
    return { content: [{ type: "text", text: `Route created: ${hostname}.localhost → ${container_name}:${target_port}\n${JSON.stringify(data, null, 2)}` }] };
  }
);

server.tool(
  "remove_route",
  "Delete a Gantry route by ID",
  { route_id: z.number().int().positive().describe("Route ID from list_routes") },
  async ({ route_id }) => {
    const { status, data } = await gantryFetch(`/api/routes/${route_id}`, { method: "DELETE" });
    if (status >= 400) return { content: [{ type: "text", text: `Error ${status}: ${JSON.stringify(data)}` }] };
    return { content: [{ type: "text", text: `Route ${route_id} deleted.` }] };
  }
);

server.tool(
  "get_service_status",
  "Check if a service is reachable via Gantry proxy (by hostname) and directly (by port)",
  {
    hostname: z.string().describe("The .localhost hostname to probe (without .localhost suffix)"),
    direct_port: z.number().int().positive().optional().describe("Optional: also probe localhost:<port> directly"),
  },
  async ({ hostname, direct_port }) => {
    if (!HOSTNAME_RE.test(hostname)) {
      return { content: [{ type: "text", text: `Invalid hostname: ${hostname}` }] };
    }
    const lines = [];

    const proxy = execFile("curl", [
      "-sS", "-o", "/dev/null", "-w", "%{http_code}",
      "-H", `Host: ${hostname}.localhost`,
      "http://localhost/", "--max-time", "5",
    ]);
    lines.push(`Proxy (${hostname}.localhost): ${proxy.ok ? proxy.output : "unreachable — " + proxy.output}`);

    if (direct_port) {
      const direct = execFile("curl", [
        "-sS", "-o", "/dev/null", "-w", "%{http_code}",
        `http://localhost:${direct_port}/`, "--max-time", "5",
      ]);
      lines.push(`Direct (localhost:${direct_port}): ${direct.ok ? direct.output : "unreachable — " + direct.output}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Low-level: Port discovery ────────────────────────────────────────────

server.tool("list_ports_in_use", "Show all listening TCP ports on this host", {}, async () => {
  const ports = getUsedPorts();
  const known = { 80: "Caddy proxy", 2019: "Caddy admin", 3001: "Gantry backend", 3000: "timelog frontend", 8888: "timelog API", 9420: "token tracker", 8000: "uJournal" };
  const lines = ports.map((p) => `${p}${known[p] ? ` (${known[p]})` : ""}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
});

// ── High-level: Deploy ───────────────────────────────────────────────────

server.tool(
  "deploy_service",
  `Clone a repo into ${SERVICES_DIR}, run docker compose up, verify Gantry route, optionally add alias. Full deploy workflow.`,
  {
    repo_url: z.string().describe("Git clone URL (https, ssh, or git protocol)"),
    dir_name: z.string().optional().describe("Subdirectory name (defaults to repo name)"),
    alias: z.string().optional().describe("Optional short hostname alias"),
    alias_port: z.number().int().positive().optional().describe("Port for the alias (required if alias is set)"),
  },
  async ({ repo_url, dir_name, alias, alias_port }) => {
    const lines = [];

    if (!REPO_URL_RE.test(repo_url)) {
      return { content: [{ type: "text", text: `Invalid repo_url: ${repo_url}` }] };
    }
    if (dir_name && !DIR_NAME_RE.test(dir_name)) {
      return { content: [{ type: "text", text: `Invalid dir_name: ${dir_name}. Allowed: [A-Za-z0-9._-]` }] };
    }
    if (alias && !HOSTNAME_RE.test(alias)) {
      return { content: [{ type: "text", text: `Invalid alias: ${alias}` }] };
    }

    const repoName = dir_name || repo_url.replace(/\.git$/, "").split("/").pop();
    if (!DIR_NAME_RE.test(repoName)) {
      return { content: [{ type: "text", text: `Derived directory name invalid: ${repoName}` }] };
    }
    const serviceDir = resolve(SERVICES_DIR, repoName);

    if (existsSync(serviceDir)) {
      const pull = execFile("git", ["pull", "--ff-only"], { cwd: serviceDir });
      lines.push(pull.ok ? `Pulled latest in ${serviceDir}` : `Pull failed: ${pull.output}`);
      if (!pull.ok) return { content: [{ type: "text", text: lines.join("\n") }] };
    } else {
      const clone = execFile("git", ["clone", repo_url, serviceDir]);
      lines.push(clone.ok ? `Cloned to ${serviceDir}` : `Clone failed: ${clone.output}`);
      if (!clone.ok) return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    const up = execFile("docker", ["compose", "up", "--build", "-d"], { cwd: serviceDir, timeout: 300000 });
    lines.push(up.ok ? "docker compose up: success" : `compose up failed: ${up.output}`);
    if (!up.ok) return { content: [{ type: "text", text: lines.join("\n") }] };

    await sleep(3000);

    const { data: routes } = await gantryFetch("/api/routes");
    const matching = Array.isArray(routes) ? routes.filter((r) => matchesProject(r.container_name, repoName)) : [];
    lines.push(`Gantry routes found: ${matching.length}`);
    matching.forEach((r) => lines.push(`  ${r.hostname}.localhost → ${r.container_name}:${r.target_port}`));

    if (alias && alias_port) {
      const container = matching.length > 0 ? matching[0].container_name : `${repoName}-1`;
      const { status, data } = await gantryFetch("/api/routes", {
        method: "POST",
        body: JSON.stringify({ container_name: container, hostname: alias, target_port: alias_port }),
      });
      lines.push(status < 400 ? `Alias added: ${alias}.localhost` : `Alias failed: ${JSON.stringify(data)}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── High-level: Update ───────────────────────────────────────────────────

server.tool(
  "update_service",
  `Pull latest code and rebuild a service already deployed in ${SERVICES_DIR}/<name>`,
  {
    name: z.string().describe(`Directory name under ${SERVICES_DIR}/`),
    no_cache: z.boolean().optional().describe("Pass --no-cache to docker build (default false)"),
  },
  async ({ name, no_cache }) => {
    if (!DIR_NAME_RE.test(name)) {
      return { content: [{ type: "text", text: `Invalid name: ${name}. Allowed: [A-Za-z0-9._-]` }] };
    }
    const serviceDir = resolve(SERVICES_DIR, name);
    if (!serviceDir.startsWith(SERVICES_DIR + "/") && serviceDir !== SERVICES_DIR) {
      return { content: [{ type: "text", text: `Path escape blocked: ${serviceDir}` }] };
    }
    if (!existsSync(serviceDir)) {
      return { content: [{ type: "text", text: `Not found: ${serviceDir}` }] };
    }

    const lines = [];

    const pull = execFile("git", ["pull", "--ff-only"], { cwd: serviceDir });
    lines.push(pull.ok ? `git pull: ${pull.output}` : `git pull failed: ${pull.output}`);
    if (!pull.ok) return { content: [{ type: "text", text: lines.join("\n") }] };

    let up;
    if (no_cache) {
      const build = execFile("docker", ["compose", "build", "--no-cache"], { cwd: serviceDir, timeout: 300000 });
      if (!build.ok) {
        lines.push(`Rebuild failed: ${build.output}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      up = execFile("docker", ["compose", "up", "-d"], { cwd: serviceDir, timeout: 300000 });
    } else {
      up = execFile("docker", ["compose", "up", "--build", "-d"], { cwd: serviceDir, timeout: 300000 });
    }
    lines.push(up.ok ? "Rebuild + restart: success" : `Rebuild failed: ${up.output}`);

    if (up.ok) {
      await sleep(3000);
      const check = execFile("docker", ["compose", "ps", "--format", "json"], { cwd: serviceDir });
      if (check.ok) {
        const running = check.output
          .split("\n")
          .filter(Boolean)
          .map((line) => { try { return JSON.parse(line); } catch { return null; } })
          .filter((c) => c && c.State === "running")
          .length;
        lines.push(`Containers running: ${running}`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── High-level: Remove ───────────────────────────────────────────────────

server.tool(
  "remove_service",
  `Stop a service (docker compose down) and optionally remove its Gantry routes. Looks under ${SERVICES_DIR}/<name>.`,
  {
    name: z.string().describe(`Directory name under ${SERVICES_DIR}/`),
    remove_routes: z.boolean().optional().describe("Also delete routes from Gantry (default true)"),
  },
  async ({ name, remove_routes = true }) => {
    if (!DIR_NAME_RE.test(name)) {
      return { content: [{ type: "text", text: `Invalid name: ${name}. Allowed: [A-Za-z0-9._-]` }] };
    }
    const serviceDir = resolve(SERVICES_DIR, name);
    if (!serviceDir.startsWith(SERVICES_DIR + "/") && serviceDir !== SERVICES_DIR) {
      return { content: [{ type: "text", text: `Path escape blocked: ${serviceDir}` }] };
    }
    if (!existsSync(serviceDir)) {
      return { content: [{ type: "text", text: `Not found: ${serviceDir}` }] };
    }

    const lines = [];

    const down = execFile("docker", ["compose", "down"], { cwd: serviceDir });
    lines.push(down.ok ? "docker compose down: success" : `compose down failed: ${down.output}`);

    if (remove_routes) {
      const { data: routes } = await gantryFetch("/api/routes");
      const matching = Array.isArray(routes) ? routes.filter((r) => matchesProject(r.container_name, name)) : [];
      for (const route of matching) {
        await gantryFetch(`/api/routes/${route.id}`, { method: "DELETE" });
        lines.push(`Deleted route: ${route.hostname} (id ${route.id})`);
      }
      if (matching.length === 0) lines.push("No matching routes to clean up.");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── High-level: List services ────────────────────────────────────────────

server.tool("list_services", `List all services deployed in ${SERVICES_DIR}/ with their container status`, {}, async () => {
  const result = execFile("find", [
    SERVICES_DIR, "-maxdepth", "2",
    "(", "-name", "docker-compose.yml", "-o", "-name", "compose.yml", ")",
  ]);
  if (!result.ok || !result.output) return { content: [{ type: "text", text: "No compose files found." }] };

  const lines = [];
  const dirs = [...new Set(result.output.split("\n").map((f) => f.replace(/\/[^/]+$/, "")))];

  for (const dir of dirs) {
    const name = dir.split("/").pop();
    const ps = execFile("docker", ["compose", "ps", "--format", "{{.Name}} {{.State}}"], { cwd: dir });
    if (ps.ok && ps.output) {
      lines.push(`${name}:`);
      ps.output.split("\n").forEach((l) => lines.push(`  ${l}`));
    } else {
      lines.push(`${name}: (not running)`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
});

// ── Start ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
