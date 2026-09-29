# Starstone

A Minecraft Bedrock add-on: a power network parallel to redstone. Starstone ore and dust,
surface cables on all six faces, isolated bridges, conduits, generators, lamps, and
redstone input/output adapters.

| | |
|---|---|
| Packs | `starstone_bp/` + `starstone_rp/` (deploy: `.\mods deploy starstone`) |
| Script API | `@minecraft/server` 2.8.0, block format / min engine 1.21.120 |
| Redstone input mode | polling (the native-consumer alternative is intentionally unused) |

## Repository

- `docs/PROPOSAL.md` - the product design; `docs/GRAPHICS.md` - model, texture, palette and
  block-state contract; `docs/ADAPTER-API.md`, `docs/CHUNK-SEGMENTS.md`, `docs/INNER-CORNER.md` -
  subsystem designs; `docs/RECIPES.md`, `docs/SURVIVAL.md` - content tables.
- `docs/TEST-WORLD.md` - the in-game test procedure; `docs/VERIFICATION.md`, `docs/STRESS.md` -
  offline coverage and measurements.
- `tests/` - Node suites (`node tests/run.mjs`), with a `@minecraft/server` shim in `tests/shims/`.
- `art_source/` - generated source atlases and their exact prompts (`PROMPTS.md`).
- `tools/build_graphics.ps1` cuts Minecraft-sized PNGs from the atlases and runs the `make_*.py`
  texture scripts; `tools/build_inner_corner.py` regenerates the Inner Corner block + model;
  `tools/generate-cable-permutations.mjs` regenerates the cable permutations
  (`generated/cable-permutations.json`); `tools/validate-json.ps1` is a JSON-only syntax check.

## Blocks and basic operation

Lighting: ore always emits level 3. Active cables, conduits, generators and
adapters emit level 1; inactive ones emit 0. A bridge emits 1 when either lane
is powered, while its lane textures remain independent. Powered lamps emit 15.
Art readability was accepted in game (2026-09-29).

Implemented electrical blocks: cable, isolated bridge, conduit, generator,
lamp, redstone input and redstone output. Survival content includes Ore, Dust,
Compressed Dust and Crystal. Give cable with `/give @s starstone:cable_item`; other blocks/items
use their normal IDs, such as `/give @s starstone:generator` or
`/give @s starstone:dust`.

Surface cables, bridges, lamps and adapters mount on all six support faces.
Cables expose joined tangent arms; a bridge keeps its two lanes independent.
Surface cables also wrap around outside edges of the same full support cube.
An Inner Corner item crafted from two Cables occupies an empty inside-corner
cell with two perpendicular full support faces, joining both cable runs. A matching
conduit or full generator supplies a back contact; bridges have tangent
contacts only. A conduit selects X/Y/Z from its placement face and conducts
only between its opposite ends. Break and replace it to change the axis.

The generator starts enabled and interaction toggles it. Internal power is
binary: any active source powers its connected component. Removing a support
drops its surface device once and repairs the affected network. Partial-block
support classification still needs in-game validation.

All seven electrical blocks declare `minecraft:movable` as `immovable`.
Explosions are reconciled in one deduplicated, yielded batch. Moving a vanilla
support or changing an indexed block by command is caught by periodic
maintenance. Validation visits at most 16 indexed cursor entries every 100 ticks;
related topology repairs run as yielded jobs. It never scans a surrounding
volume periodically. Unknown command-created circuits require nearby rebuilding.
Piston and explosion behavior were accepted in game (2026-09-29).

## Recovery and durable chunk graph

On initial player spawn, a bounded scan covers the player's complete 16x16x16
section. Successful sections are deduplicated by dimension, horizontal chunk
and height for that session; normal respawns do not rescan. Concurrent automatic
requests queue. Manual nearby rebuilding scans at most 17x9x17 seed positions;
connected loaded components may extend farther.

Placement hints are versioned, separated by dimension/chunk/vertical section,
and contain at most 4,096 compact local positions per property. They are checked
against actual blocks; unavailable positions are retained. Corrupt hints warn
once and are ignored without preventing world-based network reconstruction.

Chunk snapshots have `{v:1, dimensionId, cx, cz, segments:[...]}`. Each segment
records a stable key, lane-aware member references, source/active-source summaries,
consumers, and exact directional boundary ports. The stable key is the smallest
member reference. Reciprocal, compatible ports join logical networks through
saved metadata even when an intermediate chunk is unavailable. Power is the OR
of active source summaries. Source changes commit before consumer visual writes.

Snapshots use 24,000-byte pages in two banks; the head pointer switches only
after staging a complete replacement. Failed commits preserve the previous
snapshot. Revision checks reject scans made stale by intervening edits.
[CHUNK-SEGMENTS.md](docs/CHUNK-SEGMENTS.md) includes complete
schema examples and recovery rules.

A slow observer checks at most 32 cached chunk candidates every 100 ticks,
deduplicates players, and retries newly available boundaries. Standing still
in a loaded chunk does not repeatedly rebuild it. No ticking areas or forced
chunk loading are used. Saved topology can be stale until a changed chunk is
observed and reconciled; the world remains authoritative.

Offline A-B-C fixtures pass: source changes in A cross saved B metadata while B
is unavailable, C receives the latest state after returning, and no unavailable
block is read. **The unloaded-middle test (TEST-WORLD.md gate 7.6) has not been run in Minecraft.** Neither the physical
unloaded-middle arrangement nor the equivalent save/unload/load sequence is
claimed as passed. Use the exact scenarios in the checklist linked below.

