import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const bp = 'starstone_bp';
const rp = 'starstone_rp';
const read = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const terrain = read(`${rp}/textures/terrain_texture.json`).texture_data;
const items = read(`${rp}/textures/item_texture.json`).texture_data;
const geometries = new Map();
for (const file of fs.readdirSync(`${rp}/models/blocks`)) {
    for (const geo of read(`${rp}/models/blocks/${file}`)['minecraft:geometry']) geometries.set(geo.description.identifier,geo);
}
for (const registry of [terrain,items]) for (const entry of Object.values(registry)) {
    const textures = Array.isArray(entry.textures) ? entry.textures : [entry.textures];
    for (const texture of textures) assert.ok(fs.existsSync(`${rp}/${texture}.png`),`missing texture ${texture}`);
}
const evaluate = (expression, states) => Function(`return (${expression.replace(/query.block_state\('([^']+)'\)/g,(_,key) => JSON.stringify(states[key]))});`)();
for (const name of fs.readdirSync(`${bp}/blocks`)) {
    const block = read(`${bp}/blocks/${name}`)['minecraft:block'];
    for (const [state,definition] of Object.entries(block.description.states || {})) {
        const values = Array.isArray(definition) ? definition : definition?.values;
        if (Array.isArray(values)) assert.ok(values.length<=16,`${name}: ${state} exceeds Bedrock's 16 values per state`);
        if (Number.isInteger(definition?.min) && Number.isInteger(definition?.max))
            assert.ok(definition.max-definition.min+1<=16,`${name}: ${state} exceeds Bedrock's 16 values per state`);
    }
    for (const components of [block.components,...block.permutations?.map(p => p.components) || []]) {
        for (const material of Object.values(components['minecraft:material_instances'] || {})) assert.ok(terrain[material.texture],`${name}: ${material.texture}`);
        const geometry = components['minecraft:geometry'];
        if (geometry && typeof geometry === 'object') {
            const geo = geometries.get(geometry.identifier);
            assert.ok(geo,`${name}: missing geometry`);
            for (const [bone,expression] of Object.entries(geometry.bone_visibility || {})) {
                assert.ok(geo.bones.some(b => b.name === bone));
                if (typeof expression === 'string') assert.ok(!/query\.(?!block_state\b)/.test(expression),expression);
            }
        }
    }
    const loot = read(path.join(bp,block.components['minecraft:loot']));
    for (const pool of loot.pools) for (const entry of pool.entries) assert.ok(!('count' in entry),'loot counts belong in set_count functions');
}
const cable = read(`${bp}/blocks/cable.json`)['minecraft:block'];
for (const powered of [false,true]) for (let mask=0;mask<16;mask++) {
    const states = { 'minecraft:block_face':'up', 'starstone:powered':powered, 'starstone:connections':mask };
    let material = cable.components['minecraft:material_instances'];
    for (const p of cable.permutations) if (evaluate(p.condition,states) && p.components['minecraft:material_instances']) material = p.components['minecraft:material_instances'];
    assert.equal(material['*'].texture,powered ? 'starstone:cable_arm_on':'starstone:cable_arm_off');
    const bones = cable.components['minecraft:geometry'].bone_visibility;
    for (const [index,arm] of ['n','e','s','w'].entries()) assert.equal(Boolean(evaluate(bones[`arm_${arm}`],states)),Boolean(mask & (1<<index)));
}
const uv = geometries.get('geometry.starstone_conduit').bones[0].cubes[0].uv;
for (const [face,definition] of Object.entries(uv)) assert.equal(definition.material_instance,face);
const item = read(`${bp}/items/cable_item.json`)['minecraft:item'];
assert.equal(typeof item.components['minecraft:display_name'].value,'string');
assert.ok(items[item.components['minecraft:icon']]);
assert.equal(items.starstone_inner_corner.textures,'textures/items/starstone_inner_corner');
const manifest = read(`${bp}/manifest.json`);
assert.ok(manifest.dependencies.some(d => d.uuid === read(`${rp}/manifest.json`).header.uuid));
for (const pack of [bp,rp]) {
    const icon = fs.readFileSync(`${pack}/pack_icon.png`);
    assert.equal(icon.subarray(1,4).toString('ascii'),'PNG');
    assert.equal(icon.readUInt32BE(16),256);
    assert.equal(icon.readUInt32BE(20),256);
}
for (const [on,off] of [['starstone_generator.png','starstone_generator_off.png'],
    ['starstone_conduit_end.png','starstone_conduit_end_off.png']]) {
    const onBytes=fs.readFileSync(`${rp}/textures/blocks/${on}`);
    const offBytes=fs.readFileSync(`${rp}/textures/blocks/${off}`);
    assert.equal(offBytes.readUInt32BE(16),32);
    assert.equal(offBytes.readUInt32BE(20),32);
    assert.equal(onBytes.equals(offBytes),false,`${off} must be visibly distinct from powered texture`);
}
console.log('pack contracts: assets, geometry bindings, all cable masks/power visuals, item name, loot and pack dependency passed');

// Cutout lamp textures must retain alpha support in both power states.
const lamp = read(`${bp}/blocks/lamp.json`)['minecraft:block'];
for (const powered of [false,true]) {
    const states = { 'minecraft:block_face':'up', 'starstone:powered':powered };
    let components = { ...lamp.components };
    for (const p of lamp.permutations) if (evaluate(p.condition,states)) components = { ...components,...p.components };
    assert.equal(components['minecraft:material_instances']['*'].render_method,'alpha_test');
    assert.equal(components['minecraft:material_instances']['*'].texture,powered ? 'starstone:lamp_on':'starstone:lamp_off');
}
const generator = read(`${bp}/blocks/generator.json`)['minecraft:block'];
for (const enabled of [false, true]) {
    const states = { 'starstone:enabled':enabled };
    let components = { ...generator.components };
    for (const p of generator.permutations) if (evaluate(p.condition,states)) components = { ...components,...p.components };
    assert.equal(components['minecraft:material_instances']['*'].texture,
        enabled ? 'starstone:generator' : 'starstone:generator_off');
    assert.equal(components['minecraft:light_emission'],enabled ? 1 : 0);
}
const conduit = read(`${bp}/blocks/conduit.json`)['minecraft:block'];
for (const [axis,ends] of Object.entries({x:['east','west'],y:['up','down'],z:['north','south']})) {
    for (const powered of [false,true]) {
        const states = { 'starstone:axis':axis, 'starstone:powered':powered };
        let components = { ...conduit.components };
        for (const p of conduit.permutations) if (evaluate(p.condition,states)) components = { ...components,...p.components };
        const mats = components['minecraft:material_instances'];
        for (const face of Object.keys(uv)) assert.equal((mats[face] || mats['*']).texture,
            ends.includes(face) ? (powered ? 'starstone:conduit_end' : 'starstone:conduit_end_off') : 'starstone:casing');
        assert.equal(components['minecraft:light_emission'],powered ? 1 : 0);
    }
}
