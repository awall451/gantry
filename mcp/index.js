#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const GANTRY_API = "http://localhost:3001";
const SERVICES_DIR = "/home/carl/services";

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

function exec(cmd, opts = {}) {
  try {
    return {
      ok: true,
      output: execSync(cmd, { encoding: "utf8", timeout: 120000, ...opts }).trim(),
    };
  } catch (e) {
    return { ok: false, output: e.stderr?.trim() || e.message };
  }
}

function getUsedPorts() {
  const result = exec("ss -ltn | awk 'NR>1 {print $4}' | grep -oP '\\d+$' | sort -un");
  if (!result.ok) return [];
  return result.output.split("\n").map(Number).filter(Boolean);
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
  "Add a short hostname alias for a container (e.g. 'timelog' → timelog.localhost)",
  {
    container_name: z.string().describe("Full container name (e.g. timelog-vibed-frontend-1)"),
    hostname: z.string().describe("Short hostname, stored bare — Caddy appends .localhost"),
    target_port: z.number().describe("Port the container listens on"),
  },
  async ({ container_name, hostname, target_port }) => {
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
  { route_id: z.number().describe("Route ID from list_routes") },
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
    direct_port: z.number().optional().describe("Optional: also probe localhost:<port> directly"),
  },
  async ({ hostname, direct_port }) => {
    const lines = [];

    const proxy = exec(`curl -sS -o /dev/null -w "%{http_code}" -H "Host: ${hostname}.localhost" http://localhost/ --max-time 5`);
    lines.push(`Proxy (${hostname}.localhost): ${proxy.ok ? proxy.output : "unreachable — " + proxy.output}`);

    if (direct_port) {
      const direct = exec(`curl -sS -o /dev/null -w "%{http_code}" http://localhost:${direct_port}/ --max-time 5`);
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
  "Clone a repo into /home/carl/services, run docker compose up, verify Gantry route, optionally add alias. Full deploy workflow.",
  {
    repo_url: z.string().describe("Git clone URL"),
    dir_name: z.string().optional().describe("Subdirectory name (defaults to repo name)"),
    alias: z.string().optional().describe("Optional short hostname alias"),
    alias_port: z.number().optional().describe("Port for the alias (required if alias is set)"),
  },
  async ({ repo_url, dir_name, alias, alias_port }) => {
    const lines = [];

    // Derive directory name from repo URL
    const repoName = dir_name || repo_url.replace(/\.git$/, "").split("/").pop();
    const serviceDir = resolve(SERVICES_DIR, repoName);

    // Clone or pull
    if (existsSync(serviceDir)) {
      const pull = exec("git pull --ff-only", { cwd: serviceDir });
      lines.push(pull.ok ? `Pulled latest in ${serviceDir}` : `Pull failed: ${pull.output}`);
      if (!pull.ok) return { content: [{ type: "text", text: lines.join("\n") }] };
    } else {
      const clone = exec(`git clone ${repo_url} ${serviceDir}`);
      lines.push(clone.ok ? `Cloned to ${serviceDir}` : `Clone failed: ${clone.output}`);
      if (!clone.ok) return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    // Compose up
    const up = exec("docker compose up --build -d", { cwd: serviceDir, timeout: 300000 });
    lines.push(up.ok ? "docker compose up: success" : `compose up failed: ${up.output}`);
    if (!up.ok) return { content: [{ type: "text", text: lines.join("\n") }] };

    // Wait for Gantry to detect
    exec("sleep 3");

    // Check routes
    const { data: routes } = await gantryFetch("/api/routes");
    const matching = Array.isArray(routes) ? routes.filter((r) => r.container_name?.includes(repoName)) : [];
    lines.push(`Gantry routes found: ${matching.length}`);
    matching.forEach((r) => lines.push(`  ${r.hostname}.localhost → ${r.container_name}:${r.target_port}`));

    // Add alias if requested
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
  "Pull latest code and rebuild a service already deployed in /home/carl/services/<name>",
  {
    name: z.string().describe("Directory name under /home/carl/services/"),
    no_cache: z.boolean().optional().describe("Pass --no-cache to docker build (default false)"),
  },
  async ({ name, no_cache }) => {
    const serviceDir = resolve(SERVICES_DIR, name);
    if (!existsSync(serviceDir)) {
      return { content: [{ type: "text", text: `Not found: ${serviceDir}` }] };
    }

    const lines = [];

    const pull = exec("git pull --ff-only", { cwd: serviceDir });
    lines.push(pull.ok ? `git pull: ${pull.output}` : `git pull failed: ${pull.output}`);
    if (!pull.ok) return { content: [{ type: "text", text: lines.join("\n") }] };

    const buildCmd = no_cache ? "docker compose build --no-cache && docker compose up -d" : "docker compose up --build -d";
    const up = exec(buildCmd, { cwd: serviceDir, timeout: 300000 });
    lines.push(up.ok ? "Rebuild + restart: success" : `Rebuild failed: ${up.output}`);

    // Verify
    if (up.ok) {
      exec("sleep 3");
      const check = exec(`docker compose ps --format json`, { cwd: serviceDir });
      if (check.ok) {
        const running = check.output.split("\n").filter(Boolean).length;
        lines.push(`Containers running: ${running}`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── High-level: Remove ───────────────────────────────────────────────────

server.tool(
  "remove_service",
  "Stop a service (docker compose down) and optionally remove its Gantry routes",
  {
    name: z.string().describe("Directory name under /home/carl/services/"),
    remove_routes: z.boolean().optional().describe("Also delete routes from Gantry (default true)"),
  },
  async ({ name, remove_routes = true }) => {
    const serviceDir = resolve(SERVICES_DIR, name);
    if (!existsSync(serviceDir)) {
      return { content: [{ type: "text", text: `Not found: ${serviceDir}` }] };
    }

    const lines = [];

    const down = exec("docker compose down", { cwd: serviceDir });
    lines.push(down.ok ? "docker compose down: success" : `compose down failed: ${down.output}`);

    if (remove_routes) {
      const { data: routes } = await gantryFetch("/api/routes");
      const matching = Array.isArray(routes) ? routes.filter((r) => r.container_name?.includes(name)) : [];
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

server.tool("list_services", "List all services deployed in /home/carl/services/ with their container status", {}, async () => {
  const result = exec(`find ${SERVICES_DIR} -maxdepth 2 -name "docker-compose.yml" -o -name "compose.yml" 2>/dev/null`);
  if (!result.ok || !result.output) return { content: [{ type: "text", text: "No compose files found." }] };

  const lines = [];
  const dirs = [...new Set(result.output.split("\n").map((f) => f.replace(/\/[^/]+$/, "")))];

  for (const dir of dirs) {
    const name = dir.split("/").pop();
    const ps = exec("docker compose ps --format '{{.Name}} {{.State}}'", { cwd: dir });
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
