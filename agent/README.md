# Test-Writing Agent

Reads a real feature from the app and generates test cases grounded in the actual
source code. Built for the favorites feature of the Conduit RealWorld app, but the
pipeline is feature-agnostic — point `FEATURE_FILES` at different source files.

## Model / tooling

- **LLM:** Claude via the local **Claude Code CLI in headless mode**
  (`claude -p "<prompt>" --output-format json`). Model used on the recorded run:
  `claude-fable-5` (with `claude-haiku-4-5` handling internal routing) — see the
  raw transcripts in `output/transcript-phaseA.json` / `transcript-phaseB.json`.
- **No SDK / no API key needed** — the agent shells out to the CLI, which is also
  how it would slot into a developer's existing Claude Code workflow.
- **Test framework of the generated output:** Vitest + global `fetch` against the
  live API (`API_URL`, default `http://localhost:3001/api`).

## How to run

```bash
# Prerequisite: the app is running (backend on :3001) — see repo README.
npm run agent:generate       # Phase A → guardrail → Phase B → guardrail
npm run agent:run-generated  # execute the generated suite against the live app
```

Everything the run produces is written to `output/` and checked in:

| File | What it is |
|---|---|
| `scenarios.json` | Phase A scenario plan, each with a grounding citation |
| `grounding-report.json` | Guardrail verdict: approved vs rejected scenarios, with reasons |
| `generated.favorites.spec.ts` | The generated, guardrail-passing test file |
| `execution-transcript.txt` | Real execution output (close-the-loop proof) |
| `transcript-phaseA.json` / `transcript-phaseB.json` | Raw Claude CLI transcripts |

## Design: why two phases instead of "write me tests for this file"

One-shot test generation is exactly how you get plausible-but-worthless output —
tests that look right, compile, and assert nothing the feature actually does.
The pipeline splits the problem:

1. **Phase A — scenario plan, no code.** Claude gets the *real source* of the
   feature (route, controller, auth middleware, helpers — file contents, not
   summaries) and must return a JSON plan. Every scenario carries a **verbatim
   citation**: the exact source line it exercises. The prompt forbids inventing
   behavior not present in the code.
2. **Mechanical gate (`verify-grounding.ts`).** No LLM here — that's the point.
   Three string-level checks:
   - **Citation check:** the quoted snippet must literally appear in the cited
     file. A scenario claiming "returns 422 on invalid slug" with no line to
     back it → rejected. Hallucination becomes a checkable string match.
   - **Target check:** generated code must hit the real route
     (`/articles/:slug/favorite`) and create its own users — no invented
     endpoints, no seed-data dependence.
   - **Assertion check:** every `it()` block needs a real `expect()` on a
     captured value; `expect(true)`-style vacuous assertions fail the gate.
3. **Phase B — code, only from approved scenarios.** Rejections at plan time
   cost one JSON entry; catching the same problem in generated code costs a
   debugging session. The plan is also the artifact a human reviewer signs off —
   the same workflow you'd run with a team.

## Recorded run (favorites feature)

- 8 scenarios proposed → **8 approved, 0 rejected** by the grounding gate.
- Generated suite covers: favorite success (+persistence re-read), unfavorite,
  double-favorite idempotency, 401 without auth, 404 on unknown slug, malformed
  auth header, invalid JWT, and multi-user count semantics (`favoritesCount` is
  global, `favorited` is per-requester).
- Execution: **8/8 passed in ~380ms** against the live app (`execution-transcript.txt`).

## Honest limits

- **The grounding check proves citations are real, not relevant.** A generator
  could cite a true-but-unrelated line. The backstop is the **human review
  gate**: nothing enters the actual suite until the automation engineer reviews
  and promotes it. `tests/api/favorite-article.spec.ts` is the *reviewed*
  version of this agent's raw output — the raw output stays here, and the diff
  between them is the review.
- The assertion check is regex-level, not AST-level — a deliberately simple
  ~40-line guardrail that is auditable at a glance. It can be gamed; it exists
  to catch the common failure mode (assertion-free or vacuous tests), not
  adversarial output.
- The agent sees the files I chose to feed it. If the feature's behavior lives
  partly in files outside `FEATURE_FILES` (e.g. the error-handler middleware
  mapping custom errors to status codes), scenario expectations can be
  under-specified. Feeding the whole repo would fix this at the cost of context
  noise — a real trade-off, resolved here by keeping the file list explicit and
  reviewable.
