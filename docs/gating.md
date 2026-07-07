# Gating sketch — how FE/BE PRs are gated by this tester repo

The scenario: frontend and backend ship to `main` many times a day. This repo is the
guardrail — without becoming the bottleneck that kills merge speed.

## The mechanism (concrete, adoptable today)

### 1. Trigger: the app repo asks for a verdict

Each FE/BE repo carries one thin workflow that fires on `pull_request` and dispatches
to this tester repo with the PR's head SHA:

```yaml
# in the FE/BE repo: .github/workflows/request-tester.yml
name: request-tester-verdict
on: [pull_request]
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - run: |
          gh api repos/<org>/nenu-tester/dispatches \
            -f event_type=run-tester-suite \
            -F client_payload[repo]=${{ github.repository }} \
            -F client_payload[sha]=${{ github.event.pull_request.head.sha }}
        env:
          GH_TOKEN: ${{ secrets.TESTER_DISPATCH_TOKEN }}
```

This tester repo's CI already listens for it (`repository_dispatch: types:
[run-tester-suite]` in `.github/workflows/ci.yml`) and would check out the app at the
*PR's* SHA instead of the pinned one.

### 2. Report-back: the verdict lands on the PR's commit

After the suite runs, the tester workflow posts a commit status onto the originating
commit via the Commit Status API:

```bash
gh api repos/${{ github.event.client_payload.repo }}/statuses/${{ github.event.client_payload.sha }} \
  -f state=$OUTCOME \            # success | failure
  -f context=tester-suite \
  -f target_url=$RUN_URL         # deep link to this run
```

### 3. Gate: branch protection makes it blocking

In each FE/BE repo: **Settings → Branches → branch protection on `main` → require
status checks → add `tester-suite`**. The merge button is now physically blocked until
the tester suite reports green. No process documents, no goodwill required.

### 4. Human layer: the automation engineer reviews test-sensitive changes

```
# CODEOWNERS in the FE/BE repos
/routes/    @automation-engineer
/models/    @automation-engineer
/src/       @automation-engineer
```

Plus one PR-template line so context travels with the PR:

```markdown
- [ ] Tester suite run: <link>   <!-- auto-posted by the tester-suite status check -->
```

## Not killing merge speed (the part that matters most)

- **The blocking gate is the API suite** — sub-second today, seconds at hundreds of
  tests. Fast enough to run on every PR without anyone noticing.
- **E2E runs on merge to `main`**, not on every PR. UI suites are the slowest and
  flakiest layer; putting them in the PR path is how teams learn to click
  "override" — and a gate the team routinely overrides is worse than no gate.
- **Failures get triaged by category** — product bug / infra flake / test bug — and
  flaky tests are quarantined by the automation engineer within a day, not left red.
  The suite's credibility is the actual asset being maintained here: the first time
  a red check is ignored and nothing bad happens, the gate is dead.
- **The pinned `APP_SHA` in CI is deliberate**: this repo's `main` always tests a
  known-good app version, so a tester-repo change can never be broken by an unrelated
  app change (and vice versa). PR-triggered dispatch runs test the PR's SHA instead.
