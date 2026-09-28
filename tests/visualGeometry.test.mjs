import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bp = path.join(root, 'starstone_bp');
const rp = path.join(root, 'starstone_rp');
const faces = ['up', 'down', 'north', 'south', 'east', 'west'];
const support = {
  up: [0, -1, 0], down: [0, 1, 0], north: [0, 0, 1],
  south: [0, 0, -1], east: [-1, 0, 0], west: [1, 0, 0],
};

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'));
}

function geometry(name) {
  return readJson(rp, 'models', 'blocks', name)['minecraft:geometry'][0];
}

function bone(geo, name) {
  return geo.bones.find((entry) => entry.name === name);
}

function allCubes(geo) {
  return geo.bones.flatMap(({ cubes }) => cubes ?? []);
}

function rotationFor(block, face) {
  const permutation = block.permutations.find((entry) => entry.condition.includes(`'${face}'`));
  assert.ok(permutation, `missing ${face} transformation`);
  return permutation.components['minecraft:transformation'].rotation;
}

function rotateX([x, y, z], degrees) {
  const angle = degrees * Math.PI / 180;
  return [x, Math.round(y * Math.cos(angle) - z * Math.sin(angle)), Math.round(y * Math.sin(angle) + z * Math.cos(angle))];
}

function rotateY([x, y, z], degrees) {
  const angle = degrees * Math.PI / 180;
  return [Math.round(x * Math.cos(angle) + z * Math.sin(angle)), y, Math.round(-x * Math.sin(angle) + z * Math.cos(angle))];
}

function supportDirectionFrom(rotation) {
  const afterX = rotateX([0, -1, 0], rotation[0]);
  return rotateY(afterX, rotation[1]).map((value) => value === 0 ? 0 : value);
}

function assertBounds(geo, label, overhang=0) {
  for (const cube of allCubes(geo)) {
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(cube.origin[axis] >= -8-overhang, `${label}: cube exceeds permitted edge overlap on axis ${axis}`);
      assert.ok(cube.origin[axis] + cube.size[axis] <= 8+overhang, `${label}: cube exceeds permitted edge overlap on axis ${axis}`);
    }
  }
}

const bridgeGeo = geometry('starstone_bridge.geo.json');
const adapterGeo = geometry('starstone_adapter.geo.json');
assertBounds(bridgeGeo, 'bridge');
assertBounds(adapterGeo, 'adapter', .14);

const bridgeBody = bone(bridgeGeo, 'body');
const laneNs = bone(bridgeGeo, 'lane_ns');
const laneEw = bone(bridgeGeo, 'lane_ew');
assert.ok(bridgeBody && laneNs && laneEw, 'bridge retains body and two named electrical lanes');
assert.ok(bridgeBody.cubes.some((cube) => cube.origin[1] === 0), 'bridge body contacts its support plane');
assert.ok(bridgeBody.cubes.some((cube) => cube.size[0] < 16 && cube.size[2] < 16), 'bridge body has a compact grounded footprint');
assert.ok(laneEw.cubes.every((cube) => cube.origin[1] < .2), 'east-west lane lies on the support');
assert.ok(laneNs.cubes.every((cube) => cube.origin[1] < .4), 'north-south lane stays nearly flat');
assert.ok(Math.max(...allCubes(bridgeGeo).map(cube => cube.origin[1]+cube.size[1])) < .5, 'bridge is flat');
for (const [lane, axis] of [[laneNs,2],[laneEw,0]]) {
  for (const edge of [-8,8]) assert.ok(lane.cubes.some(cube => cube.origin[axis] === edge || cube.origin[axis]+cube.size[axis] === edge), `${lane.name} reaches edge ${edge}`);
}
for (const lane of [laneNs, laneEw]) {
  for (const cube of lane.cubes) {
    assert.equal(Object.values(cube.uv).some((face) => face.material_instance === lane.name), true,
      `${lane.name} cube keeps its independently powered material`);
    assert.deepEqual(cube.uv.up.uv,[19,14],`${lane.name} samples conductor pixels rather than the old whole-wire decal`);
    assert.deepEqual(cube.uv.up.uv_size,[5,4],`${lane.name} has a narrow conductor UV`);
  }
}

