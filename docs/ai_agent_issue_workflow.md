# AI Agent Issue Workflow

The AI Agent workflow turns selected GitHub Issues into implementation pull
requests.

It lives in
[`../.github/workflows/ai-agent-issue.yml`](../.github/workflows/ai-agent-issue.yml).

## What It Does

The workflow runs on:

- newly opened issues
- manual `workflow_dispatch` runs with an issue number

For each eligible issue, it:

- checks out the default branch
- installs the Rust and Vite+ toolchains used by this repository
- runs `openai/codex-action` against the issue context
- commits any generated changes to a `codex/issue-<number>-<run-id>` branch
- opens a pull request with a Conventional Commits title
- waits for the pull request checks and fails the workflow if CI fails or never
  appears

The workflow intentionally treats every newly opened issue as eligible for AI
Agent implementation.

## Required Secrets

Configure these repository secrets before enabling the workflow:

- `OPENAI_API_KEY`: API key used by `openai/codex-action`
- `AI_AGENT_GITHUB_TOKEN`: a fine-grained PAT or GitHub App installation token
  used to push the branch and create the pull request

`AI_AGENT_GITHUB_TOKEN` is required instead of relying on the workflow
`GITHUB_TOKEN`. Pull requests created by `GITHUB_TOKEN` do not reliably trigger
the repository's normal CI workflows, which would make the required CI
verification step meaningless.

The token should be scoped to this repository with:

- Contents: read and write
- Pull requests: read and write
- Issues: read and write

## Optional Variables

Set the repository variable `AI_AGENT_MODEL` to choose the Codex model used by
the action. If the variable is unset, the Codex action uses its default model.

## PR Conventions

The workflow enforces these local conventions:

- PR titles must use Conventional Commits format.
- PR titles must not include `[codex]`.
- PR bodies include `Closes #<issue-number>`.
- The workflow waits for CI after creating the pull request and reports the
  result back to the issue.

If Codex writes an invalid title, the workflow falls back to:

```text
chore: address issue #<issue-number>
```

## Manual Run

Use the workflow dispatch input when an issue should be retried:

```text
Actions -> AI Agent Issue Implementation -> Run workflow -> issue_number
```
