# Starstone Bedrock Add-On — implementation plan

This plan turns `bedrock_stardust_proposal.md` into small implementation tasks for a coding-only local model. The proposal remains the product brief. This document is the execution order and the acceptance contract.

## 1. Working decisions

Use these names until a deliberate rename task is requested. Display names can change later without changing internal identifiers.

| Purpose | Working value |
|---|---|
| Add-on name | Starstone |
| Identifier namespace | `starstone` |
| Behavior pack folder | `mods/starstone/starstone_bp/` |
| Resource pack folder | `mods/starstone/starstone_rp/` |
| Cable block/item | `starstone:cable` / Starstone Cable |
| Joined four-way crossing | ordinary `starstone:cable` with connection mask 15 |
| Isolated crossover | `starstone:bridge` / Starstone Bridge |
| Through-block conductor | `starstone:conduit` / Starstone Conduit |
| Mineable source block | `starstone:ore` / Starstone Ore |
| Material items | `starstone:dust`, `starstone:crystal` |
| Always-on source | `starstone:generator` |
| Test consumer | `starstone:lamp` |
| Redstone input | `starstone:redstone_input` |
| Redstone output | `starstone:redstone_output` |

Keep the first playable prototype deliberately narrow:

- One surface element occupies one block position and has one mounting face.
- Cables, bridges, lamps, and both redstone adapters are thin pieces mountable on floors, ceilings, and walls. The generator is a full block.
- Coplanar cable masks cover isolated, endpoint, straight, L/elbow, T-junction, and joined four-way intersection shapes. All arms in an ordinary cable block are electrically joined.
- `starstone:bridge` is the only coplanar non-joining crossover. Its local north–south and east–west lanes are visually and electrically independent.
- `starstone:conduit` is a full support block with one axis. It joins only two opposite faces so a surface signal can pass through the block and emerge on its other side.
- In the first prototype, surface elements connect only when they are coplanar with the same mounting face, except for explicit back contacts through conduits/generator supports and a cable arm touching a generator face. A vertical path means a path travelling up a wall.
- Wrapping around an inside or outside edge is a later extension. Do not quietly add it to the prototype.
- Electricity is binary. A network is on if at least one attached source is on.
- Flat devices expose four joined tangent ports. The lamp is both a consumer and a conductor across its joined ports. A surface element also exposes a back contact when its supporting block is a matching Starstone Conduit or a full generator. The generator exposes one joined source lane on all six faces, so both mounted cables and cable arms touching it can receive power.
- Removing or invalidating the support removes the attached surface element. A redstone input reads its supporting block; a redstone output strongly powers its supporting block.
- There are no cable entities, ticking areas, or per-cable tick callbacks.
- World blocks are authoritative. Runtime and persistent indexes must be repairable.

### Graphics delivery status — 2026-09-26

Codex has completed the asset side of G1–G3 and the first polished G4 pass:

- final working palette: deep navy/charcoal, cool gunmetal, neon blue, electric cyan, cyan-white;
- cable geometry with the required `center`, `arm_n`, `arm_e`, `arm_s`, and `arm_w` bones;
- 32×32 block textures for cable states, ore, conduit, bridge, casing, a full generator, flat lamp states, and flat adapters;
- 32×32 item icons for Dust, Crystal, ore, cable, bridge, conduit, generator, lamp, and both adapters;
- transparent narrow-wire cable art, shared flat lamp geometry, compact adapter-box geometry, and a two-lane bridge geometry with independently addressable lane materials;
- pack icon and reusable emblem;
- retained source atlases and a deterministic extraction script under `mods/starstone/tools/`.

See `mods/starstone/docs/GRAPHICS.md` for the file-to-state contract. The only remaining G4 work is an in-game readability review after Ornith wires the assets into block permutations; fixes at that point should preserve identifiers, cable bone names, and bridge lane names.

## 2. Version gate

Do not guess manifest versions. Task 0 records the version actually accepted by the installed game.

The workspace already contains packs using block format `1.21.120` and `@minecraft/server` `2.8.0`; use those as the initial core baseline only if the game accepts them. `minecraft:redstone_producer` requires block format `1.21.120`. The native `minecraft:redstone_consumer` component requires at least `1.21.130`, and versions before `1.26.0` may require Upcoming Creator Features. The core Starstone network must remain usable without that component.

For the redstone input adapter:

1. Prefer `minecraft:redstone_consumer` plus `onRedstoneUpdate` when the installed game supports it without unwanted experiments.
2. Otherwise poll `Block.getRedstonePower()` for registered input adapters only, every 4 ticks by default.
3. Never poll every cable.

Record the chosen engine version, Script API version, experiment requirements, and adapter mode in `mods/starstone/starstone_bp/README.md`.

## 3. Definition of the prototype

The prototype is complete when all of these are true in a test world:

1. Every surface element can be placed on each of the six support faces.
2. Removing the support removes or drops the attached surface element.
3. Coplanar cable neighbors render isolated, endpoint, straight, L/elbow, T-junction, and joined four-way intersection shapes correctly.
4. A bridge carries north–south and east–west signals independently in the same block position.
5. A generator powers every lamp in its loaded connected component.
6. A conduit carries a signal through its support block only along the conduit axis.
7. Starstone Ore can be mined and supplies the configured Starstone material drop.
8. Adding and removing a cable updates affected lamps without a world scan.
9. Joining powered and unpowered networks powers the merged network.
10. Splitting a network computes the state of each resulting component.
11. Saving and reopening the world reconstructs nearby networks.
12. A selected chunk-boundary scenario passes the explicit test in Milestone 7.
13. Redstone input maps supporting-block power `0` to off and `1..15` to on; redstone output maps off to `0` and on to `15` into its supporting block.
14. Ordinary operation does not tick every cable or force chunks to stay loaded.
15. `/scriptevent starstone:diagnose` reports useful bounded diagnostics without modifying the world.