const adapter = bone(adapterGeo, 'center');
assert.ok(adapter?.cubes.some(cube => cube.origin[1] === 0), 'adapter housing is grounded');
assert.equal(adapter.cubes.length,1,'adapter housing has no fixed side relics');
for (const kind of ['blue','red']) for (const [arm,axis,edge] of [['n',2,-8.14],['e',0,-8.14],['s',2,8.14],['w',0,8.14]]) {
  const contact=bone(adapterGeo,`${kind}_${arm}`);
  assert.equal(contact?.cubes.length,1,`${kind}_${arm} is separately maskable`);
  const cube=contact.cubes[0];
  assert.ok(cube.origin[axis]===edge || cube.origin[axis]+cube.size[axis]===edge,`${kind}_${arm} reaches edge`);
  assert.ok(cube.origin[1]<.1 && cube.origin[1]+cube.size[1]<.2,`${kind}_${arm} hugs support`);
}

const bridge = readJson(bp, 'blocks', 'bridge.json')['minecraft:block'];
assert.deepEqual(bridge.description.states['starstone:powered_ns'], [false, true]);
assert.deepEqual(bridge.description.states['starstone:powered_ew'], [false, true]);
for (const materials of [bridge.components, ...bridge.permutations.map((entry) => entry.components)]
  .map((components) => components['minecraft:material_instances']).filter(Boolean)) {
  assert.equal(materials.body.texture, 'starstone:casing');
  assert.ok(materials.lane_ns && materials.lane_ew, 'every bridge state preserves both lane materials');
}
for (const [ns, ew, nsTexture, ewTexture] of [
  [false, false, 'starstone:cable_arm_off', 'starstone:cable_arm_off'],
  [true, false, 'starstone:cable_arm_on', 'starstone:cable_arm_off'],
  [false, true, 'starstone:cable_arm_off', 'starstone:cable_arm_on'],
  [true, true, 'starstone:cable_arm_on', 'starstone:cable_arm_on'],
]) {
  const permutation = bridge.permutations.find((entry) =>
    entry.condition.includes(`'starstone:powered_ns') == ${ns}`)
    && entry.condition.includes(`'starstone:powered_ew') == ${ew}`));
  assert.ok(permutation, `bridge has a material state for ns=${ns}, ew=${ew}`);
  const materials = permutation.components['minecraft:material_instances'];
  assert.equal(materials.lane_ns.texture, nsTexture);
  assert.equal(materials.lane_ew.texture, ewTexture);
}

const terrain = readJson(rp, 'textures', 'terrain_texture.json').texture_data;
assert.equal(terrain['starstone:bridge'].textures, 'textures/blocks/starstone_bridge');
assert.equal(fs.existsSync(path.join(rp, 'textures', 'blocks', 'starstone_bridge.png')), true);
for (const id of ['redstone_input', 'redstone_output']) {
  assert.equal(typeof terrain[`starstone:${id}`]?.textures, 'string');
  assert.equal(fs.existsSync(path.join(rp, 'textures', 'blocks', `starstone_${id}.png`)), true);
}

for (const file of ['bridge.json', 'redstone_input.json', 'redstone_output.json']) {
  const block = readJson(bp, 'blocks', file)['minecraft:block'];
  for (const face of faces) {
    const rotation = rotationFor(block, face);
    assert.deepEqual(supportDirectionFrom(rotation), support[face], `${file} ${face} maps the lower contact plane to its support`);
  }
}

for (const file of ['redstone_input.json', 'redstone_output.json']) {
  const block = readJson(bp, 'blocks', file)['minecraft:block'];
  assert.deepEqual(block.description.states['starstone:powered'], [false, true], `${file} preserves its powered state`);
  assert.equal(block.components['minecraft:selection_box'].size[1], 3, `${file} selection matches adapter height`);
  assert.equal(block.components['minecraft:collision_box'].size[1], 3, `${file} collision matches adapter height`);
}

const output = readJson(bp, 'blocks', 'redstone_output.json')['minecraft:block'];
for (const producer of [
  output.components['minecraft:redstone_producer'],
  output.permutations.find((entry) => entry.components['minecraft:redstone_producer']).components['minecraft:redstone_producer'],
]) {
  assert.deepEqual(producer.connected_faces, ['down', 'up', 'north', 'south', 'west', 'east']);
  assert.equal(producer.strongly_powered_face, 'down');
  assert.equal(producer.transform_relative, true);
}

console.log('visual geometry: grounded bridge/adapters, six-face transforms, state materials, and assets passed');