## Redstone adapters

The adapter reads or emits redstone at its support and touching sides. Its
artwork's arrow is a conversion emblem, not a placement direction.

- Input reads registered adapters' six neighboring blocks every 4 ticks. Power 0 means
  off, 1-15 means on; 1 to 15 does not rebuild or toggle the network. Unavailable
  supports retain the previous state. Starstone power never writes the input's
  source flag, preventing feedback through its own visual state.
- Output uses `minecraft:redstone_producer`, 0 when off and 15 when on, with
  all six directly connected faces. The support-facing side remains the strong
  power target under `transform_relative:true`.

## Materials, ore and tuning

| Setting | Prototype value |
|---|---|
| Valid mining tools for drops | Iron, diamond, netherite pickaxes |
| Base Dust drop | 2-4 |
| Fortune I / II / III | 3-5 / 4-6 / 5-7 Dust |
| Silk Touch with a valid tool | One Ore block, no Dust |
| Invalid tool | No drop |
| Mining time | 1.5 seconds base; pickaxes have tier-specific speeds (iron 0.75 seconds) |
| Generation | Overworld, underground pass, new chunks |
| Placement origin Y | General -64 through 15; deep -96 through -32 |
| Attempts per chunk | 4 general + 8 deep |
| Vein size | 8 placement attempts per feature |
| Replacement blocks | Stone and deepslate |
| Air-exposure discard chance | None |

Mining and ore distribution were accepted in game (2026-09-29); Silk Touch and Fortune
drops are not yet tested. These are tuning values; exact ore counts and tool behavior remain
unmeasured. Ore veins may spread around their placement origin. Existing chunks
are not retroactively regenerated. [SURVIVAL.md](docs/SURVIVAL.md)
records the loot and generation schemas and references.

## Installed recipes

One Cable crafts from one Dust between two copper ingots (`C S C`); two Cables
make an Inner Corner. Four Dust
and one copper ingot make Compressed Dust; a vanilla furnace and fuel refine it
to one Crystal. The Generator uses two Crystals, six copper ingots and one iron
ingot. Bridges use cable and iron, with no Crystal; Conduits use chiseled stone
bricks. [RECIPES.md](docs/RECIPES.md) has the complete
table and exact yields. A dedicated hopper-compatible kiln remains a later,
version-gated option.

## Diagnostics and verification

- `/scriptevent starstone:diagnose` reports runtime/logical network counts,
  bounded maintenance work, chunk retries, adapter polling and power queues,
  total add-on dynamic-property bytes, and the looked-at block.
- `/scriptevent starstone:diagnose chunk 1 0 64` reports actual chunk availability
  for chunk X1/Z0 at Y64 in the player's dimension, without reading a block.
- `/scriptevent starstone:rebuild_nearby` starts a bounded nearby rebuild.
- `/scriptevent starstone:debug on|off` persists the debug flag.

Normal gameplay sends no unsolicited chat. Player-facing messages and names use
resource-pack localization. Startup has one informational activation log.

From the workspace root, `.\mods verify starstone` runs the shared general verifier with
all permanent regressions (the pre-commit hook runs it too). The extra checks:

```powershell
python -B tools/verification/test_verify_addon.py
node mods/starstone/tests/mutation-check.mjs
node mods/starstone/tests/stress.mjs
```

The general verifier checks Bedrock loot-tool condition nesting and range
field names as well as the earlier syntax/schema/API checks. Ore drops now use
the pre-break tool through Script API. A deliberate
incompatible-face connection in an isolated copy is rejected by the graph suite.
See [VERIFICATION.md](docs/VERIFICATION.md) for coverage.

## Measured offline budgets; game measurements pending

| Cable nodes | Discovery generator advances | Power callbacks | Max planning reads/callback | Peak deferred write queue | Dynamic-property bytes |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 42 | 125 | 32 | 32 | 345,427 |
| 5,000 | 209 | 625 | 32 | 32 | 1,750,280 |
| 10,000 | 417 | 1,249 | 32 | 32 | 3,542,234 |

Power writes are capped at 16 per callback; large-network planning reads are
capped at 32. Multiple small calls can collectively queue more than 32 writes;
all writing callbacks still retain the 16-write cap. These are Node measurements,
not Minecraft ticks. Rebuild ticks, power-update ticks, watchdog messages and
Content Log results are **not measured**. No safe in-game network limit is claimed.
JSON serialization and metadata graph construction still require game profiling.
Full methodology/timings/memory notes: [STRESS.md](docs/STRESS.md).

## Open in-game checks

Follow [TEST-WORLD.md](docs/TEST-WORLD.md): exact builds cover
all six faces, every joined shape, bridge isolation, conduit axes, merging and
splitting loops, multiple sources, support/explosion/piston changes, reload,
unloaded-middle continuity, adapter support transitions, ore/tools/generation,
installed recipes, stress budgets, and bright/dark art readability.

Accepted in game (2026-09-29): six-face placement and final art readability, piston
policy and explosions, strong redstone output and support input, mining and new-chunk
ore distribution. Pack load was accepted; Content Log/version details are not needed.

Still open:

| Check | Status |
|---|---|
| Silk Touch and Fortune ore drops | Not tested (plain mining works) |
| Actual unloaded-middle or alternate save/unload/load sequence (TEST-WORLD gate 7.6) | Not run |
| 1k/5k/10k real ticks, queue observations and watchdog logs | Not run |
