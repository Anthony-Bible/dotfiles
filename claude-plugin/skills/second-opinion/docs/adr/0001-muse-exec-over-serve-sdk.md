# Drive the Reviewer with `muse exec` in a snapshot worktree, not `muse serve` + the SDK

The Reviewer was going to run under `muse serve` with a Python client (`muse-code-sdk`), which would have
given a live multi-turn session and a client-side allowlist for shell commands. We use `muse exec` instead.
The SDK (1.3.1, and `@muse-code/sdk` 1.3.0 on npm) hard-refuses the installed host (1.4.1) with a schema
fingerprint gate that deliberately has no override. Meanwhile `exec --session-id` turned out to keep
conversation memory across invocations, which is all the one Rebuttal needs, and it has native
`--output-schema`.

The allowlist doesn't survive the switch, and it wouldn't have been enough anyway. Testing showed that
`--disable-write` blocks only the edit tools: shell commands still write to the workspace, and no approval
prompt fires. So isolation doesn't come from policy. It comes from where the Reviewer runs: a dangling
snapshot commit of the working tree (built through a temporary index) checked out in a throwaway worktree.
The script creates that worktree itself (`git worktree add --detach`) and passes it with `-w existing`: from
muse 1.4.3 on, muse's own sandbox refuses to create `.git/worktrees/` entries, which broke `-w create`.

## Considered Options

- **`serve` + SDK, pinned to a muse 1.3.0 binary**: keeps the allowlist, but means two muse versions, and
  it breaks on every host or SDK bump.
- **`serve` + a raw MSP client (stdlib JSON-RPC)**: no fingerprint gate, but we'd own the handshake,
  approvals and item folding, several hundred lines of protocol code.
- **`exec` with `--disable-shell` in the real checkout**: truly read-only, but the Reviewer loses
  `git log`/`blame` and test runs to back up its Findings.

## Consequences

Revisit `serve` once an SDK matches the host, if a per-command allowlist or streaming ever matters. The
snapshot worktree stays either way: it is the isolation boundary.
