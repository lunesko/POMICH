# ECC in POMICH

Complete upstream package: https://github.com/affaan-m/ECC, MIT license.
Pinned version: **2.2.3**, commit `d2ef2680594f9a17526a6e1a2e18b3d242c5d17b`.
The Git submodule `tools/ecc` includes the entire source, not a selected export:
314 skills, 71 agents, commands, rules for all supported languages, hooks,
contexts, learning/memory tools, MCP templates, tests and host adapters.
See `.ecc/upstream.json` for the machine-readable pin. The MIT license remains
at `tools/ecc/LICENSE`. Keep attribution when redistributing the package.

## First checkout

```bash
git clone --recurse-submodules https://github.com/lunesko/POMICH.git
cd POMICH
npm run ecc:setup
npm run ecc:check
```

For an existing checkout, `npm run ecc:setup` initializes the pinned submodule
and installs its locked production dependencies with lifecycle scripts disabled.
Node 22 and Git are sufficient; application dependencies are separate.
Use Git with symlink support (WSL is recommended on Windows). Setup is repeatable;
it does not update ECC to a moving branch or change global permissions/models.

## Host integration

| Component | Connection | Runtime limitation |
| --- | --- | --- |
| All skills | `.agents/skills` links to the full upstream catalog; Claude loads the plugin catalog | Host discovery is required; files do not add tools to an already-running chat |
| Agent roles | All 71 profiles at `tools/ecc/agents`; Claude plugin loads them; three Codex native roles and the existing four Agency roles registered in `.codex/config.toml` | Claude Markdown roles are not all native Codex worker definitions; use profiles as instructions where needed |
| Rules | All languages in `tools/ecc/rules`; common/Python/TypeScript/React/web exposed to Claude under `.claude/rules`; AGENTS.md routes other hosts | Load only rules relevant to the task |
| Commands and contexts | Entire `tools/ecc/commands` and `tools/ecc/contexts`; Claude native commands via plugin | Slash-command support varies by host |
| Claude hooks and learning | `npm run ecc:claude -- [arguments]` starts Claude with the pinned local plugin | Requires Claude CLI and its hook trust controls; not executed by this installation task |
| Codex hooks | `npm run ecc:codex` registers the native ECC plugin from the pinned checkout | Codex user-wide registration, requires CLI with `plugin add`; review/trust SessionStart in `/hooks` |
| Memory | Local ECC memory MCP in `.mcp.json` and `.codex/config.toml` | Host must start the server; memory is reference data, not instructions |
| MCP templates and adapters | Entire upstream package retained | External services need their own credentials/setup; templates do not create accounts |

`npm run ecc:codex` uses the current Codex user's marketplace registration,
so it can affect other sessions under the same CODEX_HOME. It does not copy
upstream permissive/yolo configuration. It registers the native package, which
also declares Chrome DevTools MCP; that service requires npx/network at launch.
Codex's native hook projection supports SessionStart, not every Claude event.
The host's explicit hook trust cannot be replaced by repository configuration.
An ECC native plugin and project skill discovery can expose the same catalog;
they reference the same pinned source. Do not install a second moving ECC release.

## Memory and project rules

`scripts/ecc-memory.mjs` resolves paths from its own location and runs memory MCP
with project storage in `.ecc/memory`. The server reads project/team scopes; user scope is disabled by default. No real customer data or secrets belong there.
Session learning and saved memory remain local and ignored by Git. The memory
server does not manufacture prior context; it retrieves records actually saved.

Project instructions and the existing `.agency` roles remain authoritative.
ECC profiles do not grant merge/deploy permissions or automatically start
parallel agents, background loops, purchases or external communications.
Use the existing application checks for changes to application code.
Development tooling is excluded from the production Docker build context.

## Updating and removal

Update intentionally: fetch an exact upstream commit inside `tools/ecc`, review
its diff, update `.ecc/upstream.json` counts/version/commit, run setup and check,
and commit the submodule pointer with the lock change. Re-run the native Codex
registration if using it, and review any changed hook definition again.
Do not use `git submodule update --remote` as routine setup.

To remove, revert the integration commit. If native Codex registration was used,
remove it separately with `codex plugin remove ecc@ecc`; repository rollback does
not remove user-wide registrations. Existing local memory is not deleted.
