# Inner Corner design

How the Inner Corner block works: states, geometry, contact rule and refresh.

## Model

States (32,768 permutations, every array 16 values or fewer):
`face_mask_low/high` = active faces (bit order `FACE_LIST`, unchanged so placed
corners keep their faces), `arms_low/high` = 8 external-arm bits, `powered`.

One geometry, `geometry.starstone_inner_corner`, with a cable-sized center per
face and a cable-sized arm per (face, tangent direction), 30 bones. Arm
`arm_<face>_<toward>` is:

- internal (the bend) when the face whose support lies at `toward` is active -
  always visible with both faces;
- external otherwise - visible only when its `ARM_BIT[face][toward]` bit is set.

`ARM_BIT` (in `scripts/innerCorner.js` and `build_inner_corner.py`) is a fixed
8-colouring: for every valid face set the external arms own distinct bits, so
the bone visibility Molang never depends on the face set.

Contact rule (`neighborContactsFace`): an external arm on face f toward t is set
when the block at t is a cable/lamp/adapter/bridge mounted on f with a port back
at the corner, an inner corner with f active, or a mount-less source. Conduits
never contact.

Refresh (`refreshInnerCorner`, run before cables in each flush, from repair and
mutation reconcile, and by the periodic validator for chunk-border staleness):
active faces = still-supported active faces + supported faces a neighbor already
contacts. Losing one support drops that face; fewer than two perpendicular faces
destroys the corner. A face change re-queues neighbors and `queueMutation`.

Outer wraps (`cornerTopology.outerWrap`): an inner corner's face wraps an
outside support edge to a diagonal cable or inner corner exactly like two
cables do (floor -> inner corner -> wall -> over the wall top). The arm toward
the edge must be external. Live graph, saved segments (including diagonal
chunk-border ports), cable masks, corner arms, growth and placement all use it.

Arm strips sample `starstone:cable_arm_off/on` (made by `make_arm_textures.py`
from the cable textures with the transparent fourth strip row mirrored from
the first). Adapter red arms use `starstone:redstone_arm_off/on`, lit by the
adapter's redstone state.

Placement: contacted supported faces + clicked face; if that is not a bend, all
supported faces. `onPlace` keeps the pre-place choice while still supported.

## Geometry convention

Built from world-space boxes with model X = -world X. The test compares every
center/arm against the cable's cube rotated by that face's cable rotation, so
the corner inherits whatever the cable does in game.

## Still to confirm in game

Wall-wall and wall-floor bend sides, stacked vertical arms, arm strip direction on
walls, growth when a cable is placed on a bare supported face.

Run from `C:\mcmods`:
`python -B mods/starstone/tools/build_inner_corner.py` (regenerates block + model), then
`python -B .claude/skills/bedrock-lookup/scripts/verify_addon.py mods/starstone/starstone_bp mods/starstone/starstone_rp --regression-tests mods/starstone/tests/run.mjs`.
