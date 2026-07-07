/**
 * Mechanical guardrails for the test-writing agent. No LLM calls here — that's
 * the point: these checks convert "trust the model" into "verify a string match".
 *
 * Three checks, deliberately simple (regex/string-level, not AST):
 *   1. Citation check   — every scenario's quoted snippet must literally appear
 *                         in the real source file it claims to cite.
 *   2. Target check     — generated code must hit the real route paths.
 *   3. Assertion check  — every it() block must contain a real expect() on a
 *                         captured value; vacuous expect(true) patterns fail.
 *
 * Known limit (documented, not hidden): these checks prove citations are REAL,
 * not that they're RELEVANT. The backstop is the human review gate — nothing
 * enters the suite until reviewed and promoted by the automation engineer.
 */

interface Scenario {
  id: string;
  description: string;
  citation: { file: string; snippet: string };
  expected: string;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** Check 1: citations must exist verbatim (whitespace-normalized) in the real source. */
export function verifyCitations(
  scenarios: Scenario[],
  sources: { file: string; content: string }[],
): { approved: Scenario[]; rejected: { scenario: Scenario; reason: string }[] } {
  const approved: Scenario[] = [];
  const rejected: { scenario: Scenario; reason: string }[] = [];

  for (const scenario of scenarios) {
    const source = sources.find((s) => s.file === scenario.citation?.file);
    if (!source) {
      rejected.push({ scenario, reason: `cites unknown file: ${scenario.citation?.file}` });
      continue;
    }
    if (!scenario.citation.snippet || scenario.citation.snippet.length < 8) {
      rejected.push({ scenario, reason: "citation snippet missing or too short to be meaningful" });
      continue;
    }
    if (!normalize(source.content).includes(normalize(scenario.citation.snippet))) {
      rejected.push({ scenario, reason: "citation snippet not found in cited file (hallucinated?)" });
      continue;
    }
    approved.push(scenario);
  }
  return { approved, rejected };
}

/** Checks 2 + 3 on the generated test code. Returns a list of failures (empty = pass). */
export function verifyGeneratedCode(code: string): string[] {
  const issues: string[] = [];

  // Check 2 — real endpoints, not invented ones.
  if (!/\/favorite/.test(code)) {
    issues.push("code never targets the /articles/:slug/favorite route");
  }
  if (!/\/users/.test(code)) {
    issues.push("code never registers its own user (must not depend on seed data)");
  }

  // Check 3 — every it()/test() block contains a non-vacuous expect().
  const blocks = code.split(/\b(?:it|test)\s*\(/).slice(1);
  if (blocks.length === 0) issues.push("no it()/test() blocks found");
  blocks.forEach((block, i) => {
    // Take text up to the next it()/test() split — approximate block body.
    if (!/expect\s*\(/.test(block)) {
      issues.push(`test block #${i + 1} contains no expect() at all`);
    }
    if (/expect\s*\(\s*(true|1|"[^"]*")\s*\)\s*\.\s*toBe(?:Truthy)?\s*\(/.test(block)) {
      issues.push(`test block #${i + 1} contains a vacuous assertion (expect(true)-style)`);
    }
  });

  return issues;
}