## 4. Pack and code layout

Create files only as their task requires. Do not scaffold empty speculative modules.

```text
mods/starstone/starstone_bp/
  manifest.json
  README.md
  blocks/
    cable.json
    bridge.json
    conduit.json
    ore.json
    generator.json
    lamp.json
    redstone_input.json
    redstone_output.json
  items/
    dust.json
    crystal.json
    ore.json
  recipes/
  loot_tables/blocks/
  scripts/
    main.js
    constants.js
    blockKeys.js
    surfaceFrame.js
    cableTopology.js
    electricalBlocks.js
    networkGraph.js
    networkRuntime.js
    powerPropagation.js
    persistence.js
    chunkIndex.js
    redstoneAdapters.js
    repair.js
    diagnostics.js

mods/starstone/starstone_rp/
  manifest.json
  blocks.json
  textures/terrain_texture.json
  textures/item_texture.json
  textures/blocks/...
  textures/items/...
  models/blocks/starstone_cable.geo.json
  models/blocks/starstone_surface_device.geo.json
  models/blocks/starstone_bridge.geo.json
  texts/languages.json
  texts/en_US.lang

mods/starstone/tools/
  README.md
  docs/GRAPHICS.md
  art_source/...
  build_graphics.ps1
  validate-json.ps1
  generate-cable-permutations.mjs
  tests/
```

Keep `main.js` as composition only: register components and events, then call small modules. Game logic does not belong in one large file.

## 5. Data contracts

### 5.1 Block key and electrical node reference

Every runtime map uses this canonical string:

```text
<dimension-id>|<x>|<y>|<z>
```

Coordinates are block integers. Parsing and formatting live only in `blockKeys.js`. Never use a JavaScript object as a map key for a location.

A block position may contain more than one electrical node. Append a lane suffix to form the node reference used by graph maps:

```text
<BlockKey>#main
<BlockKey>#ns
<BlockKey>#ew
```

Ordinary cables, devices, sources, consumers, and conduits use `#main`. A bridge exposes exactly `#ns` and `#ew`; there is no edge between those lanes. Graph code must never use an unsuffixed `BlockKey` as an electrical node ID.

### 5.2 Cable states

Use the built-in placement trait state `minecraft:block_face` for the support face. Add two custom states:

```text
starstone:connections = integer 0..15
starstone:powered     = boolean
```

The four connection bits are local to the cable surface:

```text
1 = north arm
2 = east arm
4 = south arm
8 = west arm
```

These are names in the canonical cable model, not unconditional world directions. `surfaceFrame.js` is the only module that translates a mounting face plus a local arm into a world offset. The resource-pack transformation and the script translation table must use the same frame.

Do not store a network ID in block state. Network IDs are implementation details and may change after a split, reload, or repair.

An ordinary cable's connection masks exhaust the joined coplanar cases: 0 arms, 1 arm, 2 opposite arms, 2 adjacent arms (L), 3 arms (T), and 4 arms (intersection). The bridge is a separate block because a connection mask alone cannot express two non-joining lanes.

### 5.3 Surface-device, bridge, and conduit states

Lamp and both adapters use `minecraft:block_face`. The lamp uses the surface-device geometry and propagates through its four joined tangent ports. Adapters use a smaller transparent center-box-and-wire geometry. Their center arrow is a conversion emblem—red→blue for input, blue→red for output—not a world-space direction. Their powered/enabled state remains a single boolean. The generator is a full cube with `starstone:enabled`; its single joined source lane connects through all six faces to mounted cables or touching cable arms.

The bridge uses:

```text
starstone:powered_ns = boolean
starstone:powered_ew = boolean
```

The conduit uses:

```text
starstone:axis    = "x" | "y" | "z"
starstone:powered = boolean
```

All surface elements validate the supporting block at the inverse face normal. Cable/device back contact exists only when the support is a conduit whose axis matches that normal.

### 5.4 Device contract

`electricalBlocks.js` returns a descriptor for a block:

```js
{
  kind: "cable" | "bridge" | "conduit" | "source" | "consumer" | "adapter-in" | "adapter-out",
  mountFace: "up" | "down" | "north" | "south" | "east" | "west" | undefined,
  lanes: [
    {
      id: "main" | "ns" | "ew",
      ports: Set<"local_n" | "local_e" | "local_s" | "local_w" | "back" | "world_up" | "world_down" | "world_north" | "world_south" | "world_east" | "world_west">,
      sourceOn: boolean,
      powered: boolean
    }
  ]
}
```

Return `undefined` for unrelated blocks. A bridge returns two lanes; other electrical blocks return one. Keep block identifiers and state names in `constants.js`.

### 5.5 Runtime network

The loaded-world cache uses this conceptual shape:

```js
{
  id: number,
  nodes: Set<NodeRef>,
  sources: Set<NodeRef>,
  consumers: Set<NodeRef>,
  powered: boolean,
  unresolvedBoundaries: Set<BoundaryKey>
}
```

Keep separate maps from node to network ID and network ID to network. Power changes must not rebuild topology.

### 5.6 Mutation rule

All block permutation writes are deferred with `system.run(...)` when the originating callback may be in restricted execution. A permutation write that changes only `starstone:connections`, `starstone:powered`, `starstone:powered_ns`, or `starstone:powered_ew` must not be treated as a topology mutation. Add a guard so visual state updates cannot recursively rebuild the network.

## 6. How Ornith should execute this plan

Give Ornith one numbered task at a time. In each prompt:

1. Name the exact task number.
2. Tell it to read this plan, the proposal, and only the files named by the task.
3. Tell it to preserve unrelated files and current UUIDs.
4. Require it to run the task's checks.
5. Require a short handoff: files changed, checks run, result, and any deviation.
6. Stop after the acceptance criteria pass. Do not let it begin the next task in the same turn.

Use trust-and-escalate orchestration. A zero process exit plus a handoff beginning `STATUS: COMPLETE` is enough to close that ephemeral Ornith session and start a fresh session for the next numbered task. The orchestrator must not reread changed files or rerun checks after every successful task. Inspect the implementation only when Ornith exits nonzero, reports `STATUS: BLOCKED`, or omits/malforms the handoff. Review gates describe product milestones for Ornith/user testing; they do not automatically trigger a second model review. This keeps orchestration cheaper than implementation.

If a task fails in-game, give Ornith the Content Log excerpt and that task's files. Do not ask it to reread the whole repository. Checks should be the smallest task-specific checks already named by the task; do not add broad regression suites between steps.

Suggested prompt:

```text
Implement Task <number> from mods/starstone/docs/design/bedrock_stardust_implementation_plan.md.
Read mods/starstone/docs/design/bedrock_stardust_proposal.md and the files explicitly named in that task.
Keep the change limited to this task. Preserve UUIDs and unrelated work.
Run the listed checks. Report changed files, checks, result, and deviations, then stop.
```

## 7. Ordered implementation tasks

Each task should be independently reviewable. Do not combine tasks merely because they touch the same file.

### Milestone 0 — prove the environment

#### Task 0.1 — record the installed baseline

**Files:** existing pack manifests for reference; new `starstone_bp/README.md`; `mods/starstone/tools/compatibility.json`.

Record the installed game version if available, the known-good block format, the accepted stable `@minecraft/server` dependency, and whether Upcoming Creator Features is enabled. Record unknowns as unknown; do not invent values. Write the selected adapter implementation to `mods/starstone/tools/compatibility.json` as `{ "redstone_input_mode": "native" }` or `{ "redstone_input_mode": "polling" }` so orchestration can skip the unused alternative task without model review.

**Accept when:** the README contains a four-row compatibility table, explicitly chooses either native redstone consumer or adapter polling, and `compatibility.json` contains the same choice.

#### Task 0.2 — create pack manifests

**Files:** BP manifest, RP manifest.

Create unique UUIDs once. Add the script module and reciprocal BP/RP dependencies. Use the baseline from Task 0.1.

**Checks:** parse both as JSON; confirm all four module/header UUIDs are unique; confirm dependency UUIDs point to the opposite pack.

**Accept when:** both packs appear in Minecraft without a manifest Content Log error.

#### Task 0.3 — add the smallest script entry point

**Files:** `scripts/main.js`.

On `worldLoad`, log one namespaced activation line. Do nothing else.

**Accept when:** reopening a world writes exactly one Starstone activation line and no script error.

#### Task 0.4 — add local validation tools

**Files:** `mods/starstone/README.md`, `validate-json.ps1`.

The validator recursively parses Starstone BP/RP JSON and exits nonzero with the failing relative path. It must not rewrite files.

**Accept when:** it passes valid packs and fails against a temporary malformed JSON fixture in `temp/`.

### Milestone 1 — place one cable correctly

#### GRAPHICS Task G1 — prototype asset contract

Completed by Codex. Ornith should consume the existing assets and preserve the documented bone/material names.

Create:

- a 32×32 unpowered cable texture;
- a 32×32 powered/emissive-looking cable texture;
- one block geometry with bones named `center`, `arm_n`, `arm_e`, `arm_s`, and `arm_w`;
- item icons for cable, dust, crystal, ore, flat devices, bridge, and conduit.

The canonical geometry lies on the bottom boundary of its block cell, centered on the block, with north/east/south/west arms. Keep all cable geometry inside the block bounds. Visual polish is explicitly deferred.

**Accept when:** Blockbench or Minecraft can render all five bones and the filenames match the resource registry.

#### Task 1.1 — register placeholder resources

**Files:** RP `blocks.json`, texture atlases, language files, G1 assets.

Register only the cable. Use `alpha_test` if the asset needs transparency. Use clear English names.

**Accept when:** the cable has a non-missing inventory icon and no purple/black missing texture in world.

#### Task 1.2 — define the cable block and placement trait

**Files:** `blocks/cable.json`, cable loot table.

Add `minecraft:placement_position` with `minecraft:block_face`, the two custom states from section 5.2, thin selection/collision boxes, sensible mining time, and a loot table. Bind a custom component identifier but give it no behavior beyond logging placement in this task.

**Accept when:** `/give @s starstone:cable` works and placement on each of six faces records the expected `minecraft:block_face` value.

#### Task 1.3 — register the cable custom component

**Files:** `scripts/main.js`, new minimal cable component module.

Register during `system.beforeEvents.startup`. Implement `onPlace` and `onPlayerBreak` with namespaced debug logs. Do not build a graph yet.

**Accept when:** each callback fires once for its action and changing a cable permutation does not print a placement log.

#### Task 1.4 — implement the surface-frame table

**Files:** `surfaceFrame.js`, `mods/starstone/tests/surfaceFrame.test.mjs`.

For all six mounting faces, map the four local arms to four unique tangent world offsets. Also expose the support offset, which is the inverse of the outward face normal. Use pure data/functions with no Minecraft imports.

**Checks:** for every face, the four arm vectors are unit length, unique, perpendicular to the face normal, and have opposites in north/south and east/west pairs.

**Accept when:** the Node test passes and contains six explicit expected mappings. The RP transformation table must later be checked against this file.

