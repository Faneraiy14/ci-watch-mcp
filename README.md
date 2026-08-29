# ci-watch-mcp

*[Українською](README.uk.md)*

An MCP server with a single tool, `watch_ci` — it waits for GitHub Actions
CI to finish for a commit in a local git repository, and returns a summary
plus the failure log (if something broke) in one call.

## Why

Without this, checking "did CI pass after my push" is manual work:
push → sleep → `gh run list` → if the status is "in_progress", sleep again →
`gh run list` again → if `conclusion: failure`, a separate call to
`gh run view <id> --log-failed` to see exactly what broke.
`watch_ci` does all of that in a single call and returns the failure log
right away, with no manual polling loop.

## Tool

### `watch_ci`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cwd` | string | — (required) | Path to a local clone of a repository with an `origin` on GitHub |
| `ref` | string | `HEAD` | SHA (full or short) or any git ref |
| `workflow` | string | — | Filter by workflow name, if the repo has more than one |
| `timeout_ms` | number | `300000` (5 min) | Capped at `1200000` (20 min) |
| `poll_interval_ms` | number | `5000` | Polling interval for `gh run list` |

Returns:
- `{ ok: true, conclusion: "success", url, sha, workflowName }` — CI passed;
- `{ ok: false, conclusion: "failure", url, sha, workflowName, failedLogs }` — CI failed, `failedLogs` is the tail of `gh run view --log-failed` (truncated to 8000 characters, kept from the end — that's where the most useful info is);
- `{ ok: false, timedOut: true, status, url, message }` — didn't finish/start in the allotted time.

If `ref` doesn't resolve to a real commit (a typo in the SHA), the tool
throws an error immediately instead of silently waiting until the timeout.

## Installation

```bash
cd ci-watch-mcp
npm install
```

Connecting it to Claude Code:

```bash
claude mcp add ci-watch -s user -- node /path/to/ci-watch-mcp/src/server.js
```

Requires the `gh` CLI installed and authenticated (`gh auth status`).

Cross-platform — plain Node.js shelling out to `gh`, which runs natively
on Windows too. No platform-specific code path.

### Updating

No separate build/publish step — `claude mcp add` points straight at this
checkout's `src/server.js`, so updating is just `git pull && npm install`,
taking effect on the next new Claude Code session.

## Tests

```bash
npm test
```

They run against already-completed real runs in the `secretscan` repository
(a successful one, a failed one, and a commit with no CI run at all) —
no need to wait for a live push.

## License

MIT — Faneraiy14.
