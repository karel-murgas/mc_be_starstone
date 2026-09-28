# Redstone adapter API and behavior

The selected input mode is polling (`mods/starstone/tools/compatibility.json`). The
pack declares block format 1.21.120 and `@minecraft/server` 2.8.0. A native
`minecraft:redstone_consumer` is not used on this baseline.

## Output

`minecraft:redstone_producer` supplies power 0 or 15. Its `connected_faces`
contains all six faces so directly touching redstone components can receive
power. `strongly_powered_face` remains canonical `down`, the mounting support.
`transform_relative: true` rotates that support face with the adapter on walls
and ceilings. The output uses the same producer fields in its powered and
unpowered permutations. The official [producer component reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_redstone_producer?view=minecraft-bedrock-stable)
defines these fields for format 1.21.120.

## Input

Every four ticks, polling visits only registered input-adapter positions. It
reads `Block.getRedstonePower()` from at most six touching loaded blocks,
including the mounting support. Any positive level is a binary Starstone source.
An unavailable neighbor cannot falsely turn an existing source off unless a
loaded neighbor is positively powered; otherwise the previous state is kept
until the next poll. A change from level 1 to level 15 causes no extra network
transition. The API signature is `number | undefined` in the selected 2.8.0
Script API declaration and the [Block API reference](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/block?view=minecraft-bedrock-stable).

On its Starstone side, an adapter has tangent cable contacts and a back contact
to a full generator or axial conduit. It still needs a full support face for
placement; cables and other thin surface devices are invalid supports.

These contracts have offline graph and schema tests. Actual redstone delivery
on each face and hopper/world behavior require Minecraft acceptance testing.
