# Installed survival recipes

Crafting recipes unlock when the relevant Starstone material is first carried.
All counts below are exact recipe outputs. Every crafting recipe is shaped
(workspace rule, enforced by `verify_addon.py` and `survival.test.mjs`). Starstone Dust is obtained from ore;
there is no craftable Dust shortcut.

| Result | Grid (`.` = empty) | Key | Method |
|---|---|---|---|
| 1 `starstone:cable_item` | `CSC` | `C` copper ingot, `S` Dust | Crafting table |
| 1 `starstone:inner_corner_item` | `C.` / `.C` | `C` Cable | Crafting table |
| 1 `starstone:compressed_dust` | `.S.` / `SCS` / `.S.` | `S` Dust, `C` copper ingot | Crafting table |
| 1 Crystal | 1 Compressed Dust + fuel | | Furnace |
| 4 `starstone:bridge` | `.C.` / `CIC` / `.C.` | `C` Cable, `I` iron ingot | Crafting table |
| 2 `starstone:conduit` | `.D.` / `CSC` / `.D.` | `D` Dust, `C` copper ingot, `S` chiseled stone bricks | Crafting table |
| 1 `starstone:generator` | `CCC` / `SGS` / `CCC` | `C` copper ingot, `S` Crystal, `G` gold ingot | Crafting table |
| 1 `starstone:lamp` | `.C.` / `.S.` / `.G.` | `S` Crystal, `G` glass, `C` copper ingot | Crafting table |
| 1 `starstone:redstone_input` | `.C.` / `RXD` / `.S.` | `S` Crystal, `D` Dust, `C` copper ingot, `R` redstone, `X` comparator | Crafting table |
| 1 `starstone:redstone_output` | `.C.` / `DXR` / `.S.` | `S` Crystal, `D` Dust, `C` copper ingot, `R` redstone, `X` repeater | Crafting table |

A Generator therefore consumes at least eight mined Dust through its two
Crystals, two copper ingots in the precursors, six more copper ingots and one
gold ingot in the generator grid, and fuel for two furnace operations. This makes
it a deliberate permanent network source, while the redstone input adapter
offers a cheaper way to power Starstone from an existing redstone circuit.

The furnace and its hoppers use vanilla behavior: precursor from above, fuel
from a side, and finished Crystals extracted below. The four-Dust crafting step
can be automated separately with a vanilla Crafter where available. A custom
Crystal Kiln with its own slots and exact hopper rules remains a later version
gate; see [CRYSTAL-REFINING-PROPOSAL.md](CRYSTAL-REFINING-PROPOSAL.md).
