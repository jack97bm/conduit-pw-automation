# How this repo was built with Claude

Per the assignment ("avoid writing manual code wherever possible; use Claude or Codex
to complete the implementation"), this repo was built AI-first, with review-and-refine
instead of manual rewriting. This file is the audit trail.

## Tooling

- **Claude Code CLI** (v2.1.202), model `claude-fable-5`, both interactively (building
  the repo) and headless (`claude -p --output-format json`) inside the test-writing
  agent itself.
- Git commits carry `Co-Authored-By: Claude` trailers — the log shows which changes
  were AI-driven (all of them).

## What Claude generated vs. what was human judgment

| Artifact | Claude generated | Human review added |
|---|---|---|
| `agent/generate-tests.ts` + `verify-grounding.ts` | Full implementation | Design decisions: two-phase pipeline, mechanical (non-LLM) guardrails, citation-as-string-match |
| `tests/api/favorite-article.spec.ts` | Entirely — by the agent in this repo (raw output preserved in `agent/output/`) | Tightened bad-token assertions `>=400` → `toBe(500)` after reading `errorHandler.js` (a file the agent wasn't fed); flagged 500-on-bad-credentials as a product observation |
| `tests/api/auth.spec.ts`, `tests/e2e/favorite-flow.spec.ts` | Full implementation | E2E fix after first run: app uses hash routing (`/#/login`), diagnosed from Playwright's error-context snapshot |
| `.github/workflows/ci.yml` | Full implementation | Seed-after-boot ordering (the app's migrations are stale; schema comes from `sequelize.sync` at startup — found by hitting the failure locally first) |
| `docs/` | Drafted | Positions taken (blocking API gate, E2E on merge not PR, pinned APP_SHA) are mine |

## Verification of every module

Everything generated was executed, not just read: the API suite ran against the live
app (11/11), the E2E ran headed and headless (hash-routing bug found and fixed), the
agent pipeline ran end-to-end (8/8 generated tests passed), and the suite was
validated by intentionally breaking the feature and confirming exactly the dependent
tests failed.