#### Task 1.5 — orient cable geometry for six faces

**Files:** `blocks/cable.json` permutations only.

Use `minecraft:transformation` conditions on `minecraft:block_face` to place the canonical geometry on floor, ceiling, and four walls. Use the following already-derived rotations, which preserve the face-local arm convention from Task 1.4: `up` `[0, 0, 0]`, `down` `[180, 0, 0]`, `south` `[90, 0, 0]`, `north` `[90, 180, 0]`, `east` `[90, 90, 0]`, and `west` `[90, -90, 0]`. The default center pivot keeps the thin geometry inside its block cell. Do not research alternative rotation schemes and do not alter connection visibility yet.

**Accept when:** six isolated cables sit flush with their support surfaces, face outward, and stay inside their own block cells.

#### Task 1.6 — enforce support

**Files:** cable component module and a small support helper.

After placement, validate the block at the support offset. Add handling for a player breaking a support block by examining only its six adjacent positions. Drop the cable once and replace it with air if support becomes invalid. Put this in a reusable helper because bridges, lamps, and adapters have the same rule.

**Accept when:** a cable cannot remain floating after placement or after its support is broken; unrelated nearby blocks are unchanged.

### Milestone 2 — local cable topology and visuals

#### Task 2.1 — implement cable neighbor rules

**Files:** `cableTopology.js`, pure tests.

Given a cable mounting face and four neighboring descriptors, return the 0..15 connection mask. For the prototype, connect only when the neighbor has a reciprocal port on the same surface. A bridge exposes only the matching lane at each side. A conduit is reached through the separate back-contact rule, not a tangent mask bit.

**Accept when:** pure tests cover isolated, endpoint, straight, L/elbow, T, joined intersection, bridge-lane contact, different-face rejection, and reciprocal device port checks.

#### Task 2.2 — update one cable mask

**Files:** cable component module, `cableTopology.js` integration.

Read the four tangent neighbor blocks, compute the mask, and update only `starstone:connections` while preserving mounting face and powered state.

**Accept when:** placing one adjacent coplanar cable updates the new cable's mask correctly.

#### Task 2.3 — update affected neighbor masks

**Files:** cable component module.

After cable placement or removal, schedule updates for the changed position and at most the eight positions that can be affected under the same-face prototype rules. Deduplicate locations within a tick.

**Accept when:** both ends update after place/break, including a T becoming a corner and a cross becoming a T.

#### Task 2.4 — generate connection permutations

**Files:** `generate-cable-permutations.mjs`, generated section of `blocks/cable.json`.

Generate the 16 connection-mask geometry visibility mappings. The generated output must be deterministic and clearly delimited in the block JSON or emitted as a reviewable snippet that Ornith applies. Never hand-maintain 16 repetitive mappings.

**Accept when:** two consecutive generator runs produce identical output and every mask shows `center` plus exactly the arms represented by its bits.

#### Task 2.5 — render all connection shapes

**Files:** cable block permutations and resource geometry references.

Combine mounting-face transformation with connection-mask bone visibility. Avoid duplicating geometry files for every shape. Bedrock explicitly supports `bone_visibility` inside the `minecraft:geometry` block component, including Molang expressions using `query.block_state()` since 1.20.10. Use `geometry.starstone_cable` and make `center` visible while each of `arm_n`, `arm_e`, `arm_s`, and `arm_w` is driven by the corresponding bit of `starstone:connections` (explicit value membership expressions are acceptable). If geometry with `bone_visibility` appears in permutations, also provide a default `minecraft:geometry` component with `bone_visibility` in the base `components`. For format 1.21.80+, pair `minecraft:geometry` with `minecraft:material_instances`. The official reference is `https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_geometry`.

**Accept when:** floor and wall test boards show isolated, endpoint, straight, L/elbow, all four T rotations, and the joined four-way intersection correctly; ceiling orientation matches the surface-frame contract.

#### Task 2.6 — add the two-lane bridge block

**Files:** `blocks/bridge.json`, bridge loot/resource registration, `models/blocks/starstone_bridge.geo.json` integration.

Create a surface-mounted bridge using the same `minecraft:block_face` mounting/support rules as cable. Add `starstone:powered_ns` and `starstone:powered_ew`. Bind `lane_ns` and `lane_ew` independently to the same transparent narrow-wire `starstone:cable_off` and `starstone:cable_on` textures as ordinary cable. Both lanes use the same dim-off and bright blue/cyan-on treatment; the low lane is occluded only directly beneath the raised center overpass, never darkened as a whole. The block always exposes local N/S ports on lane `ns` and E/W ports on lane `ew`.

**Accept when:** all four arms render, one lane is visibly raised, and all four off/on combinations display without one lane changing the other.

#### Task 2.7 — prove bridge lane isolation

**Files:** `electricalBlocks.js`, graph neighbor tests.

Return two `NodeRef`s for one bridge block and never add an internal edge between them. Connect each neighboring cable only to its matching lane.

**Accept when:** two generators feeding perpendicular lines through one bridge can independently produce off/off, on/off, off/on, and on/on at two distant lamps.

### Milestone 3 — source, consumer, and discovery

#### GRAPHICS Task G2 — device placeholders

Completed by Codex. The generator uses a full cube presentation. The lamp currently uses the shared flat surface-device geometry with clearly different off/on textures; both flat and cubic lamp concepts remain available for the final choice.

#### Task 3.1 — add generator block

**Files:** generator block JSON, loot, RP registrations, language.

Create a full-cube source with custom boolean state `starstone:enabled`, default true. It exposes a joined contact on all six faces; a surface cable mounted directly on any face connects through its back contact. Use the generator face texture with the dark casing, full-block selection/collision, and no mounting-face state or support helper. Add an interaction component that toggles it for testing.

