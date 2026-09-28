# Starstone graphics contract

The visual language is dark navy/gunmetal hardware with blue and cyan energy.
Powered surfaces may reach cyan-white; unpowered surfaces remain dark blue.
Cables, bridges, lamps and adapters mount on full support faces. Generator, ore
and conduit are full cubes.

## Cables and edge joins

`geometry.starstone_cable` uses a permanent `center` bone and four optional
`arm_n`, `arm_e`, `arm_s`, `arm_w` bones. Their bits in
`starstone:connections` are 1, 2, 4 and 8. The arm geometry reaches slightly
past the cell edge (0.14 model units) so adjoining arms meet without a seam,
including cables wrapped around the outside edge of one support cube. The
unpowered and powered materials are `starstone:cable_off` and
`starstone:cable_on`. The four arms of an ordinary cable form one joined lane;
a four-arm intersection is not an isolated crossing.

An inside edge needs multiple cable sheets in one occupied block cell.
`starstone:inner_corner` is a separate walk-through block with 54 valid
combinations of two to six supported faces. Each active perpendicular face
pair contributes grounded strips that meet at the bend; all selected faces
share one electrical lane. A one-block hole can thus join the floor and all
four walls. Placement selects supported faces with adjacent cables plus the
clicked face. When no adjacent cable identifies a face, it selects every
supported face. Every selected face must retain full support. Its item is
crafted from two Cables and placed into an empty cell.
Its item has a separate bent-cable sprite derived from
`mods/starstone/art_source/inner_corner_item_generated.png`.

Cable mask and face transformation tests cover all 16 masks and all six mounting
faces. The user's remaining one-direction visual inversion could not be
reproduced offline and needs a targeted in-game check with the exact clicked
face and neighbor coordinate recorded.

## Flat devices

The lamp uses `geometry.starstone_surface_device`, a thin panel and contacts.
It is a consumer and also carries power between its four surface ports.

`geometry.starstone_bridge` is a grounded, flat casing with narrow local
north-south and east-west lanes extending to opposite cell edges. The two lanes
are electrically isolated and separately mapped to on/off cable materials by
`starstone:powered_ns` and `starstone:powered_ew`. The center casing covers the
crossing without floating duplicate wires. Its body uses the registered
`starstone:bridge` texture.

`geometry.starstone_adapter` is a grounded center box. It has independently
masked blue Starstone arms and red redstone contact arms; unused arms disappear.
The redstone input and output emblems show conversion direction, while face
transformations orient the whole model to the support. The Starstone and
redstone masks must be refreshed when touching blocks change. Output power is
still controlled by Bedrock's `minecraft:redstone_producer` component.

## Full cubes and powered states

The Generator uses `starstone:generator_off` while disabled and the original
bright `starstone:generator` while enabled. The Conduit uses dark
`starstone:conduit_end_off` on its two axis ends while unpowered and bright
`starstone:conduit_end` when powered; its other faces remain
`starstone:casing`. Powered Conduit and Generator emit light level 1, off 0.
Ore emits light level 3.

## Pack artwork and rebuilding

Both development packs have a 256x256 `pack_icon.png` showing a crystal and
four circuit traces. The generated source is
`mods/starstone/art_source/starstone_pack_emblem_generated.png`; the compacted
Dust source is `mods/starstone/art_source/compressed_dust_generated.png`.
Existing block/item atlases remain in the same art source folder.

From `C:\mcmods`, rebuild derived PNGs with:

```powershell
powershell -ExecutionPolicy Bypass -File mods/starstone/tools/build_graphics.ps1
```

The builder extracts the established atlas sprites and then exports the
Compressed Dust icon, dark power-state textures and both pack icons. It leaves
the model JSON and block behavior JSON unchanged.
