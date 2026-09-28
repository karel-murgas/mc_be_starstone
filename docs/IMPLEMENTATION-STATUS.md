# Implementation status

The Starstone development packs implement the main milestone plan and the
latest in-game feedback. The main plan is
`mods/starstone/docs/design/bedrock_stardust_implementation_plan.md`; active packs are
`mods/starstone/starstone_bp` and
`mods/starstone/starstone_rp`.

Recent changes include continuous cable arms, a flat two-lane bridge, grounded
adapters with separately masked blue/red arms, dark disabled Generator/Conduit
textures, both pack icons, outside-edge cable joins, and a separate multi-face
Inner Corner piece. Long-network planning prioritizes consumers, and loaded
three-chunk break/restore is covered. Ore drops now use the pre-break tool via
Script API; the ore's base mining time is 1.5 seconds, with stable tier-specific
pickaxe speeds (0.75 seconds for iron).

The latest 1.0.2 development-pack revision corrects cable and adapter X-arm
model positions against the user's reciprocal live cable masks. The Inner
Corner's 54 face combinations now use two numeric states because Bedrock limits
each state to 16 values; its placement test models an empty one-block hole.

The shared general verifier and project regressions currently pass 34/34 suites
with zero errors or warnings. The general verifier's 37 positive/negative
assertions passed earlier; isolated mutation and 1k/5k/10k stress checks also
passed earlier. These are offline results, not proof of game rendering, Content
Log cleanliness, ore drops, chunk-unload behavior, or watchdog limits.

The next action is an in-game retest using `TEST-WORLD.md`, recording the game
version, experiments, Content Log and whether the corrected X arms now meet.
The Inner Corner item needs a placement/render check in a floor-and-walls hole.
Actual unloaded-middle test 7.6 remains open. Iron/diamond/netherite pickaxes
are required for ore drops, including Fortune and Silk Touch behavior.
