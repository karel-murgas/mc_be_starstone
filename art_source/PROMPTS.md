# Starstone source-art prompts

These source atlases were generated with the built-in image-generation tool, then deterministically cropped to Minecraft-sized PNGs by `mods/starstone/tools/build_graphics.ps1`.

## Icon atlas

```text
Use case: stylized-concept
Asset type: Minecraft Bedrock add-on item icon atlas and visual style source
Primary request: create a clean 4 by 2 grid of eight separate square pixel-art game icons for the Starstone technology set: starstone dust, starstone crystal, coiled starstone cable, compact generator cube, square neon lamp, directional redstone input adapter, directional redstone output adapter, and a four-point starstone pack emblem
Scene/backdrop: each grid cell has a flat fully transparent background with generous empty padding; no frames between cells
Style/medium: crisp hand-authored Minecraft-compatible pixel art, chunky low-resolution forms, hard pixel edges, no antialiasing, no painterly texture
Composition/framing: exact 4 columns by 2 rows, one centered object per equal square cell, consistent scale and lighting
Lighting/mood: sleek electrical neon, luminous and readable at very small size
Color palette: deep navy-black and charcoal hardware, cool gunmetal edges, saturated neon blue flowing into electric cyan, tiny cyan-white hot highlights; strictly no purple, magenta, orange, bronze, or warm copper
Materials/textures: sparkling blue mineral dust, faceted icy blue crystal, dark insulated cable with cyan conductor, cool dark metal casings
Constraints: exactly eight objects in the specified order from left to right then top to bottom; no text, no letters, no numbers, no labels, no logos other than the abstract four-point emblem, no watermark, no border, no perspective background, no overlapping cells; transparent background; strong silhouettes suitable for downscaling to 16 by 16 pixels
Avoid: purple or violet hues, warm metal, smooth vector gradients, photorealism, glossy mobile-game style, extra objects, redstone dust resemblance for the starstone dust
```

## Block texture atlas

```text
Use case: stylized-concept
Asset type: Minecraft Bedrock block texture source atlas
Primary request: create a clean 4 by 2 grid of eight seamless square pixel-art texture tiles in this exact order: unpowered dark starstone cable surface with a faint blue conductor, powered starstone cable surface with a brilliant blue-to-cyan conductor, deep navy machine casing with cool gunmetal corners, generator face with a neon blue crystal core, unpowered smoked-glass lamp face, powered cyan-white lamp glass face, redstone input face with one neon-blue arrow pointing inward, redstone output face with one cyan arrow pointing outward
Scene/backdrop: flat texture atlas only, each tile fills its equal grid cell edge to edge, no space or frame between cells
Style/medium: orthographic front-facing Minecraft block textures, crisp hand-authored pixel art, chunky 16-by-16-compatible detail, hard pixel edges, no antialiasing, no 3D perspective
Composition/framing: exact 4 columns by 2 rows, one square tile per cell, aligned grid
Lighting/mood: futuristic neon circuitry; powered tiles visibly luminous while retaining readable shapes
Color palette: deep navy-black, charcoal, cool gunmetal, saturated neon blue transitioning into electric cyan, cyan-white hot highlights; strictly no purple, magenta, orange, bronze, or warm copper
Constraints: exactly eight square flat tiles in the specified order; no text, no letters, no numbers, no labels, no watermark, no border, no isometric blocks, no background scene, no bevel outside tile boundaries, seamless edges where applicable
Avoid: purple or violet hues, warm metals, photorealism, smooth vector gradients, UI icon composition, perspective, extra objects, redstone dust patterns
```

## Surface devices and ore icon atlas

```text
Use case: stylized-concept
Asset type: Minecraft Bedrock add-on item icon atlas and visual style source
Primary request: create a clean 4 by 2 grid of eight separate square pixel-art game icons for the Starstone technology set, in this exact order: a dark stone Starstone ore block with luminous neon-blue mineral veins; a thin flat surface-mounted generator tile; a thin flat surface-mounted lamp tile; a thin flat redstone-input adapter tile with four tiny arrows converging inward; a thin flat redstone-output adapter tile with four tiny arrows radiating outward; a thin flat crossover bridge tile showing one cable visibly raised over another without joining; a full cubic pass-through conduit block with two opposite glowing ports; a thin flat four-way joined intersection tile
Scene/backdrop: each cell has a fully transparent background with generous empty padding and no frame
Style/medium: crisp hand-authored Minecraft-compatible pixel art, chunky low-resolution forms, hard pixel edges, no antialiasing, no painterly texture
Composition/framing: exact 4 columns by 2 rows, one centered object per equal square cell, consistent isometric viewing angle; surface devices must look only one or two pixels thick, like wall/floor plates rather than full blocks
Lighting/mood: sleek electrical neon, luminous and readable at very small size
Color palette: deep navy-black, charcoal stone, cool gunmetal, saturated neon blue flowing into electric cyan, cyan-white hot highlights; strictly no purple, magenta, orange, bronze, or warm copper
Materials/textures: rough dark ore stone, glowing blue crystal veins, thin dark insulated circuit plates, cool metal conduit casing
Constraints: exactly eight objects in the specified order; the generator, lamp, both adapters, bridge, and intersection are visibly flat surface-mounted pieces; only the ore and pass-through conduit are full cubes; no text, letters, numbers, labels, watermark, border, background scene, or overlapping cells; transparent background; strong silhouettes suitable for downscaling to 32 by 32 pixels
Avoid: full-block adapters, repeater-like raised devices, purple hues, warm metal, smooth vector gradients, photorealism, glossy mobile-game style, extra objects
```

