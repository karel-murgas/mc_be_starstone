import { ItemStack, world } from "@minecraft/server";

const ORE_ID = "starstone:ore";
const DUST_ID = "starstone:dust";
const VALID_PICKS = new Set([
    "minecraft:iron_pickaxe",
    "minecraft:diamond_pickaxe",
    "minecraft:netherite_pickaxe"
]);

// The loot table has an explicit empty entry, so this is the only ore drop path.
// Read the pre-break tool: a pickaxe can break on its final use.
export function oreDropFor(tool, random = Math.random) {
    if (!tool || !VALID_PICKS.has(tool.typeId)) return undefined;
    const enchantable = tool.getComponent("minecraft:enchantable");
    if ((enchantable?.getEnchantment("silk_touch")?.level ?? 0) > 0) {
        return { item: ORE_ID, count: 1 };
    }
    const fortune = Math.min(3, Math.max(0,
        enchantable?.getEnchantment("fortune")?.level ?? 0
    ));
    return { item: DUST_ID, count: 2 + Math.floor(random() * 3) + fortune };
}

export function registerOreLoot() {
    world.afterEvents.playerBreakBlock.subscribe((event) => {
        if (event.brokenBlockPermutation?.type?.id !== ORE_ID ||
            event.player?.getGameMode() === "Creative") return;
        try {
            const drop = oreDropFor(event.itemStackBeforeBreak);
            if (!drop) return;
            const { x, y, z } = event.block.location;
            event.dimension.spawnItem(new ItemStack(drop.item, drop.count), {
                x: x + 0.5, y: y + 0.5, z: z + 0.5
            });
        } catch (error) {
            console.warn(`[Starstone] Could not drop ore: ${error.message}`);
        }
    });
}
