# Ornith execution rules for Starstone

Work on exactly the numbered task included in the current prompt, then stop. Each task runs in a fresh OpenCode session, so rely on the task brief and files on disk rather than conversation history.

- Always use `C:\mcmods` (the workspace) or paths relative to it. Never type its long resolved profile path.
- Edit Starstone only in `mods/starstone/`. Never write into `C:\mc` (Minecraft's own folder); `mods deploy starstone` copies the packs there.
- Read only the task's listed files plus the proposal, implementation plan, or graphics contract when the task requires them.
- Keep the work bounded. The runner enforces 60 tool calls and 30 minutes by default; finish your handoff before those limits. Never restart a sweep or reread a file already read during this session.
- A partial result reported as `STATUS: BLOCKED` is acceptable. State the precise blocker and preserve valid work already completed.
- Do not implement later tasks, redesign identifiers, replace generated graphics, or broaden the scope.
- Use `C:\mcmods\temp\` for scratch files.
- Run only the smallest verification explicitly requested by the task. Do not add a broad regression pass or review your own completed work a second time.
- OpenCode permissions use broad allow rules plus explicit denies. If an operation is denied, report the blocker; do not work around it.
- Never stop, kill, restart, or reconfigure llama-server. Its lifetime is managed outside this session.
- Do not start ComfyUI or install model/runtime tooling.
- Bedrock claims must come from the pinned vanilla reference or schemas at `E:\AI\ref\bedrock\current`; do not invent component keys.
- For any task that creates or edits block JSON, item JSON, pack manifests, or custom-component registration, first read `C:\mcmods\.claude\skills\minecraft-bedrock-modding\SKILL.md` and its linked block-loadability reference. Run its cheap structural checker once after the edit. Before a pack-facing handoff, also run `python -B .claude/skills/bedrock-lookup/scripts/verify_addon.py mods/starstone/starstone_bp mods/starstone/starstone_rp --regression-tests mods/starstone/tests/run.mjs`. JSON parsing alone is not a Bedrock loadability check.
- Treat `/give` discovery as the first in-game acceptance point for every new player-facing block or item. Do not claim geometry, placement, or logic complete while the identifier is absent from commands.
- Finish with the exact handoff schema required by the current prompt. Do not add text before `STATUS:`.

- Shell commands run in PowerShell: use Get-ChildItem, not cmd switches, `2>nul`, or `&&`. Avoid unrelated repair briefs and orchestration documentation when implementing a gameplay task.

- Before editing Script API event handlers or component registration, read the Minecraft modding skill even if no block JSON changes. Verify every event/property used in the pinned declarations (`reference/server-2.8.0.d.ts` when present), and run a small test that registers and dispatches the handler. A helper-only test does not verify event wiring. Never leave an unverified event in a COMPLETE handoff.