## Surface devices and ore texture atlas

```text
Use case: stylized-concept
Asset type: Minecraft Bedrock block and surface-device texture source atlas
Primary request: create a clean 4 by 2 grid of eight square pixel-art texture tiles in this exact order: dark stone Starstone ore with irregular neon-blue crystal veins; thin surface generator panel with a small blue-cyan core and four edge contacts; unpowered smoked-glass surface lamp panel; powered cyan-white surface lamp panel; redstone-input surface panel with four neon-blue arrows converging inward; redstone-output surface panel with four cyan arrows radiating outward; cable crossover bridge viewed directly from above with one straight line visibly raised over the other and no electrical join; pass-through conduit end face with one centered circular cyan port
Scene/backdrop: flat texture atlas only, each tile fills its equal grid cell edge to edge, no space or frame between cells
Style/medium: orthographic directly front-facing Minecraft textures, crisp hand-authored pixel art, chunky 32-by-32-compatible detail, hard pixel edges, no antialiasing, no 3D or isometric perspective
Composition/framing: exact 4 columns by 2 rows, one square tile per cell, aligned grid
Lighting/mood: futuristic neon circuitry; powered tiles visibly luminous while retaining readable shapes
Color palette: deep navy-black, charcoal stone, cool gunmetal, saturated neon blue transitioning into electric cyan, cyan-white hot highlights; strictly no purple, magenta, orange, bronze, or warm copper
Constraints: exactly eight square flat tiles in the specified order; all panel and bridge art is viewed perfectly straight-on from above; no text, letters, numbers, labels, watermark, border, isometric blocks, background scene, bevel outside tile boundaries, or extra objects
Avoid: full-block adapter imagery, repeater-like devices, joined lines in the bridge center, purple hues, warm metals, photorealism, smooth gradients, perspective
```

## Generator cube correction

```text
Edit the first referenced 4-by-2 transparent pixel-art atlas. Change only the second cell in the top row: replace the thin flat generator panel with a full cubic Starstone generator block. Match the compact generator cube in the fourth cell of the top row of the second referenced atlas: deep navy/charcoal casing, cool gunmetal corners, neon-blue-to-cyan crystal core on the top and glowing cyan side ports. Preserve the exact 4-by-2 grid, transparent background, cell boundaries, scale, crisp Minecraft pixel-art style, palette, and all other seven cells exactly. No text, labels, borders, purple, magenta, orange, bronze, or warm copper.
```

## Cable shape reference

```text
Create a new transparent Minecraft pixel-art reference sheet in the exact same Starstone neon-blue/cyan style as the references. Use a clean 3-column by 2-row grid with six separate thin surface-mounted cable shapes, viewed at the same consistent isometric angle and scale. Order left-to-right, top-to-bottom: isolated center node with no arms; one-arm endpoint; two-arm straight cable; two-arm 90-degree L/elbow cable; three-arm T-junction cable; four-arm joined intersection. Every shape has the same dark charcoal plate/casing, square center contact, and glowing blue-to-cyan conductor. The L must be unmistakably L-shaped; the T must be unmistakably T-shaped; the final intersection is electrically joined at its center and must not resemble the raised nonjoining bridge. Generous transparent padding, no text, letters, numbers, labels, arrows, borders, background scene, bridge, conduit, purple, magenta, orange, bronze, or warm copper. Crisp hard pixel edges and strong silhouettes suitable for 32-by-32 icons.
```

The first generated shape sheet rendered the L cell as a second straight. It was corrected with this edit prompt:

```text
Edit only the bottom-left cell of this 3-column by 2-row Starstone cable reference sheet. It currently reads as another straight cable. Replace it with an unmistakable 90-degree L/elbow: exactly two adjacent glowing conductor arms meeting and electrically joining at the square center, one arm toward the upper-right edge and one arm toward the lower-right edge of the isometric diamond. It must have no arm toward the upper-left or lower-left. Preserve the other five cells exactly, including endpoint, straight, T, and four-way joined intersection; preserve layout, scale, dark charcoal casing, neon blue-to-cyan palette, crisp pixel art, and background. No text or labels.
```

## Transparent wire and rotation-neutral adapters