**Accept when:** interaction toggles state once and the Content Log remains clean.

#### Task 3.2 — add lamp block

**Files:** lamp block JSON, loot, RP registrations, language.

Create a thin surface-mounted consumer with `minecraft:block_face`, the shared surface-device geometry, and `starstone:powered`. It has four joined tangent ports, propagates Starstone signal through that joined lane, and uses the shared support helper. Use permutations for off/on material and light emission. Do not connect it to a graph yet.

**Accept when:** a debug command or temporary script state change visibly switches the lamp and light level.

#### Task 3.3 — centralize electrical block descriptors

**Files:** `constants.js`, `electricalBlocks.js`, pure tests where possible.

Implement the descriptor contract from section 5.4. Cables expose their current world-space tangent ports; the flat lamp exposes four joined tangent ports; the full generator exposes joined contacts on all six faces. Bridge exposes two lanes. A matching conduit or generator support adds a back-contact neighbor.

**Accept when:** descriptors contain no `Block` object, all identifiers occur in `constants.js`, and reciprocal port tests pass.

#### Task 3.4 — add the pass-through conduit block

**Files:** `blocks/conduit.json`, loot/resource registration, `electricalBlocks.js`.

Create a full block with `starstone:axis = x|y|z` and `starstone:powered`. Its two axis end faces use `starstone:conduit_end`; other faces use `starstone:casing`. It exposes two opposite world-space ports joined as one `main` lane. A surface element mounted on either matching end face connects through its back contact.

**Accept when:** a generator connected at one conduit end powers a lamp at the opposite end, perpendicular faces do not connect, and rotating the conduit covers all three axes.

#### Task 3.4A — convert the generator to a full block

**Files:** generator block JSON, generator resource registration/item icon, `electricalBlocks.js`, focused descriptor tests.

Replace the already-created flat generator with the full-cube contract from Task 3.1. Remove `minecraft:block_face`, surface transformations, thin selection/collision, shared surface-device geometry, and support-drop behavior from the generator. Use a full cube with the generator face/casing art and keep `starstone:enabled` plus its test interaction. Update electrical descriptors so the generator has one joined source lane with contacts on all six world faces. A surface cable mounted directly on a generator gains a reciprocal back contact, and a cable arm occupying an adjacent block connects when it touches a generator face. Confirm the lamp descriptor remains a joined conducting consumer rather than a leaf. Do not change the lamp's visual form in this task.

**Accept when:** the generator renders and collides as a full block; its cube item icon is registered; focused pure tests show mounted and side-touching cables can connect on each of six faces, all generator contacts belong to one source lane, and a lamp can receive on one tangent port and propagate through another.

#### Task 3.5 — implement bounded component discovery

**Files:** `networkGraph.js`.

Implement a generator-based breadth-first or depth-first traversal from one seed. Visit only loaded locations and only reciprocal electrical edges. Yield regularly through `system.runJob()`. Return nodes, sources, consumers, and unresolved boundary edges.

**Accept when:** a 1,000-cable test traversal completes without watchdog termination and unrelated blocks are never added.

#### Task 3.5A — resolve support back contacts in graph traversal

**Files:** `networkGraph.js`, a small pure port-direction helper if needed, and focused pure tests.

Adapt the completed graph walker to the full-cube generator and existing conduit back-contact contract. Resolve a surface descriptor's `back` port to `supportOffset(mountFace)` instead of passing `back` to `worldOffset()`. Continue resolving `world_*` ports without a mounting face so the generator's six absolute contacts work. Keep this direction logic pure and importable without `@minecraft/server`; extract the helper from `networkGraph.js` if that is the smallest way to test it. Do not change discovery scheduling, runtime indexes, or block state in this repair task.

**Accept when:** focused pure tests prove reciprocal graph directions for (1) a cable mounted directly on every generator face, (2) a cable arm in an adjacent block touching every generator face, and (3) a surface cable backed by a matching conduit. Absolute generator ports must remain one joined source lane, and `back` must never be passed to `worldOffset()`.

#### Task 3.5B — repair cable shapes, support rules, and held item

**Files:** `cableComponent.js`, `support.js`, a small pure support-policy helper/test if useful,
the cable block/loot JSON, and a cable placement-item JSON/text entry.

Repair the two invalid Script API calls in the placement prototype. Read block state from
`block.permutation`, write `starstone:connections` with
`block.permutation.withState(...)`, and preserve every unrelated state. A newly placed pair
of coplanar cables must update from the isolated center to reciprocal arms, and breaking one
must remove the surviving cable's stale arm.

Replace the nonexistent solid-type query with a load-safe support check. Air and liquid are
never supports. For a single slab, allow mounting only on its full outer horizontal face:
top of a top slab or underside of a bottom slab. Reject the top of a bottom slab, underside
of a top slab, and all four side faces of a single slab. Double slabs remain full supports.
Apply the equivalent rule to stairs: allow the top of an upside-down stair and the underside
of a normal stair, but reject stair side faces. Reject other known partial supports (fences,
walls, panes/bars, doors/trapdoors, buttons, pressure plates, rails, carpets, signs, torches,
chests, hoppers, scaffolding, plants and snow layers) until they have an explicit visual rule.
Do not invent half-cell side connectivity in this repair; it needs a separate position state,
geometry, and graph model. Keep the policy in a small pure helper so additional shapes can be
added without mixing them into event code.

Give players a normal 2D held representation without experimental item-visual features:
hide the block's generated item from Creative, add `starstone:cable_item` with the existing
`starstone_cable` icon and `minecraft:block_placer`, and make cable loot return that item.
Display it as “Starstone Cable”.

