# Bedrock Electricity / Neon Wiring Add-On — Research & Proposal

## Goal

Create a Bedrock Add-On that replaces the *wiring* role of redstone with a separate, binary electrical network:

- Wall-, floor-, and ceiling-mountable glowing cables.
- Cyberpunk/electrical/neon visual style.
- Automatic cable connections and junction geometry.
- **Electricity is binary:** ON/OFF, no 0–15 internal signal strength.
- Bidirectional adapters to vanilla redstone:
  - Redstone → Electricity: redstone > 0 = ON.
  - Electricity → Redstone: OFF = 0, ON = 15.
- Do **not** attempt to modify/reimplement vanilla redstone itself.

The exact name of the system is not decided yet.

## Key Bedrock API Findings

Current Bedrock Creator APIs provide useful support for this:

- Custom block components can react to `onPlace`, `onBreak`, interaction, etc.
- Custom blocks can have states/permutations and custom geometry/materials.
- Placement supports the six block faces; placement traits can expose placement face/direction.
- `minecraft:redstone_producer` allows custom blocks to produce vanilla redstone power and specify connected faces.
- `minecraft:redstone_consumer` allows custom blocks to receive vanilla redstone updates.
- `Block.getRedstonePower()` can query vanilla redstone power.
- `Dimension.isChunkLoaded()` distinguishes loaded/unloaded chunks; block lookup cannot inspect unloaded chunks.
- `system.runJob()` can spread expensive graph traversal/work across ticks.

Primary official documentation:
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/blockcustomcomponent
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_redstone_producer
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_redstone_consumer
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/block
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/system
- https://learn.microsoft.com/en-us/minecraft/creator/documents/intro-block-traits

## Proposed Architecture

### 1. Cables are blocks, not entities

A cable occupies a normal Minecraft block position but has thin custom geometry attached to a selected surface.

It should support:

- floor
- ceiling
- all four walls

Connection geometry should be derived from adjacent cable blocks:

- endpoint
- straight
- corner
- T-junction
- cross
- vertical connections

Avoid creating an entity per cable.

### 2. Separate topology from power state

The world blocks are the source of truth. Runtime script data is only a cache/optimization.

Conceptually:

```text
Cable block
    ↓
local topology

ChunkNetworkSegment
    ↓
boundary connections

Network
    ↓
powered = ON/OFF
sources
consumers
```

Topology changes only when cables are placed/removed or otherwise modified. Power changes should not require rebuilding the topology.

### 3. Binary electricity

A connected network is:

```text
powered = any(source is ON)
```

All consumers attached to that network receive ON/OFF.

Do not simulate redstone attenuation or 0–15 power internally.

This deliberately gives the system a simpler mental model than vanilla redstone.

## Chunk Boundary / Unloaded Chunk Design

This is important.

Do **not** require the entire electrical network to remain loaded or ticking.

Treat unloaded chunks as an unresolved continuation of a network rather than as a broken circuit.

Example:

```text
Loaded chunk       Unloaded chunk       Loaded chunk

═══════●══════════════╪══════════════════●══════
                      │
```

The network can retain logical state (`ON/OFF`) without having every cable block loaded.

Recommended model:

```text
Network #42
  powered: ON

  ChunkSegment A
    cables...
    boundary → B

  ChunkSegment B
    currently unloaded

  ChunkSegment C
    cables...
```

When a chunk loads:

1. Discover nearby electrical blocks.
2. Reconstruct its local cable topology.
3. Resolve boundary connections.
4. Merge/reconnect to the existing logical network.
5. Apply the network's current ON/OFF state.

When it unloads:

1. Discard local runtime cache.
2. Keep the logical network state / boundary information.
3. Do not use ticking areas merely to keep the electrical network alive.

A huge cable network should therefore remain logically functional without loading thousands of blocks.

## Network Changes

Normal player placement/removal:

```text
place/break cable
    ↓
inspect six neighbors
    ↓
update local topology
    ↓
merge or split networks if necessary
```

Network splitting is important when a cable/junction is removed.

Unexpected block modification (commands, explosions, structures, pistons, etc.) may require periodic validation/self-healing because the Script API does not provide a universal callback for every possible block mutation.

Avoid scanning every cable every tick.

## Redstone Compatibility

Use explicit adapters rather than trying to replace vanilla redstone.

### Redstone → Electricity

A custom consumer block receives vanilla redstone updates:

```text
vanilla redstone
      │
      ▼
[redstone → electricity]
      │
      ║
      ║ electrical cable
      ║
      ▼
   consumer
```

Rule:

```text
redstone > 0 → ON
redstone = 0 → OFF
```

### Electricity → Redstone

A custom producer block:

```text
generator
    ║
    ║ electricity
    ║
[electricity → redstone]
    │
    ▼
vanilla redstone machinery
```

Rule:

```text
OFF → redstone 0
ON  → redstone 15
```

This provides compatibility with existing vanilla pistons, lamps, doors, etc., without requiring the new system to reproduce all vanilla redstone behavior.

## MVP Proposal

Implement in this order:

1. **Single cable block**
   - Place on six faces.
   - Custom thin/neon geometry.
   - Automatic straight/corner/T/cross connections.

2. **Simple power source**
   - Battery/generator block.
   - Produces ON.

3. **Simple consumer**
   - Lamp/block that visually responds to ON/OFF.

4. **Network graph**
   - Connected cable components.
   - Network ON/OFF propagation.
   - Correct network merging/splitting.

5. **Chunk-boundary handling**
   - Loaded/unloaded chunk separation.
   - Boundary continuation.
   - Reconnect on chunk load.
   - No ticking-area dependency.

6. **Redstone adapters**
   - Redstone → Electricity.
   - Electricity → Redstone.

7. **Stress testing**
   - Large networks.
   - Networks crossing many chunks.
   - Chunk unload/reload.
   - Network splits/merges.
   - Commands/explosions/pistons where relevant.

## Design Principles

- Do not fight the vanilla redstone engine.
- Do not use entities for cables.
- Do not tick every cable.
- Do not keep chunks loaded just for electricity.
- Keep topology and power state separate.
- Treat the world blocks as authoritative state.
- Keep runtime graph data reconstructable.
- Prefer event-driven updates; use periodic validation only as a safety net.
- Keep the electrical system deliberately simpler than redstone.

## First Technical Experiment

Before implementing the full system, prototype only:

1. A wall-mountable cable block.
2. Automatic detection of adjacent cables.
3. Runtime connection graph.
4. Correct visual permutation for straight/corner/T/cross.
5. A binary ON/OFF source and consumer.
6. Disconnect/reconnect behavior.
7. A cable network crossing an unloaded chunk boundary.

If this prototype works reliably, the rest of the Add-On should be straightforward incremental implementation rather than fighting Bedrock's engine.
