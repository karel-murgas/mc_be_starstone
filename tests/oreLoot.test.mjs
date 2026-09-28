import assert from 'node:assert/strict';
import { mc } from './runtimeFixture.mjs';
const { oreDropFor, registerOreLoot } = await import('../starstone_bp/scripts/oreLoot.js');

function pick(typeId, enchantments = {}) {
  return {
    typeId,
    getComponent(id) {
      assert.equal(id, 'minecraft:enchantable');
      return { getEnchantment: enchantment => enchantments[enchantment] === undefined
        ? undefined : { level: enchantments[enchantment] } };
    },
  };
}

for (const tool of ['minecraft:iron_pickaxe', 'minecraft:diamond_pickaxe', 'minecraft:netherite_pickaxe']) {
  assert.deepEqual(oreDropFor(pick(tool), () => 0), { item: 'starstone:dust', count: 2 });
  assert.deepEqual(oreDropFor(pick(tool), () => 0.999), { item: 'starstone:dust', count: 4 });
  for (const fortune of [1, 2, 3]) {
    assert.deepEqual(oreDropFor(pick(tool, { fortune }), () => 0),
      { item: 'starstone:dust', count: 2 + fortune });
    assert.deepEqual(oreDropFor(pick(tool, { fortune }), () => 0.999),
      { item: 'starstone:dust', count: 4 + fortune });
  }
  assert.deepEqual(oreDropFor(pick(tool, { silk_touch: 1 }), () => 0),
    { item: 'starstone:ore', count: 1 });
  assert.deepEqual(oreDropFor(pick(tool, { silk_touch: 1, fortune: 3 }), () => 0),
    { item: 'starstone:ore', count: 1 });
}
for (const tool of [undefined, pick('minecraft:stone_pickaxe'), pick('minecraft:wooden_pickaxe')]) {
  assert.equal(oreDropFor(tool), undefined);
}

registerOreLoot();
const subscribers = globalThis.__mcWorldSubscribers.playerBreakBlock;
assert.equal(subscribers.length, 1);
const spawned = [];
const event = {
  brokenBlockPermutation: { type: { id: 'starstone:ore' } },
  itemStackBeforeBreak: pick('minecraft:diamond_pickaxe', { silk_touch: 1 }),
  player: { getGameMode: () => 'Survival' },
  block: { location: { x: 4, y: 50, z: 7 } },
  dimension: { spawnItem(item, location) { spawned.push({ item, location }); } },
};
subscribers[0](event);
assert.ok(spawned[0].item instanceof mc.ItemStack);
assert.equal(spawned[0].item.typeId, 'starstone:ore');
assert.equal(spawned[0].item.amount, 1);
assert.deepEqual(spawned[0].location, { x: 4.5, y: 50.5, z: 7.5 });
event.player.getGameMode = () => 'Creative';
subscribers[0](event);
assert.equal(spawned.length, 1, 'creative mining must not produce survival loot');
event.player.getGameMode = () => 'Survival';
event.itemStackBeforeBreak = pick('minecraft:stone_pickaxe');
subscribers[0](event);
assert.equal(spawned.length, 1, 'stone pickaxe must not drop Dust');
event.brokenBlockPermutation.type.id = 'minecraft:stone';
event.itemStackBeforeBreak = pick('minecraft:iron_pickaxe');
subscribers[0](event);
assert.equal(spawned.length, 1, 'unrelated blocks must not trigger ore loot');

console.log('ore loot: tool gating, base, Fortune, Silk Touch, creative, and duplicate protection passed');
