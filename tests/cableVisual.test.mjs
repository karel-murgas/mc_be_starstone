import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACE_LIST, ARM_NAMES, worldOffset, faceNormal } from '../starstone_bp/scripts/surfaceFrame.js';

const block = JSON.parse(readFileSync('starstone_bp/blocks/cable.json','utf8'))['minecraft:block'];
const geometry = JSON.parse(readFileSync('starstone_rp/models/blocks/starstone_cable.geo.json','utf8'))['minecraft:geometry'][0];
const bones = new Map(geometry.bones.map(bone=>[bone.name,bone]));
const expectedBones = ['center','arm_n','arm_e','arm_s','arm_w'];
assert.deepEqual([...bones.keys()],expectedBones,'existing art and visibility identifiers are retained');
assert.equal(geometry.description.identifier,'geometry.starstone_cable');
const cube = name=>{
    const parts=bones.get(name).cubes;
    assert.equal(parts.length,1,`${name} is one contiguous cuboid`);
    return parts[0];
};
const center=cube('center');
assert.deepEqual(center.origin,[-2,0.02,-2]);
assert.deepEqual(center.size,[4,0.12,4]);
const armBounds={
    arm_n:{axis:2,inner:-2,outer:-8.14,sideAxis:0},
    arm_e:{axis:0,inner:-2,outer:-8.14,sideAxis:2},
    arm_s:{axis:2,inner:2,outer:8.14,sideAxis:0},
    arm_w:{axis:0,inner:2,outer:8.14,sideAxis:2}
};
for(const [name,{axis,inner,outer,sideAxis}] of Object.entries(armBounds)) {
    const part=cube(name);
    const endpoints=[part.origin[axis],part.origin[axis]+part.size[axis]];
    const expected=[inner,outer].sort((a,b)=>a-b);
    endpoints.sort((a,b)=>a-b).forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-9,`${name} joins center and overlaps block edge`));
    assert.deepEqual([part.origin[sideAxis],part.size[sideAxis]],[-1,2],`${name} is a narrow straight arm`);
    assert.deepEqual([part.origin[1],part.size[1]],[0.02,0.12],`${name} shares center surface height`);
    for(const face of ['up','down']) {
        const uv=part.uv[face];
        assert.deepEqual(uv.uv,[19,14]);
        assert.deepEqual(uv.uv_size,[5,4],`${name} samples only the conductor strip, not another hub`);
        assert.equal(uv.uv_rotation || 0,name==='arm_n'||name==='arm_s' ? 90 : 0);
    }
}
for(const face of ['up','down']) {
    assert.deepEqual(center.uv[face].uv,[13,13],`isolated center uses hub pixels on ${face}`);
    assert.deepEqual(center.uv[face].uv_size,[6,6]);
}
for (const uv of Object.values(center.uv)) assert.equal(uv.material_instance,'hub','center has its own symmetric material');
assert.equal(block.components['minecraft:material_instances'].hub.texture,'starstone:cable_hub_off');
const powered=block.permutations.find(p=>p.condition==="query.block_state('starstone:powered') == true" && p.components['minecraft:material_instances']);
assert.equal(powered.components['minecraft:material_instances'].hub.texture,'starstone:cable_hub_on');

// Bedrock's block transformation is applied about the center of the cell. With
// these quarter-turns, X precedes Y, then Z. Verify every arm and its support
// plane instead of assuming a camera-specific notion of left or right.
function rotate(vector, angles) {
    let result=[...vector];
    for(const [axis,angle] of angles.entries()) {
        const turns=((angle/90)%4+4)%4;
        for(let i=0;i<turns;i++) {
            const [x,y,z]=result;
            result=axis===0?[x,-z,y]:axis===1?[z,y,-x]:[-y,x,z];
        }
    }
    return result.map(value=>value||0);
}
const rotations=new Map();
for(const permutation of block.permutations) {
    const match=/^query\.block_state\('minecraft:block_face'\) == '(up|down|north|south|east|west)'$/.exec(permutation.condition);
    if(match) rotations.set(match[1],permutation.components['minecraft:transformation'].rotation);
}
assert.deepEqual([...rotations.keys()].sort(),[...FACE_LIST].sort());
for(const face of FACE_LIST) {
    const angles=rotations.get(face);
    assert.deepEqual(rotate([0,1,0],angles),faceNormal(face),`${face} surface outward normal`);
    for(const arm of ARM_NAMES) {
        const name=arm.replace('local_','arm_');
        const part=cube(name), direction=arm==='local_n'?[0,0,-1]:arm==='local_e'?[-1,0,0]:arm==='local_s'?[0,0,1]:[1,0,0];
        // The in-game X rendering is mirrored relative to the raw geometry
        // coordinates. The named east/west bones therefore occupy opposite
        // model-X sides while retaining their logical connection states.
        const logical=arm==='local_n'?[0,0,-1]:arm==='local_e'?[1,0,0]:arm==='local_s'?[0,0,1]:[-1,0,0];
        assert.deepEqual(rotate(logical,angles),worldOffset(face,arm).map(value=>value||0),`${face} ${arm} logical direction follows script neighbor lookup`);
        const axis=direction.findIndex(value=>value!==0);
        const outer=part.origin[axis]+(direction[axis]>0?part.size[axis]:0);
        assert.equal(outer,8.14*direction[axis],`${face} ${arm} overlaps neighbor cell boundary`);
    }
    // Model y=0 is the support-side boundary. Its thin shell lies inside the
    // cable's cell, 0.02..0.14 units outward from support, even on walls/ceiling.
    const normal=faceNormal(face);
    for(const y of [0.02,0.14]) {
        const point=rotate([0,y-8,0],angles);
        const distance=point.reduce((sum,value,i)=>sum+value*normal[i],0)+8;
        assert.ok(Math.abs(distance-y)<1e-9,`${face} shell hugs support plane without levitation`);
    }
}

const visibility=block.components['minecraft:geometry'].bone_visibility;
assert.equal(visibility.center,true);
for(let mask=0;mask<16;mask++) {
    for(const [index,name] of expectedBones.slice(1).entries()) {
        const allowed=[...visibility[name].matchAll(/== (\d+)/g)].map(match=>Number(match[1]));
        assert.equal(allowed.includes(mask),Boolean(mask&(1<<index)),`mask ${mask} shows only its ${name} edge`);
    }
}
// Exercise the actual neighbor reader too: a newly observed cable at +X on a
// floor must set the east bit and reveal arm_e, never arm_w. Repeat for all
// six mount faces rather than assuming the frame's pure lookup is wired in.
const { fixture } = await import('./runtimeFixture.mjs');
const { computeCableMask } = await import('../starstone_bp/scripts/cableComponent.js');
for(const face of FACE_LIST) for(const [index,arm] of ARM_NAMES.entries()) {
    const { put } = fixture();
    const base=put('starstone:cable',0,10,0,{'minecraft:block_face':face});
    const [dx,dy,dz]=worldOffset(face,arm);
    put('starstone:cable',dx,10+dy,dz,{'minecraft:block_face':face});
    const mask=computeCableMask(base);
    assert.equal(mask,1<<index,`${face} neighbor at ${arm} selects the same visual arm`);
    for(const [otherIndex,name] of expectedBones.slice(1).entries()) {
        const visible=[...visibility[name].matchAll(/== (\d+)/g)].some(match=>Number(match[1])===mask);
        assert.equal(visible,otherIndex===index,`${face} ${arm} shows ${name} iff it reaches that neighbor`);
    }
}
console.log('cable visual: hub-only UVs, continuous edge arms, six mounted rotations and all sixteen visibility masks passed');
