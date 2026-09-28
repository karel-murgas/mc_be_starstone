# Starstone

Electricity-style add-on: starstone dust, cables, generators and redstone adapters.
Packs: `starstone_bp/` + `starstone_rp/` (deployed by `mods deploy starstone`).

This repo also holds design contracts, retained art sources, reproducible asset tooling, and later validation/tests for the Starstone Bedrock add-on.

- `docs/GRAPHICS.md` — model, texture, palette, and block-state contract.
- `docs/ORCHESTRATION.md` — fresh-session Ornith runner and trust policy.
- `art_source/` — generated source atlases and the exact final prompts.
- `tools/build_graphics.ps1` — deterministic extraction of Minecraft-sized PNGs.
- `tools/validate-json.ps1` — recursively parses Starstone BP/RP JSON and exits nonzero
  with the failing relative path. Reads files only; never rewrites them.
- `tools/run_ornith_task.ps1` — one ephemeral Ornith task session.
- `tools/orchestrate_ornith.ps1` — sequential fresh-session coordinator.
- `docs/design/bedrock_stardust_proposal.md` — original product proposal.
- `docs/design/bedrock_stardust_implementation_plan.md` — ordered implementation plan.

Runtime resource-pack folders contain only files Minecraft consumes. Working notes and source art stay here.


## Required verification

From the workspace root, `mods verify starstone` runs the shared verifier with the
Starstone behavior tests (it is also the pre-commit hook). The underlying command:

```powershell
python -B .claude/skills/bedrock-lookup/scripts/verify_addon.py mods/starstone/starstone_bp mods/starstone/starstone_rp --regression-tests mods/starstone/tests/run.mjs
```

This includes JavaScript syntax checks through Node.js. `validate-json.ps1` only
checks JSON syntax and is insufficient for handoff. The general verifier's own
positive/negative fixtures run with `python -B tools/verification/test_verify_addon.py`.
See `docs/VERIFICATION.md` for audit coverage and remaining runtime-only checks.
