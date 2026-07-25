# VulnHunter (`/vulnhunt`)

The core VulnHunter scanner skill for [Claude Code](https://docs.claude.com/en/docs/claude-code).
It maps every user-controllable input in a codebase, traces each one *forward*
to dangerous sinks, runs an adversarial pipeline to disprove weak candidates,
and emits only findings it can back with an executable proof-of-concept and a
proposed fix. This is a **prompt-only** skill — `SKILL.md` plus the phase files
under `phases/`; there is no Python package to install.

## Install

This skill ships as part of the [VulnHunter](https://github.com/capitalone/vulnhunter)
repository. From the repository root, run the shared installer to copy all skills
(including this one) into `~/.claude/skills/`:

```bash
./install.sh      # installs vulnhunt, vulnhunt-fix-verify, and vulnhunter-fix
./uninstall.sh    # removes them
```

`install.sh` copies files directly (rather than symlinking) — symlinks break
`find`/`glob` inside subagents. Re-run `./install.sh` after editing any skill
file to refresh the installed copy.

> **Run on Opus.** The falsification discipline that keeps false positives low
> depends on frontier Opus-class reasoning. You supply your own model access.

## Usage

```bash
claude --model opus \
       --add-dir ~/.claude/skills/vulnhunt \
       --add-dir ~/.claude/skills/vulnhunt/phases

# then inside the Claude Code session:
/vulnhunt
```

The scan writes its artifacts to a `*_VULNHUNT_RESULTS_*` directory (report
`README.md`, executable PoCs, and exploit tests). VulnHunter **never modifies
the target codebase** — fix strategies are documented, not applied.

For unattended or batch operation, the [`vulnhunter-agent/`](../vulnhunter-agent/README.md)
runtime wraps this skill headlessly and the [`harness/`](../harness/README.md)
drives it across many repositories.

## Optional: seed the sink inventory with Semgrep (Bash)

Phase 1 builds a **sink inventory** by grepping for dangerous patterns
(`phases/phase1_recon.md`, Step 1a). You can optionally seed that inventory with a
Semgrep pass first. Semgrep is a fast pattern matcher — high recall, lots of noise —
so its hits enter the pipeline as **candidate sinks (leads), never as findings**. The
forward trace (Phase 2) and the adversarial verify (Phase 2b) still have to confirm or
discard each one. This is the division of labour that keeps the false-positive rate low:
**Semgrep for recall, VulnHunter for precision.** Do not treat a Semgrep hit as a
vulnerability.

This is an **operator pre-scan step**, run before `/vulnhunt`. It requires Bash and a
local Semgrep install, so it is *not* part of the default read-only skill — it fits the
`vulnhunter-agent/` runtime, or any interactive run where you have Semgrep available.

```bash
# Run from the target repo root, BEFORE starting the scan.
# Install once, e.g.:  pipx install semgrep
mkdir -p .vulnhunt-seed

# `--config auto` fetches community rules from the Semgrep registry (network +
# third-party rules — pin curated packs like `p/security-audit` `p/owasp-top-ten`
# instead if you want an offline, reviewed ruleset).
semgrep scan --config auto \
  --severity ERROR --severity WARNING \
  --json --quiet \
  -o .vulnhunt-seed/semgrep.json .

# Slim it to just the fields the scan needs (keeps agent context small):
jq '[.results[] | {check_id, path, line: .start.line,
     severity: .extra.severity, message: .extra.message}]' \
  .vulnhunt-seed/semgrep.json > .vulnhunt-seed/sinks.json
```

Leave `.vulnhunt-seed/sinks.json` in the target repo root. Phase 1 Step 1a picks it up
automatically when present and cross-references each entry against the input inventory;
when it is absent the scan runs exactly as before. The Semgrep output is your own tool's
data, but `--config auto` pulls third-party rules — review the ruleset you trust, and
remember the seed only *adds* candidates: it never suppresses the mandatory grep pass or
short-circuits verification.

## Design: dispatcher + phase subagents

`SKILL.md` is an **orchestrator** — it never performs security analysis itself.
It creates the results directory, dispatches a subagent per phase, verifies each
subagent's output files exist, and compiles the final report. Keeping findings
out of the orchestrator's context is deliberate: it forces the systematic
methodology instead of improvised analysis.

| Phase | File | Responsibility |
|-------|------|----------------|
| 1 · Recon | `phases/phase1_recon.md` | Build the input inventory, partition the codebase, annotate production reachability. |
| 2 · Hunt | `phases/phase2_hunt.md` + `phase2_class_{inj,nav,log}.md` | Parallel class agents (injection / navigation-&-access / logic-&-crypto) trace inputs to sinks per partition, plus one sink-driven audit agent. |
| 2b · Verify | `phases/phase2b_verify.md` | Adversarial pass that tries to *disprove* each candidate; ~half are eliminated. |
| 3 · Reproduce | `phases/phase3_reproduce_test.md` + `phase3c_fixes.md` | Write PoCs, executable exploit tests, and fix strategies. |
| 3d · Sweep | `phases/phase3d_sweep.md` | Grep every confirmed root-cause pattern across the whole codebase. |
| 4 · Report | `phases/phase4_report.md` | Orchestrator compiles the final report. |

`phase2_shared.md` holds the reference material every class agent reads first, so
it is cached across the parallel dispatch.

## Requirements

- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code),
  authenticated, running on an Opus model.
- No Python, no network — the skill is read-only over the target checkout by
  default. (The agent runtime can opt into `--no-read-only --enable-bash` to run
  exploit tests; interactive use stays static.)

## License

Part of the VulnHunter project; licensed under the Apache License, Version 2.0.
See the repository-root [`LICENSE`](../LICENSE).
