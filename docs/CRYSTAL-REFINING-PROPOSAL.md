# Crystal refining and future kiln

The installed workflow is four Starstone Dust plus one copper ingot into one
Compressed Starstone Dust at a crafting table, then that precursor plus ordinary
fuel into one Crystal in a vanilla furnace. The precursor is a separate item
because the documented modern furnace recipe accepts one input item ID, not a
four-item input count. Furnace hoppers retain vanilla input, fuel and output
behavior. A vanilla Crafter can automate precursor production in worlds that
have one.

This route needs no amethyst or slime, and its furnace step can run before a
custom machine is available. The exact yields and remaining recipes are in
[RECIPES.md](RECIPES.md).

## Later Crystal Kiln option

Desired gameplay is four Dust plus fuel into one Crystal in one machine, with
input from above, fuel from the side, output below, saved inventory and progress,
and normal hopper transfer. A plausible recipe is one furnace, one piston, two
copper ingots, four iron ingots and one Starstone Dust. That would let players
make the kiln before their first Crystal.

The current pack declares block format 1.21.120. The custom `minecraft:block_entity`
container component was introduced with format 1.26.20 and Upcoming Creator
Features in the 1.26.30 Creator update. Its documentation describes a container
but does not establish furnace UI or hopper sided-slot behavior on a custom
block. Implement this only after confirming the installed version, experiment
policy, persistent slots, and actual hopper transfers in-game.

## Ore parity basis

The bundled vanilla Redstone Ore rules use one feature with `count:8`, four
uniform attempts from Y -64 to 15 and eight additional triangular deep attempts
from Y -96 to -32. Starstone now uses the same numeric setup and does not discard
exposed ore. This is parity with versioned reference configuration, not a
measured guarantee of identical counts in a generated world. Existing chunks
will not regenerate.