```text
Edit this exact 4-by-2 Minecraft pixel-art texture atlas while preserving the grid and the four middle machine textures. Change only these cells. Top-left and top-row second cell: remove the full dark plate/background and leave only a narrow horizontal insulated wire centered in the tile, with a slim charcoal sheath; top-left is unpowered with a faint blue conductor, top-second is powered with a brilliant neon-blue-to-cyan conductor. Everything outside the wire and its one-pixel dark sheath must be fully transparent alpha. Bottom-row third cell: replace the arrow panel with a rotation-neutral input adapter texture: a small recessed dark square socket with a thin cyan ring and four short symmetric wire contacts, transparent everywhere outside that small box and contacts. Bottom-row fourth cell: replace the arrow panel with a rotation-neutral output adapter texture: a small bright cyan emitter core in a dark square box with four short symmetric wire contacts, transparent everywhere outside the box and contacts. No arrows or directional symbols. Preserve exactly the casing, generator face, lamp-off, and lamp-on cells. Crisp hard pixel edges, no antialiasing, no text, and retain the deep navy, cool gunmetal, neon blue/cyan palette.
```

The cable topology sheet was then updated to the exposed-wire presentation:

```text
Edit the first referenced 3-by-2 Starstone cable shape sheet to match the narrow exposed-wire style requested. Remove the large diamond plates and corner pads from all six cells. Keep only a slim charcoal-insulated wire with a neon-blue-to-cyan conductor and a compact square center junction, floating on a fully transparent background so the Minecraft support block will remain visible around it. Preserve the exact six topology silhouettes and order: isolated center, endpoint, straight, unmistakable 90-degree L with two adjacent arms, unmistakable T with three arms, and joined four-way intersection. Use the narrow wire look of the first two cells in the second reference. Do not change L into straight; do not add a nonjoining bridge. Exact 3-column by 2-row layout, consistent isometric angle and scale, hard pixel edges, no text, arrows, labels, borders, scene, purple, magenta, orange, bronze, or warm copper.
```

## Adapter conversion emblems

```text
Edit only the bottom-row third and fourth cells of this exact 4-by-2 Minecraft pixel-art texture atlas. Preserve the transparent background outside each compact adapter box and its four symmetric blue wire contacts. Bottom-row third cell is the Redstone-to-Starstone input adapter: inside the center box show a tiny clear conversion emblem with a redstone-red terminal on the left, a small pale arrow pointing right, and a neon-blue/cyan terminal on the right (red -> blue). Bottom-row fourth cell is the Starstone-to-Redstone output adapter: inside the center box show the reverse emblem, neon-blue/cyan terminal on the left, a small pale arrow pointing right, and redstone-red terminal on the right (blue -> red). The arrows describe conversion only and must stay inside the box; do not add directional arrows on the four outer contacts. Keep the four contacts rotationally symmetric. Use red only for the redstone terminals; preserve deep navy/charcoal casing, cool gunmetal, and crisp hard Minecraft pixel edges. Preserve all other six atlas cells exactly. No text, letters, labels, borders, or background scene.
```

```text
Edit only two cells of the first referenced 4-by-2 transparent Minecraft pixel-art item-icon atlas, using the compact adapter styling from the second reference. Top-row fourth cell is the Redstone-to-Starstone input adapter: replace the four inward arrows with a thin compact surface box, four symmetric blue wire contacts, and a center conversion emblem redstone red -> pale arrow -> neon blue/cyan. Bottom-row first cell is the Starstone-to-Redstone output adapter: replace the four outward arrows with the matching thin box and center emblem neon blue/cyan -> pale arrow -> redstone red. The arrow is contained inside the center box and explains conversion, not world direction. Preserve transparency, isometric angle, cell scale, and all other six objects exactly, including generator, lamp, bridge, conduit, ore, and joined intersection. Red appears only in the adapter conversion terminals. No text, letters, labels, borders, or background scene.
```

## Exposed-wire bridge correction

```text
Edit only the bottom-row second cell of this exact 4-by-2 transparent Minecraft pixel-art item-icon atlas: the Starstone crossover bridge. Replace its broad plate with two narrow exposed charcoal-insulated wires crossing at right angles on transparent background. Raise one wire over the other with a small dark center overpass, and do not electrically join them. Both visible wire lanes must use the same bright neon-blue-to-cyan conductor and equal apparent brightness; the lower lane may disappear only for the few pixels directly underneath the raised overpass, then continue visibly on both sides. Preserve the exact grid, isometric angle, scale, hard pixel edges, and every other cell exactly. No arrows, text, labels, purple, magenta, orange, bronze, or warm copper.
```

```text
Edit only the bottom-row third cell of this exact 4-by-2 Minecraft surface-texture atlas: the bridge viewed directly from above. Remove the broad plate and leave two narrow charcoal-insulated blue/cyan wires crossing at right angles on transparent background. One straight lane passes over the other on a small raised dark patch; the lanes remain electrically separate. Draw both lanes with the same bright neon-blue-to-cyan conductor and equal brightness. Hide the lower lane only immediately beneath the raised center patch, with both halves clearly continuing beyond it. Preserve all other seven cells exactly, the 4-by-2 grid, orthographic alignment, transparent alpha, and crisp hard pixel edges. No joined center node, arrows, text, labels, purple, magenta, orange, bronze, or warm copper.
```
