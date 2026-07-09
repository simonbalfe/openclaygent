#!/usr/bin/env bun
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ENV = join(ROOT, ".env");
const ENV_EXAMPLE = join(ROOT, ".env.example");

type KeySpec = {
  name: string;
  label: string;
  required: boolean;
  hint: string;
  link?: string;
};

const KEYS: KeySpec[] = [
  {
    name: "OPENROUTER_API_KEY",
    label: "OpenRouter API key",
    required: true,
    hint: "The one required key — it drives every model (DeepSeek by default, cheap).",
    link: "https://openrouter.ai/keys",
  },
  {
    name: "EXA_API_KEY",
    label: "Exa API key",
    required: false,
    hint: "Optional. Paid search fallback, and lets you run with no Docker at all.",
    link: "https://dashboard.exa.ai/api-keys",
  },
  {
    name: "TAVILY_API_KEY",
    label: "Tavily API key",
    required: false,
    hint: "Optional. Last-resort search rung + live page-fetch fallback.",
    link: "https://app.tavily.com/home",
  },
  {
    name: "APIFY_API_TOKEN",
    label: "Apify API token",
    required: false,
    hint: "Optional. Enables the linkedin_* tools and the Crunchbase fallback.",
    link: "https://console.apify.com/account/integrations",
  },
];

function has(cmd: string): boolean {
  return Bun.spawnSync(["sh", "-c", `command -v ${cmd}`]).exitCode === 0;
}

function run(cmd: string[]): number {
  return Bun.spawnSync(cmd, { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1;
}

function mask(value: string): string {
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function looksPlaceholder(value: string): boolean {
  return value === "" || value.endsWith("...") || value.endsWith("-...");
}

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV)) return map;
  for (const line of readFileSync(ENV, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match?.[1]) map.set(match[1], match[2] ?? "");
  }
  return map;
}

function upsertEnv(updates: Map<string, string>): void {
  const lines = existsSync(ENV) ? readFileSync(ENV, "utf8").split("\n") : [];
  const remaining = new Map(updates);
  const out = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    const key = match?.[1];
    if (key && remaining.has(key)) {
      const value = remaining.get(key) ?? "";
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of remaining) out.push(`${key}=${value}`);
  writeFileSync(ENV, out.join("\n"));
}

function ask(spec: KeySpec, current: string): string {
  const configured = current !== "" && !looksPlaceholder(current);
  console.log(`\n${spec.label}${spec.required ? " (required)" : " (optional)"}`);
  console.log(`  ${spec.hint}`);
  if (spec.link) console.log(`  Get one: ${spec.link}`);
  const suffix = configured ? ` [keep ${mask(current)}]` : spec.required ? "" : " [Enter to skip]";
  const answer = prompt(`  ${spec.name}=${suffix}`);
  if (answer === null || answer.trim() === "") return configured ? current : "";
  return answer.trim();
}

function main(): void {
  console.log("openclaygent setup\n──────────────────");

  if (!has("bun")) {
    console.log("Bun is required. Install it: https://bun.sh");
    process.exit(1);
  }

  const dockerOk = has("docker");
  if (!dockerOk) {
    console.log(
      "\nDocker not found. The free self-hosted stack (SearXNG + patchright) needs it.",
    );
    console.log("You can still run with an Exa key and zero infra — install Docker later for free search.");
  }

  console.log("\nInstalling dependencies…");
  if (run(["bun", "install"]) !== 0) {
    console.log("bun install failed. Fix the error above and re-run `bun run setup`.");
    process.exit(1);
  }

  if (!existsSync(ENV)) {
    copyFileSync(ENV_EXAMPLE, ENV);
    console.log("\nCreated .env from .env.example.");
  }

  if (!process.stdin.isTTY) {
    console.log("\nNon-interactive shell — skipping key prompts. Edit .env by hand.");
    process.exit(0);
  }

  console.log("\nEnter your keys. The service URLs (SearXNG, patchright) are automatic — nothing to set.");
  const current = readEnv();
  const updates = new Map<string, string>();
  for (const spec of KEYS) {
    const value = ask(spec, current.get(spec.name) ?? "");
    if (value !== "" && value !== current.get(spec.name)) updates.set(spec.name, value);
  }

  const openrouter = updates.get("OPENROUTER_API_KEY") ?? current.get("OPENROUTER_API_KEY") ?? "";
  if (looksPlaceholder(openrouter)) {
    console.log("\nWarning: OPENROUTER_API_KEY is still unset. Runs will fail until you add it to .env.");
  }

  if (updates.size > 0) {
    upsertEnv(updates);
    console.log(`\nSaved ${updates.size} key(s) to .env.`);
  } else {
    console.log("\nNo key changes.");
  }

  let stackUp = false;
  if (dockerOk) {
    const start = prompt(
      "\nStart everything now — free search + fetch stack AND the API server (docker compose up -d)? [Y/n]",
    );
    if (start === null || start.trim().toLowerCase() !== "n") {
      stackUp = run(["docker", "compose", "up", "-d", "--build"]) === 0;
    }
  }

  console.log("\nDone.");
  if (stackUp) {
    console.log("  API is live:  http://localhost:8080/docs   (POST http://localhost:8080/run)");
    console.log("  CLI:          bun run cli -- --help");
  } else {
    console.log("  Start it all:  docker compose up -d       # free stack + API on :8080");
    console.log("  CLI:           bun run cli -- --help");
    console.log("  API only:      bun run api                # http://localhost:8080/docs");
  }
}

main();
