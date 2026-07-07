/**
 * Test-writing agent — reads a real feature from the app and generates test
 * cases for it, grounded in the actual source code.
 *
 * Pipeline (two phases, deliberately NOT one-shot):
 *   Phase A  — Claude reads the feature source and returns a scenario PLAN as
 *              JSON. Every scenario must cite a verbatim snippet of the source
 *              it exercises ("grounding citation"). No code is generated yet.
 *   Gate     — verify-grounding.ts mechanically checks every citation exists
 *              in the real source. Hallucinated scenarios are rejected here,
 *              where they cost one JSON entry — not a debugging session.
 *   Phase B  — only the approved scenarios go back to Claude, which generates
 *              one runnable Vitest test file. The same gate then checks the
 *              code (real endpoints, real assertions).
 *
 * LLM: local Claude Code CLI in headless mode (`claude -p`). Model recorded
 * in the transcript saved to agent/output/.
 *
 * Usage:  APP_DIR=../app tsx agent/generate-tests.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCitations, verifyGeneratedCode } from "./verify-grounding.ts";

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(here, process.env.APP_DIR ?? "../../app");
const OUT_DIR = join(here, "output");
const API_URL = process.env.API_URL ?? "http://localhost:3001/api";

/** The feature under test: favorite/unfavorite article. Real source, not summaries. */
const FEATURE_FILES = [
  "backend/routes/articles/favorites.js",
  "backend/controllers/favorites.js",
  "backend/middleware/authentication.js",
  "backend/helper/helpers.js",
];

interface Scenario {
  id: string;
  description: string;
  citation: { file: string; snippet: string };
  expected: string;
}

function readFeatureSources(): { file: string; content: string }[] {
  return FEATURE_FILES.map((file) => ({
    file,
    content: readFileSync(join(APP_DIR, file), "utf8"),
  }));
}

/** Call Claude Code headless; save the full raw transcript for the evidence trail. */
function askClaude(prompt: string, transcriptName: string): string {
  const raw = execFileSync("claude", ["-p", prompt, "--output-format", "json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 600_000,
  });
  writeFileSync(join(OUT_DIR, transcriptName), raw);
  const parsed = JSON.parse(raw);
  return parsed.result ?? "";
}

/** Extract the first JSON array / fenced code block from a model reply. */
function extractBlock(text: string, kind: "json" | "code"): string {
  const fence = kind === "json" ? /```json\s*([\s\S]*?)```/ : /```(?:ts|typescript|js|javascript)\s*([\s\S]*?)```/;
  const m = text.match(fence);
  if (m) return m[1].trim();
  if (kind === "json") {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end > start) return text.slice(start, end + 1);
  }
  throw new Error(`Could not extract ${kind} block from model reply`);
}

function phaseA(sources: { file: string; content: string }[]): Scenario[] {
  const sourceBlock = sources
    .map((s) => `--- FILE: ${s.file} ---\n${s.content}`)
    .join("\n\n");

  const prompt = `You are a senior test engineer. Below is the REAL source code of the
"favorite/unfavorite article" feature of a RealWorld/Conduit app (Express 5 + Sequelize 6).

${sourceBlock}

Produce a test scenario PLAN — no test code yet. Return a JSON array of 5-8 scenarios.
Each scenario object must have exactly these fields:
  "id": short kebab-case slug
  "description": one sentence, what the test does
  "citation": { "file": <one of the file paths above>, "snippet": <a VERBATIM line or short excerpt copied character-for-character from that file that this scenario exercises> }
  "expected": concrete expected outcome (HTTP status and/or response fields and/or state change)

Hard rules:
- Do NOT invent behavior that is not present in this code. If auth, validation, or error
  handling is absent from the code, do not fabricate a scenario claiming it exists.
- Citations must be copied verbatim — they will be checked mechanically against the files.
- The API base is ${API_URL}; articles are favorited via POST /articles/:slug/favorite and
  unfavorited via DELETE /articles/:slug/favorite.
- Prefer scenarios that verify real business behavior (state changes, counts, auth gates,
  error paths) over trivial shape checks.

Reply with ONLY the JSON array inside a \`\`\`json fence.`;

  const reply = askClaude(prompt, "transcript-phaseA.json");
  const scenarios: Scenario[] = JSON.parse(extractBlock(reply, "json"));
  writeFileSync(join(OUT_DIR, "scenarios.json"), JSON.stringify(scenarios, null, 2));
  return scenarios;
}

function phaseB(approved: Scenario[], sources: { file: string; content: string }[]): string {
  const controller = sources.find((s) => s.file.endsWith("controllers/favorites.js"))!;
  const prompt = `You are a senior test engineer. Generate ONE runnable Vitest test file
(TypeScript, ESM, using global fetch — no supertest) that implements EXACTLY these approved
test scenarios against a live API at \${process.env.API_URL ?? "${API_URL}"}:

${JSON.stringify(approved, null, 2)}

Controller source for reference (do not test behavior beyond it):
--- FILE: ${controller.file} ---
${controller.content}

Hard rules:
- Import { describe, it, expect, beforeAll } from "vitest". No other test deps.
- The suite must create its OWN user via POST /users (unique email/username per run, e.g.
  a timestamp suffix) and its OWN article via POST /articles — never assume seed data.
- Auth header format is: Authorization: Token <jwt>.
- One it() per scenario, each annotated with a comment: // scenario: <id>
- Every it() must assert on real response values (status, favorited, favoritesCount, error
  body). Never expect(true) or assertion-free tests.
- Clean, deterministic, independent of execution order within the file.

Reply with ONLY the test file content inside a \`\`\`ts fence.`;

  const reply = askClaude(prompt, "transcript-phaseB.json");
  return extractBlock(reply, "code");
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sources = readFeatureSources();

  console.log("Phase A — scenario plan (grounded, no code)...");
  const scenarios = phaseA(sources);
  console.log(`  ${scenarios.length} scenarios proposed`);

  const { approved, rejected } = verifyCitations(scenarios, sources);
  console.log(`  guardrail: ${approved.length} approved, ${rejected.length} rejected`);
  writeFileSync(
    join(OUT_DIR, "grounding-report.json"),
    JSON.stringify({ approved, rejected }, null, 2),
  );
  if (approved.length === 0) throw new Error("No grounded scenarios survived — aborting.");

  console.log("Phase B — generating test code from approved scenarios...");
  const code = phaseB(approved, sources);

  const codeIssues = verifyGeneratedCode(code);
  if (codeIssues.length > 0) {
    console.error("Generated code failed guardrails:\n" + codeIssues.map((i) => `  ✗ ${i}`).join("\n"));
    writeFileSync(join(OUT_DIR, "generated.favorites.spec.ts.REJECTED"), code);
    process.exit(1);
  }

  writeFileSync(join(OUT_DIR, "generated.favorites.spec.ts"), code);
  console.log("✓ Generated test written to agent/output/generated.favorites.spec.ts");
  console.log("  Run it:  npm run agent:run-generated   (app must be up)");
}

main();
