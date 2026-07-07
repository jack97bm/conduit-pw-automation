# Writeup

## What I chose and why

**App:** [`TonyMckes/conduit-realworld-example-app`](https://github.com/TonyMckes/conduit-realworld-example-app)
— a maintained RealWorld/Conduit implementation (Express 5 + Sequelize 6 + Postgres
backend, React 19 + Vite frontend, monorepo). I verified before building: the classic
gothinkster repos are effectively dead — the backend was silently rewritten to
Prisma/Nx in 2023 and the frontend repo is archived on a 2017 toolchain. A one-day
exercise shouldn't be spent on dependency archaeology.

**Feature for the agent:** favorite/unfavorite article — real logic (auth gate in the
controller, Sequelize many-to-many with idempotency questions, computed
`favoritesCount` vs per-user `favorited`), not CRUD boilerplate.

## The biggest trade-off I made

**Depth over breadth.** One feature threaded through everything — the agent reads it,
generates tests for it, the reviewed output is promoted into the suite, CI gates on
it, and the E2E exercises it through the UI. Three meaningful tests over ten shallow
ones; a monorepo app instead of separate FE/BE repos (explicitly permitted), with the
gating sketch still treating FE and BE as independently-shipping units.

## The single biggest threat to this suite's reliability

**Shared mutable state.** All tests hit one Postgres; parallel or repeated runs
colliding on users/articles is the classic way suites go flaky, get ignored, and die.
Handled: every test creates its own uniquely-suffixed data and never assumes seed
state — verified by running suites repeatedly against the same DB without cleanup.

The second threat is specific to this exercise: **agent-generated tests drifting
toward plausible-but-worthless.** Handled by the grounding pipeline (verbatim source
citations, mechanically checked) plus a human promotion gate — and honestly bounded:
the citation check proves citations are *real*, not *relevant*. Evidence the gate has
value: the agent honestly under-asserted (`>= 400`) on bad-token scenarios because it
wasn't fed the error handler; review with repo-wide context tightened both to the
actual behavior (**500** — itself a product observation worth raising: bad credentials
arguably should be 401).

Evidence the tests themselves have value: breaking `favoriteToggler` on purpose failed
exactly the 4 tests that depend on persistence and none of the 4 error-path tests.

## What I'd build next with more time

1. **Wire the gating for real** — the `repository_dispatch` → commit-status loop in
   `docs/gating.md`, live on a fork pair.
2. **Agent v2: PR-diff mode** — read a PR's diff and propose only tests for affected
   behavior; that's what keeps the tester repo from becoming the merge-speed
   bottleneck as the app grows.
3. **Mutation-testing spot checks** — automate the "break it on purpose" experiment to
   prove assertions bite, run weekly, not per-PR.
4. **Failure-category dashboard** — product bug / infra flake / test bug over time;
   the metric that tells you the suite is (or isn't) staying trustworthy.
