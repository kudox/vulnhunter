# OSV MCP integration (optional, Hunt-phase only)

This is an **opt-in** proof of concept that gives the `/vulnhunt` scanner access to the
[OSV](https://osv.dev) (Open Source Vulnerabilities) database via an MCP server. It lets
the Hunt phase answer questions a pure source-reasoning pass cannot — *is this dependency
version a known-CVE version? what advisory covers it?* — so a confirmed finding can be
enriched with real-world supply-chain context instead of severity alone.

It uses [`StacklokLabs/osv-mcp`](https://github.com/StacklokLabs/osv-mcp), which wraps the
public OSV API. **No API key required.**

## Scope: Hunt only — never Verify

Wire this into the **`/vulnhunt` (Hunt)** phase only.

The `/vulnhunt-fix-verify` agent is deliberately run under a tight, **no-Bash /
no-network** tool envelope (see the root README) so that verification is a sealed,
reproducible judgement. Adding a network-backed MCP server to the verifier would break
that guarantee. Do not add this config to a verify run.

## Security notes (read before enabling)

- **Advisory text is untrusted input.** Anything the OSV API returns (descriptions,
  references, aliases) is third-party data flowing into the agent's context. Treat it as a
  potential prompt-injection vector — the same posture the repo already takes toward CI
  logs and issue bodies.
- **Pin the version.** The example below builds from the reviewed tag `v0.1.3`
  (commit `944c2b3`). Don't float `main`. MCP servers were themselves a heavily-CVE'd
  attack surface through early 2026 — see https://vulnerablemcp.info — so review before
  you run, and re-review on upgrade.
- **Least privilege.** OSV is read-only and unauthenticated; keep it that way. Run the
  server bound to loopback (`127.0.0.1`) as below, not on a public interface.
- **Only scan code you are authorized to analyze** — same rule as the rest of VulnHunter.

## Build and run

Requires Go 1.21+ and [`task`](https://taskfile.dev).

```bash
git clone https://github.com/StacklokLabs/osv-mcp.git
cd osv-mcp
git checkout v0.1.3        # pin to a reviewed tag; do not run main unreviewed
task build

# Serve on loopback. Default transport is SSE on port 8080 (override with MCP_PORT).
MCP_PORT=8080 ./build/osv-mcp-server
```

Leave it running in its own terminal. Confirm the SSE endpoint path from the server's
startup log — `example.mcp.json` assumes the mcp-go default of `/sse`.

## Point Claude Code at it

Either copy [`example.mcp.json`](example.mcp.json) to the root of the repo you are about to
scan (as `.mcp.json`), or register it directly:

```bash
claude mcp add --transport sse osv http://127.0.0.1:8080/sse
```

Then start the scanner as usual and invoke `/vulnhunt`:

```bash
claude --model opus \
  --add-dir ~/.claude/skills/vulnhunt \
  --add-dir ~/.claude/skills/vulnhunt/phases
```

## Tools exposed

| Tool | Purpose |
| :--- | :--- |
| `query_vulnerability` | Vulnerabilities for a specific package version or commit. |
| `query_vulnerabilities_batch` | Batch lookup across multiple packages/commits. |
| `get_vulnerability` | Full detail for a specific vulnerability ID (e.g. a GHSA/CVE alias). |
