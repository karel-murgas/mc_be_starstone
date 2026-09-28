Task 4.5 repair only. The draft exists; fix the listed defects without surveying
the repository or rereading the full proposal/plan. Use PowerShell syntax, not
cmd /s /b, 2>nul, or &&. Read these production files once: networkController.js,
networkGraph.js, main.js, electricalBlocks.js (scripts under the Starstone BP).

1. In main.js playerBreakBlock AFTER event, identify the removed type with
   event.brokenBlockPermutation.type.id; event.block already contains air/the
   replacement. Capture the affected cached networks synchronously in that event
   before deferring work. Use a controller helper to capture plain coordinates,
   lane refs and copies of old node sets. Rebuild only after removal.
2. Remove the {...block, dimension} workaround. Native Block properties need
   not be enumerable. Pass the real block to discovery; fix stale test fixtures.
3. Handle main/ns/ew removed refs, all touched cached networks, and explicitly
   select a seed lane in discoverNetwork. A surviving bridge ew seed must start
   on ew, not the first lane. Keep the existing default for other callers.
4. Seed rediscovery from the removed position's six neighbors and their lanes
   that belonged to the old network(s), deduplicate components, exclude removed
   refs. Allow old nodes and newly encountered unowned loaded nodes; reject nodes
   owned by an unrelated cached network. Never join bridge lanes implicitly.
   Guard unavailable blocks/chunks. Preserve unrelated runtime networks.
5. electricalBlocks.js uses STATE_ENABLED without importing it; import the
   existing constant so disabled generators aren't silently treated as on.

Verification: one permanent mods/starstone/tests/networkSplit.test.mjs using
the existing tests/shims/minecraft-server-loader.mjs via node:module register.
Import actual production modules, no copied or rewritten production files in
temp. Fake blocks must reference the actual fake dimension. Drive system.runJob
by draining its generator; queue system.run callbacks then drain them.
Cases: middle of line => source side on, lamp side off; broken loop remains one;
removing a bridge processes both lane networks; surviving bridge ew seed stays
on ew; unrelated cached network unchanged; disabled generator reports off.
Also verify main.js reads brokenBlockPermutation, not current block type, in
the removal filter. Run this focused test plus node --check on changed scripts.
Stop after these checks. If unable to finish, report STATUS: BLOCKED honestly.
Do not claim in-game verification. Final handoff must use exact plain text
STATUS: COMPLETE or STATUS: BLOCKED, TASK: 4.5, FILES:, CHECKS:, NOTES:.
