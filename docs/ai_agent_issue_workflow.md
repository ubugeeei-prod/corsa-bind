# Local Issue Agent

The local issue agent turns GitHub Issues into implementation pull requests from
your machine instead of GitHub Actions.

It lives in [`../scripts/issue_agent.ts`](../scripts/issue_agent.ts).

## What It Does

The script uses the local `gh` and `codex` CLIs to:

- poll open GitHub Issues, or run against one issue number
- update the local default branch
- create a local `codex/issue-<number>-...` branch
- run `codex exec` with the issue context
- commit generated changes with a Conventional Commits title
- push the branch and open a ready-for-review pull request
- enable squash auto-merge
- wait for pull request checks unless disabled

Processed issues are recorded in `.cache/issue-agent/state.json`, which is
ignored by git.

## Requirements

Authenticate locally before running the agent:

```bash
gh auth login
codex login
```

The script assumes:

- the worktree is clean before each issue starts
- `origin` points at the target GitHub repository
- local credentials can push branches and create pull requests
- repository CI runs for PR branches

## Run One Issue

```bash
vp exec node --strip-types ./scripts/issue_agent.ts run --issue 328
```

Useful options:

```bash
vp exec node --strip-types ./scripts/issue_agent.ts run --issue 328 --model gpt-5
vp exec node --strip-types ./scripts/issue_agent.ts run --issue 328 --no-wait-ci
vp exec node --strip-types ./scripts/issue_agent.ts run --issue 328 --draft
vp exec node --strip-types ./scripts/issue_agent.ts run --issue 328 --no-auto-merge
```

## Watch Issues

```bash
vp exec node --strip-types ./scripts/issue_agent.ts watch --poll-seconds 60
```

For a one-shot pass over currently open issues:

```bash
vp exec node --strip-types ./scripts/issue_agent.ts watch --once
```

By default, watch mode considers every open issue that is not already recorded
as processed in `.cache/issue-agent/state.json`.
To retry an issue that was already processed, either run it directly with
`run --issue <number>` or remove that issue from the state file.

## PR Conventions

The script enforces these local conventions:

- PR titles use Conventional Commits format.
- PR titles do not include `[codex]`.
- PR bodies include `Closes #<issue-number>`.
- PRs are ready for review and use squash auto-merge by default.
- `--draft` keeps work in progress, while `--no-auto-merge` leaves merging manual.
- PR checks are watched by default after creation.

Codex is asked to write proposed PR metadata under
`.cache/issue-agent/issues/<issue-number>/`. If it does not, the script falls
back to a safe `chore: address issue #<issue-number>` title and a template body.
