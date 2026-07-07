# nenu-tester

Central tester repo for the [Conduit RealWorld app](https://github.com/TonyMckes/conduit-realworld-example-app)
(React frontend + Express/Sequelize backend) — built for the Nenu Automation Engineer
practical exercise.

**The one-paragraph story:** a test-writing agent ([`agent/`](agent/)) reads the real
source of the app's favorite-article feature and generates grounded test cases; its
output was mechanically guardrail-checked, human-reviewed, and promoted into the suite
([`tests/api/favorite-article.spec.ts`](tests/api/favorite-article.spec.ts)); CI runs
the whole suite against a pinned app version; and [`docs/gating.md`](docs/gating.md)
shows how FE/BE PRs would be gated by this repo without killing merge speed.

| Deliverable | Where |
|---|---|
| Tests (2 API suites + 1 Playwright E2E) | [`tests/`](tests/) |
| CI (green) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) → Actions tab |
| Gating sketch | [`docs/gating.md`](docs/gating.md) |
| **Test-writing agent (Task 2)** | [`agent/`](agent/) — code, README, and real generated output |
| Writeup | [`docs/writeup.md`](docs/writeup.md) |
| AI workflow audit trail | [`CLAUDE.md`](CLAUDE.md) |

## Running locally

Prerequisites: Node 20+, PostgreSQL running locally.

```bash
# 1. The app (separate checkout, pinned SHA — same one CI uses)
git clone https://github.com/TonyMckes/conduit-realworld-example-app.git app
cd app && git checkout 5e127d8569b300e0a21dc2c20ea680da4967b1aa
cp backend/.env.example .env            # then: set DEV_DB_DIALECT=postgres + your creds
cp .env backend/.env                    # dotenv resolves from cwd; both locations needed
npm install
npm run sqlz -- db:create
npm run dev &                           # backend :3001 + frontend :3000
# wait until healthy, then seed — schema is built by sequelize.sync at boot,
# the checked-in migrations are stale (see BUILD notes in docs/writeup.md):
npm run sqlz -- db:seed:all

# 2. This repo
npm ci
npx playwright install chromium
npm run test:api                        # Vitest against :3001
npm run test:e2e                        # Playwright against :3000

# 3. The agent (Task 2) — requires the Claude Code CLI
npm run agent:generate                  # reads feature source → grounded scenarios → test file
npm run agent:run-generated             # execute the generated suite against the live app
```

## Test inventory

| Test | Level | What it proves |
|---|---|---|
| `tests/api/auth.spec.ts` | API | Register → login → the JWT actually works (`GET /user` round-trip); wrong password rejected |
| `tests/api/favorite-article.spec.ts` | API | 8 scenarios: favorite/unfavorite state + counts, double-favorite idempotency, 401 no-auth, 404 unknown slug, bad-token paths (pinned to actual 500 behavior — see file header), multi-user count semantics. **Agent-generated, human-reviewed** |
| `tests/e2e/favorite-flow.spec.ts` | E2E | Real UI login → favorite from the feed → count + active state render → survives reload (state persisted server-side) |

Every test creates its own uniquely-suffixed data — no seed dependence, safe under
parallelism and repeated runs.