**Accept when:** minimal pure checks cover the slab face policy; script syntax passes; the
Bedrock validator passes; in game, two adjacent floor cables render a straight joined line,
removing one clears the other arm, invalid single-slab placements do not survive, and the
Creative cable item is the 2D icon rather than the surface geometry floating in space.

### Milestone 4 — binary power

#### Task 4.1 — create the runtime indexes

**Files:** `networkRuntime.js`.

Own `nodeToNetwork`, `networks`, ID allocation, and reset/debug accessors. No block mutation belongs here.

**Accept when:** pure tests can add/remove networks, every `NodeRef` belongs to at most one runtime network, and one bridge block can legally contribute two nodes to different networks.

#### Task 4.2 — register one discovered network

**Files:** `networkRuntime.js`, orchestration in `main.js` or a small controller.

Discover from an explicit seed and replace overlapping cached networks with the result. Compute `powered = any(sourceOn)`.

**Accept when:** a generator-cable-lamp line produces one runtime network containing the expected nodes.

#### Task 4.3 — apply power to cables, bridge lanes, conduits, and lamps

**Files:** `powerPropagation.js`.

Update only blocks whose applicable powered state differs. Ordinary blocks use `starstone:powered`; bridges update `starstone:powered_ns` and `starstone:powered_ew` independently. Spread writes over ticks with a job/queue. Preserve all unrelated states. Skip unloaded locations and leave them pending for reconciliation.

**Accept when:** toggling a generator changes every loaded cable and lamp once; toggling it without a state change writes nothing.

#### Task 4.4 — merge networks after addition

**Files:** network controller/runtime.

When a cable or device is added, discover from the new node, collect every touched cached network, and replace them with one component. Do not rebuild unrelated networks.

**Accept when:** bridging two networks produces one network, and bridging to a powered network turns the result on.

#### Task 4.5 — split a network after removal

**Files:** network controller/runtime.

Before removal loses its state, capture its key and cached network. Remove the node, then discover from each still-valid former neighbor, restricted to nodes from the old network plus newly discovered loaded nodes. Register each distinct component and recompute power.

**Accept when:** removing the center of a powered line leaves the generator side on and the lamp-only side off; a loop with one cable removed remains one network.

#### Task 4.6 — react to generator toggles without rebuilding topology

**Files:** generator component/controller.

Update source state and recompute only the containing network's `powered` value. Apply power only if the value changed.

**Accept when:** logs show zero topology traversals for repeated generator toggles.

### Milestone 5 — reload and bounded reconstruction

#### Task 5.1 — add diagnostics commands

**Files:** `diagnostics.js`, event registration.

Implement:

- `/scriptevent starstone:diagnose` — counts cached networks/nodes/jobs and describes the targeted electrical block;
- `/scriptevent starstone:rebuild_nearby` — starts a bounded rebuild around the invoking player;
- `/scriptevent starstone:debug on|off` — toggles concise logs in a world dynamic property.

Reject concurrent rebuild jobs cleanly.

**Accept when:** commands give bounded output and diagnose never changes blocks.

#### Task 5.2 — implement nearby discovery job

**Files:** `repair.js`.

Scan a configured cuboid around one player via `system.runJob()`, seed discovery only from Starstone blocks, and deduplicate components. Default radius must be conservative and documented.

**Accept when:** reopening a world and running `rebuild_nearby` restores an existing generator/cable/lamp network without watchdog errors.

#### Task 5.3 — rebuild automatically on initial player spawn

**Files:** event registration and `repair.js`.

On initial spawn, schedule one nearby rebuild per dimension/player area, deduplicated by chunk. Do not scan for every respawn.

**Accept when:** save/reopen near a test network restores lamp state automatically once.

#### Task 5.4 — persist the minimal placement index

**Files:** `persistence.js`, mutation controller.

Persist schema version plus per-dimension/per-chunk lists of known Starstone block positions. Shard properties by chunk; do not serialize the whole world into one string. Update the index on known placement/removal events. Treat it as an index to validate against blocks, never as truth.

**Accept when:** restart restores the index, one corrupt shard is ignored with one clear warning, and stale entries disappear during validation.

### Milestone 6 — mutation coverage and repair

#### Task 6.1 — handle explosions

**Files:** event registration and topology controller.

Use block explosion events to collect affected Starstone locations and supports, then process one deduplicated batch after the explosion.

**Accept when:** an explosion removing several cables results in correct shapes and network states with one batched rebuild.

#### Task 6.2 — handle pistons

**Files:** event registration and topology controller.

Observe piston activation, snapshot relevant Starstone positions before/after as the available API permits, and reconcile only the affected bounding area. If custom blocks are immovable in the chosen block definitions, explicitly test and document that behavior instead.

**Accept when:** the documented piston policy matches in-game behavior and creates no stale cache entries.

#### Task 6.3 — validate known positions periodically

**Files:** `repair.js`, `persistence.js`.

Use a slow round-robin budget to validate a small number of indexed positions per interval. Repair masks/cache for loaded positions; skip unloaded chunks. Make budgets constants and expose them in diagnostics.

**Accept when:** validation work has a hard per-interval cap and repairing a command-replaced cable does not scan a volume.

### Milestone 7 — chunk boundaries

This milestone is a separate architecture gate. Do not claim unloaded-chunk continuity after only testing two adjacent loaded chunks.

#### Task 7.1 — define the chunk-segment schema

**Files:** `chunkIndex.js`, README schema section; no behavior changes.

For each dimension/chunk, define persisted segment records containing schema version, stable local segment key, member-position list or compact local index, source summary, and boundary ports. A boundary port identifies the exact source position, direction, and destination chunk. Store enough information to reconnect segments without reading the unloaded chunk.

