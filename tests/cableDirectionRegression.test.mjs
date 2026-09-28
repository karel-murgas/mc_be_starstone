import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './runtimeFixture.mjs';
const {computeCableMask}=await import('../starstone_bp/scripts/cableComponent.js');

// Independent world-space expectations: +X east, +Y up, -Z north.
// These intentionally do not call surfaceFrame. In-game visual evidence shows
// the Bedrock geometry's raw X sides render mirrored from these world axes.
const directions={
  up:[[0,0,-1],[1,0,0],[0,0,1],[-1,0,0]],
  down:[[0,0,1],[1,0,0],[0,0,-1],[-1,0,0]],
  north:[[0,1,0],[-1,0,0],[0,-1,0],[1,0,0]],
  south:[[0,1,0],[1,0,0],[0,-1,0],[-1,0,0]],
  east:[[0,1,0],[0,0,-1],[0,-1,0],[0,0,1]],
  west:[[0,1,0],[0,0,1],[0,-1,0],[0,0,-1]]
};
const cable=JSON.parse(readFileSync('starstone_bp/blocks/cable.json','utf8'))['minecraft:block'];
const geo=JSON.parse(readFileSync('starstone_rp/models/blocks/starstone_cable.geo.json','utf8'))['minecraft:geometry'][0];
const bones=new Map(geo.bones.map(bone=>[bone.name,bone]));
const visibility=cable.components['minecraft:geometry'].bone_visibility;
const names=['arm_n','arm_e','arm_s','arm_w'];
const opposite=[2,3,0,1];
for(const [face,vectors] of Object.entries(directions)) for(let i=0;i<4;i++) {
  const [dx,dy,dz]=vectors[i], f=fixture();
  const first=f.put('starstone:cable',0,10,0,{'minecraft:block_face':face});
  const second=f.put('starstone:cable',dx,10+dy,dz,{'minecraft:block_face':face});
  const firstMask=computeCableMask(first),secondMask=computeCableMask(second);
  assert.equal(firstMask,1<<i,`${face} neighbor ${i} selects its actual outgoing arm`);
  assert.equal(secondMask,1<<opposite[i],`${face} neighbor ${i} selects the reciprocal arm`);
  const selected=[...visibility[names[i]].matchAll(/== (\d+)/g)].map(match=>Number(match[1]));
  assert.ok(selected.includes(firstMask),`${face} geometry reveals arm ${i}`);
  const a=bones.get(names[i]).cubes[0];
  const axis=i%2===0?2:0;
  // User-observed Bedrock rendering mirrors the model's X sides. The east
  // state must select the raw -X cube, and west the raw +X cube.
  const outward=i<2?i===0?-1:-1:i===2?1:1;
  const endpoint=a.origin[axis]+(outward>0?a.size[axis]:0);
  assert.ok(Math.abs(endpoint-outward*8.14)<1e-9,`${face} arm ${i} reaches the chosen side of the model cell`);
}
// Exact regression from the reported floor cable pair at x=-37 and x=-36.
{
  const f=fixture();
  const west=f.put('starstone:cable',-37,-12,72,{'minecraft:block_face':'up'});
  const east=f.put('starstone:cable',-36,-12,72,{'minecraft:block_face':'up'});
  assert.equal(computeCableMask(west),2);
  assert.equal(computeCableMask(east),8);
  assert.equal(bones.get('arm_e').cubes[0].origin[0],-8.14);
  assert.equal(bones.get('arm_w').cubes[0].origin[0],2);
}
console.log('cable directions: 24 bidirectional joins and reported X-axis pair map to mirrored model arms');
