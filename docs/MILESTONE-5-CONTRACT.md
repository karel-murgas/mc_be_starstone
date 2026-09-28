# Milestone 5 integration contract

Scope: complete tasks 5.1-5.4 (offline implementation), preserving current loaded
network behavior. No milestone 6+ features or game-verification claims.

Ownership:
- Recovery worker: scripts/repair.js and scripts/diagnostics.js only.
- Persistence worker: scripts/persistence.js only.
- Test worker: new tests/persistence.test.mjs and tests/repair.test.mjs only.
- Root: main.js, cableComponent.js, shared test shims, documentation, integration.

All paths are relative to C:\mcmods. Read AGENTS.md. The general verifier is
.claude/skills/bedrock-lookup/scripts/verify_addon.py; run with -B and the
--regression-tests mods/starstone/tests/run.mjs option for the final gate.
Verify actual Bedrock methods against reference/server-2.8.0.d.ts. Do not register
legacy dynamic properties or read world data during module initialization.

## Persistence module contract

Exports createPlacementIndex(storage, { warn } = {}) and placementIndex singleton
backed by world. Storage has getDynamicProperty(key), setDynamicProperty(key,value),
and getDynamicPropertyIds(). Test store is a plain Map adapter.

Instance methods:
- record(block): record a currently valid electrical block (KIND_BY_ID).
- remove(dimensionId, location): remove a known position, idempotent.
- positionsInChunk(dimensionId, cx, cz): copied array of integer {x,y,z} positions.
- validateChunk(dimension, cx, cz): synchronous generator, yields between positions;
  validate world blocks, remove stale loaded entries, retain unavailable/unloaded
  entries. No block changes. Return summary {checked, removed, unavailable}.
- stats(): bounded read-only summary {shards, positions}; no world volume scan.

World blocks are authoritative. Schema version and position data are persisted
in per-dimension/per-chunk properties. Further split by 16-high section if needed
to guarantee even a dense chunk stays below the 32,767-byte string limit. Prefer
compact local integer positions and deterministic keys. Reject malformed keys,
wrong versions and invalid/cross-shard entries. Ignore a corrupt shard, warn once
per shard, preserve other shards. Read lazily, no large synchronous world read.
Writes should be idempotent. On storage failure do not claim durable success.
Document schema/constants via exported constants and clear module comments.

## Recovery module contract

Exports startRebuildNearby(player, {radius,height} = {}), isRebuildRunning(),
recoveryStats(), queueInitialSpawn(event), registerRecovery(), REBUILD_RADIUS=8,
REBUILD_HEIGHT=4. Manual start returns bool, rejects concurrent work with a
message. Keep diagnostics exports compatible via forwarding to repair.js.

Extract existing nearby reconstruction from diagnostics into repair.js. Scan
bounded loaded positions via runJob, refresh all in-scan cable masks before
component discovery, deduplicate lane refs incl. both bridge lanes. Record
observed electrical blocks in placementIndex; validate relevant indexed chunks
with yield* validateChunk. Re-read blocks before using deferred work. Follow
connected loaded networks beyond seed volume as existing code does. Clear job
state on scheduling, messaging, traversal errors and player disconnect. Manual
messages remain bounded; automatic jobs are quiet.

Initial-spawn event only; no normal respawns. Defer player/dimension capture safely,
queue requests when work is already active, deduplicate dimension + chunk +
vertical section (players at different heights must not suppress one another).
For consistent coverage with this dedup key, automatic scan covers the FULL
16x16x16 origin section, not merely one player's offset 17x9x17 cuboid. It may
follow connected components outside that seed section. Only mark completed on
successful processing; failed attempts can be retried on a later initial spawn.
Default manual scan remains at most 2,601 positions; auto scan at most 4,096.
registerRecovery subscribes to world.afterEvents.playerSpawn; root calls it from
main. Parent will supply shared fake playerSpawn and dynamic-property APIs.
recoveryStats() includes running, queued and completedAreas counts (small summary).

## Tests

Use actual production modules and existing runtimeFixture.mjs with asynchronous
run/runJob draining. Persistence fixtures use createPlacementIndex with Map-backed
storage to simulate restart. Cases: dimension/chunk/negative coords, idempotence,
restart, bounded dense shard size, one corrupt shard warning, stale removal,
unloaded preservation and write failure. Recovery: manual reload -> powered lamp,
initial spawn restores once per section, respawn ignored, second dimension/height
not suppressed, second area queued while busy, same area dedup, guard cleanup,
bridge lanes, job budgets and index integration. Do not edit shared shims; coordinate
needed APIs with root. Update acceptance tests to contract, not implementation.