**Accept when:** example JSON covers a straight crossing, two independent networks crossing the same chunk, and a T-junction inside a chunk.

#### Task 7.2 — build segments for one loaded chunk

**Files:** `chunkIndex.js`, pure graph helpers.

From validated indexed positions in one loaded chunk, compute local connected components and their boundary ports. Persist atomically by writing the new shard before replacing its version pointer, or use another documented recoverable scheme.

**Accept when:** tests distinguish two separate segments and reproduce identical stable keys from unchanged blocks.

#### Task 7.3 — build the persistent segment graph

**Files:** `chunkIndex.js`, a new small segment-graph module if needed.

Join reciprocal boundary ports. Compute logical networks over loaded and unloaded segment metadata. Do not access a block in an unloaded chunk.

**Accept when:** a three-chunk fixture can connect chunk A to C through unloaded metadata for B, while a missing reciprocal port remains unresolved rather than connected.

#### Task 7.4 — reconcile newly observed chunks

**Files:** chunk observer/controller.

There is no general block chunk-load event. Poll player chunk coordinates at a slow interval, detect newly observed loaded chunks, and queue indexed-position validation plus segment rebuilding. Deduplicate across players. Also recheck unresolved boundaries when their destination becomes loaded.

**Accept when:** walking across a chunk border schedules each newly observed chunk once and standing still produces no repeated rebuild.

#### Task 7.5 — handle logical power through unloaded segments

**Files:** segment graph and power controller.

Persist each logical network's current binary power result or enough source summaries to recompute it from segment metadata. When a loaded source changes, update affected logical components and persist before applying consumer visuals. When blocks later load, apply the latest logical state.

**Accept when:** source changes made while the distant lamp chunk is unloaded are reflected when that lamp chunk loads.

#### Task 7.6 — pass the real unloaded-middle test

Build a cable across at least three chunks: generator in A, middle route in B, lamp in C. Arrange simulation distance or player positions so A and C can be observed while B is confirmed unloaded with `Dimension.isChunkLoaded()`.

Test:

1. Confirm all three loaded and powered.
2. Unload B and confirm the script reports B as unloaded.
3. Change the source state without forcing B to load.
4. Confirm the logical state is retained.
5. Load C and confirm the lamp receives the current state.
6. Reload B and confirm segment metadata reconciles without duplicating networks.

**Accept when:** the exact observations and diagnostic output are saved in the README. If the game cannot keep A and C loaded while B is unloaded under normal simulation rules, document the limitation and run the equivalent save/unload/load sequence; do not fabricate success.

### Milestone 8 — redstone adapters

#### GRAPHICS Task G3 — adapter assets

Completed by Codex. Both adapters are thin center boxes with four short symmetric blue wire contacts and transparent space showing the support block. The input center shows red→blue conversion; the output center shows blue→red. The small arrow is confined to the conversion emblem and does not imply a world-space direction.

#### Task 8.1 — define support-facing adapters

**Files:** both adapter block JSON files, resource registrations, language, loot.

Use `minecraft:block_face`, `geometry.starstone_adapter`, four joined tangent Starstone ports, transparent/alpha-capable materials, and the shared support rule. The redstone interface is always the support face behind the box, so no in-plane placement direction is required; the face arrow describes red↔blue conversion only. Add a boolean powered state. Document the face convention in `README.md` and use `transform_relative` for redstone faces where supported.

**Accept when:** input and output panels mount correctly on all six faces, connect to coplanar Starstone cable on any tangent side, and consistently identify the support block as their redstone target/source.

#### Task 8.2 — implement electricity-to-redstone

**Files:** output adapter JSON/controller.

Use `minecraft:redstone_producer`: off permutation produces 0, on permutation produces 15, limited to the face touching the supporting block. A Starstone network update controls the adapter's powered state.

**Accept when:** the adapter strongly powers its supporting block at 15 when on and 0 when off, including wall and ceiling mounting, without energizing unrelated faces unexpectedly.

#### Task 8.3A — implement native redstone-to-electricity

Use this task only if Task 0.1 confirmed native consumer support under the chosen experiment policy.

**Files:** input adapter JSON, component registration/controller.

Add `minecraft:redstone_consumer` at the block's top-level components and implement `onRedstoneUpdate`. Confirm the event represents power from the supporting block; if it cannot be face-limited reliably, read `getRedstonePower()` from the support location inside the callback. Convert support power `> 0` to source on. The component is not placed in permutations.

**Accept when:** power transitions `0→1`, `15→0`, and `1→15` yield binary states off→on, on→off, and no topology/power change respectively.

#### Task 8.3B — implement polling redstone-to-electricity fallback

Use this task instead of 8.3A if native consumer support is unavailable.

**Files:** `redstoneAdapters.js`, persistence/index integration.

Maintain a set of loaded input adapter keys. Every 4 ticks, resolve and read only each adapter's supporting block, skip unloaded chunks, and compare `getRedstonePower()` to the cached binary value. Remove stale keys safely.

**Accept when:** the same transition tests as 8.3A pass and diagnostics show the number of polled adapters; cable count does not affect polling work.

### Milestone 9 — materials and survival content

Do this after the technical prototype, because recipes and progression do not reduce architecture risk.

#### Task 9.1 — add Dust and Crystal items

**Files:** item JSON, RP item registry, language; G1/G4 icons.

Add simple stackable items with stable internal IDs. No world generation yet.

**Accept when:** both can be given, stored, dropped, and displayed without missing textures.

#### Task 9.2 — add mineable Starstone Ore

**Files:** `blocks/ore.json`, ore loot table, RP registrations, language.

