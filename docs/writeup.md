# Writeup

## What I picked and why

I used [TonyMckes/conduit-realworld-example-app](https://github.com/TonyMckes/conduit-realworld-example-app). It's a RealWorld/Conduit app — Express + Sequelize + Postgres backend, React frontend, one monorepo.

My first choice was the original gothinkster RealWorld repos. I checked them before starting and they're basically dead. The backend got rewritten to Prisma/Nx in 2023. The frontend repo is archived and still on a 2017 build setup. I didn't want to burn the day fighting old dependencies, so I found this maintained fork instead. That check took 20 minutes and saved me hours.

For the agent I picked the favorite/unfavorite article feature. It has real logic — an auth gate, a many-to-many relation, a computed count vs a per-user flag, and a few error paths. A plain CRUD endpoint would've given the agent nothing interesting to find.

## Biggest trade-off

Depth over breadth. One feature runs through everything. The agent reads it, generates tests for it, the reviewed output sits in the suite, CI gates on it, and the E2E clicks through it in a browser. I could've covered more features with shallower tests. But the brief said smaller and sharper, and that's how I'd start at a real company anyway. Get one slice trustworthy first, then spread out.

One more trade-off to be upfront about: the app is a monorepo, not separate FE/BE repos. The assignment allows it. The gating sketch still treats frontend and backend as separate shipping units, but the dispatch wiring in `docs/gating.md` is written for the two-repo setup.

## Biggest threat to the suite's reliability

Shared mutable state. Every test hits one Postgres. Tests colliding over users and articles is how suites go flaky, get ignored, and die. So every test creates its own data with a unique per-run suffix and never assumes seed state. I ran the suites repeatedly against the same DB without cleanup to confirm this holds.

There's a second threat specific to this exercise: the agent writing tests that look right but check nothing. The grounding pipeline handles that. Every proposed scenario has to quote the actual source line it exercises, and a script verifies the quote exists before any code is generated. It's not bulletproof — a citation can be real but irrelevant. That's why nothing the agent writes enters the suite until I review it.

The review gate proved useful on the first run. The agent asserted `>= 400` on the bad-token cases because I hadn't given it the error handler file. I read that file myself — bad tokens actually return 500. That's arguably an app bug (should be 401), so I pinned the real behavior and left a comment flagging it.

I also tested the tests. Broke the controller on purpose, skipped the `addUser` call, and re-ran. Exactly the four persistence tests failed and the error-path ones kept passing. Then I reverted.

## What I'd build next

1. Wire the gating for real. The dispatch → commit status → branch protection loop is designed in `docs/gating.md`. I'd stand it up on a fork pair.
2. A PR-diff mode for the agent — read the diff, propose tests only for what changed. That's what keeps a central tester repo from becoming the merge bottleneck.
3. Automate the "break it on purpose" check as a scheduled mutation-testing job.
4. A simple failure dashboard split by category: product bug, infra flake, test bug. Flake rate by category over time tells you if the suite is staying trustworthy.
