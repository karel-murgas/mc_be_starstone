# Starstone implementation audit — 2026-09-27

Reviewed the implemented Starstone BP/RP, all production scripts, existing tests,
and Ornith handoffs through the partial diagnostics task 5.1. The task-state file
reported task 5.1 exited with code 7. Earlier repair notes covered task 4.5;
current generator code already contained the corrected startup interaction hook.
This audit does not mark unimplemented later milestones complete.

## Confirmed defects corrected

| Finding | Correction |
|---|---|
| Cable item display_name used an unsupported `translate` field. | Use the documented `value` field referencing the existing localization key. |
| Cable item format was 1.21.0, below the documented stable block_placer floor. | Align the item format with the pack's declared 1.21.120 baseline. |
| All five loot tables put `count` directly on item entries. | Remove it; the default single item preserves the intended drop. Non-default quantities require a set_count function. |
| Bridge attached `starstone:bridge` without registering it. | Register the component during startup and test all block attachments against the registry. |
| Bridge used `query.is_valid()` for unconditional bone visibility. | Remove the unnecessary expression; both bones are visible by default. |
| Cable masks recognized only other cables. | Read electrical device descriptors; permit generator side contacts and coplanar lamps/bridges. Ignore old cable masks when deciding potential new contacts. |
| Device placement bypassed neighbor mask refresh. | Queue mask updates before discovering the placed device's networks. |
| Bridge placement discovered only its first lane. | Discover both lanes independently, deduplicating only when an external route actually connects them. |
| Graph traversal accepted reciprocal directions on different mounting planes. | Require matching mounting faces for surface-to-surface edges, and back-facing contacts for surface-to-conduit edges. |
| One throwing neighbor read could terminate the whole traversal. | Guard each location independently so other loaded branches are still visited. |
| Lamps/bridges lacked support handling; script-dropped cables left stale networks. | Share support checks, queue affected neighbors, capture old networks and split them after an unsupported element is removed. Deferred removal re-resolves the location/type. |
| Conduit axis had no placement control; geometry faces did not bind named end materials. | Select axis from the documented beforeOnPlayerPlace face/permutationToPlace properties; bind geometry UV faces to corresponding material names. |
| Cable powered state never changed its texture. | Add the powered material permutation. Lamp materials now explicitly support cutout transparency. |
| Rapid toggles compared only with world state, allowing earlier queued writes to win. | Compare against pending desired state and coalesce writes per dimension/position/state. Preserve unloaded writes as reconciliation candidates and skip incompatible replacement blocks. |
| rebuild_nearby only counted blocks and could leave its guard stuck on errors. | Refresh masks and reconstruct encountered components with runJob, cap seed scan dimensions, deduplicate lanes, and clear the guard in failure paths. Default scan reduced from 139,425 to 2,601 positions. |
| Diagnostics treated any source entity as a player and discarded non-electrical targets. | Filter player entity type and describe the actual looked-at block. |
| Diagnostics tests crashed, never registered their event handler, and asserted that rebuilding did no rebuilding. The split suite also failed because its shim lacked scriptEventReceive. | Repair the shim and replace the broken diagnostics tests with event-dispatch and real reconstruction assertions. |

Also removed quadratic queue shifting from graph discovery and whole-queue
copying from each deferred power batch. No stress-performance claim is made.

## API evidence

The available `reference/server-2.8.0.d.ts` identifies itself as the 2.8.0 API and
contains the runtime methods/events used here: startup/blockComponentRegistry,
onPlace, onPlayerBreak, onPlayerInteract, beforeOnPlayerPlace,
permutationToPlace, playerPlaceBlock/playerBreakBlock, brokenBlockPermutation,
scriptEventReceive and its namespaces filter, run/runInterval/runJob,
Block.isValid as a property, getState/withState/setPermutation,
Dimension.getBlock/isChunkLoaded/runCommand, dynamic properties, and view-ray
queries. These calls are not invented. The actual installed game's API support
still requires a game-load check.

Official references checked:

- [Block custom component callbacks](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/blockcustomcomponent?view=minecraft-bedrock-stable)
- [Placement event face and permutationToPlace](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/blockcomponentplayerplacebeforeevent?view=minecraft-bedrock-stable)
- [Dimension methods](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable)
- [BlockPermutation methods](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/blockpermutation?view=minecraft-bedrock-stable)
- [Geometry and default bone visibility](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_geometry?view=minecraft-bedrock-stable)
- [Item display_name](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_display_name?view=minecraft-bedrock-stable)
- [Item block_placer](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_block_placer?view=minecraft-bedrock-stable)
- [Loot functions and count placement](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/loottablereference/examples/loottablecomponents/loot_table?view=minecraft-bedrock-stable)

The readable local vanilla reference was inspected too. Its definitions directory
is not a complete custom-block schema collection; JSON parsing alone cannot
establish engine loadability. The README's previous 'known-good' baseline claim
was narrowed to 'declared': other packs' manifests do not prove compatibility.

## Verification results

- `node mods/starstone/tests/run.mjs`: **14/14 suites passed**.
- All 15 production JS files passed `node --check`.
- All 22 BP/RP JSON files parsed using Python's JSON parser.
- Existing block loadability checker passed.
- Pack contract tests check texture files/keys, geometry/bone references,
  named conduit face bindings, all 16 cable masks in both power states, item
  name/icon references, loot entry structure, and the BP-to-RP dependency.
- New integration tests use real production modules with immutable permutation
  fixtures and deferred callbacks/jobs. Cover six-face device contacts, startup
  attachment registration, device-last placement, bridge-lane independence,
  support-removal network splits, rapid power reversals, unloading between plan
  and write, dimension-height bounds, and all conduit placement axes.
- The PowerShell JSON validator was refused by the local execution policy;
  equivalent parsing was completed with Python. No execution policy changed.

## Remaining limitations / next human checks

No game launch, live Content Log inspection, in-game placement/rendering, or
watchdog stress test was performed. Follow the BP README checklist before
calling the prototype validated in Minecraft.

The implemented scope remains loaded-network gameplay with explicit nearby
rebuild. Automatic spawn recovery, persistence, explosion/piston mutation
coverage, recurring stale-position repair, unloaded-segment continuity, redstone
adapters, and survival content are later tasks and remain absent.

The support helper uses a conservative type/state heuristic plus
isLiquidBlocking for otherwise unclassified blocks. That API measures liquid
blocking, not collision shape; unusual partial blocks require game verification
and potentially an explicit support policy entry. Bridge back contacts are also
ambiguous in the plan because connecting both lanes through one support would
short them; bridges retain isolated tangent-only lanes pending an explicit lane
policy. No unloaded-chunk continuity or release-readiness claim is made.