Create the full ore block using the supplied texture. Use a stone/deepslate-appropriate mining time and require an iron-tier or better pickaxe. Default drop behavior: 2–4 Starstone Dust, affected by Fortune, with the ore block dropping itself under Silk Touch. Keep drop counts in the loot table so balance can change without script code.

**Accept when:** hand-placed ore requires the intended tool, drops nothing with an invalid tool, follows the Dust/Fortune range with a valid tool, and drops itself with Silk Touch.

#### Task 9.3 — implement Starstone Ore world generation

**Files:** BP features/feature rules and README balance table.

Add rare Overworld underground generation. Initial tuning target for testing: replace stone and deepslate, Y -64 through 16, vein size 2–5, approximately two placement attempts per chunk, and reduced air exposure. Keep all frequency/height values easy to edit and label them as tuning values.

**Accept when:** new chunks produce ore in the configured height range, existing chunks are unchanged, veins replace only intended blocks, and a documented sample search finds a plausible rare distribution.

#### Task 9.4 — choose and implement prototype recipes

First write the proposed recipes in the README for review. Default placeholder progression if no user decision exists:

- Starstone Dust + copper ingot → Starstone Cable;
- compressed Starstone Dust + amethyst shard → Starstone Crystal;
- Crystal + copper/iron components → generator and adapters.

Treat these ingredients and counts as balance placeholders. Implement only after approval of the recipe table.

**Accept when:** recipe JSON parses, crafting results use the correct identifiers/counts, and no recipe unintentionally conflicts with a vanilla shape.

Ore is the primary acquisition route. Recipes should consume mined Starstone materials rather than allowing redstone and amethyst alone to bypass mining. If a renewable late-game route is desired later, plan it as a separate balance feature.

### Milestone 10 — hardening and release candidate

#### Task 10.1 — build a repeatable manual test world checklist

**Files:** BP README.

Document exact builds for six-face placement of every surface device, each joined cable shape, isolated bridge lanes, all conduit axes, merge, split, loop split, multiple sources, reload, ore mining, explosion, piston policy, redstone-through-support transitions, and chunk test. Include expected diagnostics.

**Accept when:** another person can reproduce every scenario without reading source code.

#### Task 10.2 — add graph algorithm tests

**Files:** `mods/starstone/tests/`.

Test pure topology and segment graph code outside Minecraft: line, L, T, joined intersection, isolated crossover lanes, conduit back contacts, branch, loop, merge, bridge-block removal, articulation removal, two sources, no source, reciprocal boundaries, and stale metadata. Avoid mocks of the entire Minecraft API.

**Accept when:** tests catch a deliberately introduced wrong edge or split and pass after it is reverted.

#### Task 10.3 — stress test with measured budgets

Test at least 1,000, 5,000, and 10,000 cable nodes. Record topology rebuild ticks, power-only update ticks, maximum queued writes, dynamic-property byte count, and any watchdog/content-log messages. Use `runJob()` and bounded queues to stay responsive.

**Accept when:** results are written to the README and any observed safe limit is stated honestly.

#### Task 10.4 — remove temporary debug behavior

Disable placement spam by default, remove temporary state-switch commands used only by early tasks, retain bounded diagnose/repair commands, and ensure player-facing strings are localized.

**Accept when:** a fresh normal play session produces no unsolicited chat and no Content Log warnings/errors attributable to Starstone.

#### GRAPHICS Task G4 — final art pass

After behavior and state contracts are frozen, replace placeholders with final cyberpunk/neon art:

- off cable, powered cable, optional emissive/PBR maps;
- Dust and Crystal icons;
- full generator, flat lamp, flat support-facing adapter, bridge, conduit, and ore models/textures;
- pack icons.

Do not rename geometry bones, texture keys, or identifiers during this pass. Test readability on floor, wall, and ceiling in bright and dark environments.

## 8. Explicit non-goals for the first release

- Analog 0–15 internal power.
- Reimplementation or replacement of vanilla redstone wire.
- Arbitrary multiple surface elements sharing one block cell beyond the bridge's fixed two isolated lanes.
- Wireless power.
- Per-cable entities or per-cable ticks.
- Forced chunk loading.
- Arbitrary surface-edge wrapping before coplanar topology is stable.
- A configuration UI.

## 9. Review gates

Stop and review after these tasks:

| Gate | Review question |
|---|---|
| 1.6 | Is six-face placement pleasant and predictable? |
| 2.7 | Are joined shapes correct on every face, and are bridge lanes truly isolated? |
| 3.4 | Does the conduit pass power only through its selected axis? |
| 4.6 | Are merge, split, and binary propagation correct in loaded chunks? |
| 5.4 | Does reload recovery work without broad recurring scans? |
| 7.6 | Is unloaded-middle continuity real, or should the documented promise be narrowed? |
| 8.3 | Does the chosen redstone input mode work on the installed Bedrock version? |
| 9.3 | Is Starstone Ore distribution rare but discoverable? |
| 9.4 | Are names and crafting progression ready to become player-facing? |
| 10.3 | Are measured limits acceptable for release? |

The most likely redesign point is Gate 7.6. Keep chunk-segment persistence isolated from the loaded-network runtime so failure there does not invalidate the playable loaded-chunk prototype.

## 10. Open product choices that do not block coding

These can remain undecided through Milestone 8:

- final display name: Starstone, Stardust, Starstone Current, or another title;
- whether the cable is called Starstone Cable, Starwire, or Neon Conduit;
- crafting costs and whether materials are renewable;
- whether edge-wrapping cable is required for the first release;
- whether native redstone consumer support is worth an experimental toggle on the installed game version.

Internal IDs should remain stable even if display names change.
