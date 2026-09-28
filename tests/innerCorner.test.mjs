import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mc, fixture, drain } from './runtimeFixture.mjs';
import { INNER_PAIRS, ARM_BIT, innerRoutes, stateOfFaces, facesOfPair, pairFromPermutation,
    armsFromPermutation, externalArms, oppositeFace, tangentFaces } from '../starstone_bp/scripts/innerCorner.js';
import { FACE_LIST, ARM_NAMES, faceNormal, worldOffset } from '../starstone_bp/scripts/surfaceFrame.js';
const { registerCableComponent, computeCableMask, computeInnerCornerState, scheduleAffected, flushPending } =
    await import('../starstone_bp/scripts/cableComponent.js');
const { isSupportValid } = await import('../starstone_bp/scripts/support.js');
const { descriptorForBlock, innerCornerDescriptor, cableDescriptor } = await import('../starstone_bp/scripts/electricalBlocks.js');
const { discoverNetwork } = await import('../starstone_bp/scripts/networkGraph.js');
const { buildChunkSegments } = await import('../starstone_bp/scripts/chunkIndex.js');
const { buildSegmentGraph } = await import('../starstone_bp/scripts/segmentGraph.js');
const { outerWrap } = await import('../starstone_bp/scripts/cornerTopology.js');

const same=(a,b)=>a.length===b.length&&a.every((value,i)=>Math.abs(value-b[i])<1e-9);
assert.equal(INNER_PAIRS.length,54,'all supported combinations of 2-6 faces with a bend');
assert.equal(INNER_PAIRS.filter(state=>state.split('_').length===2).length,12);
for (const pair of INNER_PAIRS) assert.ok(innerRoutes(pair).length>=2);
assert.equal(innerRoutes(stateOfFaces(['up','north','east'])).length,12);
assert.equal(innerRoutes(stateOfFaces(['up','north','south','east','west'])).length,20);

// --- Arm bit layout ---------------------------------------------------------
for (const face of FACE_LIST) {
    assert.deepEqual(Object.keys(ARM_BIT[face]).sort(),tangentFaces(face).sort(),`${face} has a bit per tangent`);
    for (const bit of Object.values(ARM_BIT[face])) assert.ok(bit>=0&&bit<8);
}
for (const pair of INNER_PAIRS) {
    const bits=externalArms(facesOfPair(pair)).map(arm=>arm.bit);
    assert.equal(new Set(bits).size,bits.length,`${pair} external arms own distinct bits`);
}

// --- Block states and bone visibility ----------------------------------------
const block=JSON.parse(readFileSync('starstone_bp/blocks/inner_corner.json','utf8'))['minecraft:block'];
const states=block.description.states;
let permutations=1;
for (const [name,values] of Object.entries(states)) {
    assert.ok(values.length<=16,`${name} has at most 16 values`);
    permutations*=values.length;
}
assert.ok(permutations<65536,`inner corner has ${permutations} permutations`);
assert.equal(block.permutations.length,1,'only the powered material is a permutation');
const powered=block.permutations[0].components['minecraft:material_instances'];
assert.equal(powered['*'].texture,'starstone:cable_arm_on');
assert.equal(powered.hub.texture,'starstone:cable_hub_on');
assert.equal(block.components['minecraft:material_instances'].hub.texture,'starstone:cable_hub_off');
const visibility=block.components['minecraft:geometry'].bone_visibility;
const compiled=Object.fromEntries(Object.entries(visibility).map(([bone,expr])=>{
    assert.match(expr,/^[\s()|&=0-9a-z_.':]+$/,`${bone} uses only state equality`);
    const js=expr.replace(/query\.block_state\('([a-z_:]+)'\)/g,(_,name)=>{
        assert.ok(name in states,`${bone} reads declared state ${name}`);
        return `s[${JSON.stringify(name)}]`;
    });
    return [bone,new Function('s',`return ${js};`)];
}));
const expectedBones=[...FACE_LIST.map(face=>`center_${face}`),
    ...FACE_LIST.flatMap(face=>tangentFaces(face).map(toward=>`arm_${face}_${toward}`))];
assert.deepEqual(Object.keys(compiled).sort(),expectedBones.sort());
for (const pair of INNER_PAIRS) {
    const faces=facesOfPair(pair);
    const mask=FACE_LIST.reduce((bits,face,i)=>bits|(faces.includes(face)?1<<i:0),0);
    for (let arms=0;arms<256;arms++) {
        const s={'starstone:face_mask_low':mask&15,'starstone:face_mask_high':mask>>4,
            'starstone:arms_low':arms&15,'starstone:arms_high':arms>>4};
        for (const face of FACE_LIST) {
            assert.equal(compiled[`center_${face}`](s),faces.includes(face));
            for (const toward of tangentFaces(face)) {
                const internal=faces.includes(oppositeFace(toward));
                const expected=faces.includes(face)&&(internal||Boolean(arms&(1<<ARM_BIT[face][toward])));
                assert.equal(compiled[`arm_${face}_${toward}`](s),expected,`${pair} arms=${arms} arm_${face}_${toward}`);
            }
        }
    }
}

// --- Geometry matches the ordinary cable on every face -------------------------
// Both models are compared in world space: Bedrock renders model X mirrored and
// applies the cable block's rotation about the cell center (cableVisual tests).
const cable=JSON.parse(readFileSync('starstone_bp/blocks/cable.json','utf8'))['minecraft:block'];
const cableGeo=JSON.parse(readFileSync('starstone_rp/models/blocks/starstone_cable.geo.json','utf8'))['minecraft:geometry'][0];
const cornerGeo=JSON.parse(readFileSync('starstone_rp/models/blocks/starstone_inner_corner.geo.json','utf8'))['minecraft:geometry'][0];
assert.equal(block.components['minecraft:geometry'].identifier,cornerGeo.description.identifier);
const cubeOf=(geo,name)=>{const bone=geo.bones.find(b=>b.name===name);assert.equal(bone.cubes.length,1,name);return bone.cubes[0];};
function rotate(vector, angles) {
    let result=[...vector];
    for (const [axis,angle] of angles.entries()) {
        const turns=((angle/90)%4+4)%4;
        for (let i=0;i<turns;i++) {
            const [x,y,z]=result;
            result=axis===0?[x,-z,y]:axis===1?[z,y,-x]:[-y,x,z];
        }
    }
    return result.map(value=>value||0);
}
const round=value=>Math.round(value*1e6)/1e6;
function worldBox(cube,angles=[0,0,0]) {
    const lo=[-(cube.origin[0]+cube.size[0]),cube.origin[1]-8,cube.origin[2]];
    const hi=[-cube.origin[0],cube.origin[1]+cube.size[1]-8,cube.origin[2]+cube.size[2]];
    const corners=[];
    for (const x of [lo[0],hi[0]]) for (const y of [lo[1],hi[1]]) for (const z of [lo[2],hi[2]]) corners.push(rotate([x,y,z],angles));
    return [0,1,2].map(i=>[round(Math.min(...corners.map(c=>c[i]))),round(Math.max(...corners.map(c=>c[i])))]);
}
const rotations=new Map(cable.permutations.map(p=>[/'(up|down|north|south|east|west)'/.exec(p.condition)?.[1],
    p.components['minecraft:transformation']?.rotation]).filter(([face,r])=>face&&r));
assert.equal(rotations.size,6);
const faceOfVector=v=>FACE_LIST.find(face=>same(faceNormal(face),v));
for (const face of FACE_LIST) {
    const angles=rotations.get(face);
    assert.deepEqual(worldBox(cubeOf(cornerGeo,`center_${face}`)),worldBox(cubeOf(cableGeo,'center'),angles),`${face} center matches a cable on ${face}`);
    for (const arm of ARM_NAMES) {
        const toward=faceOfVector(worldOffset(face,arm));
        assert.deepEqual(worldBox(cubeOf(cornerGeo,`arm_${face}_${toward}`)),worldBox(cubeOf(cableGeo,arm.replace('local_','arm_')),angles),
            `${face} arm toward ${toward} matches cable ${arm}`);
    }
    // The shell hugs this face's own support, never the opposite wall.
    const box=worldBox(cubeOf(cornerGeo,`center_${face}`));
    const normal=faceNormal(face), axis=normal.findIndex(v=>v);
    const distance=normal[axis]>0 ? box[axis].map(v=>v+8) : box[axis].map(v=>8-v).reverse();
    assert.ok(same(distance,[0.02,0.14]),`${face} center lies on its support side`);
}
const surfaceNames={0:['east','west'],1:['up','down'],2:['north','south']};
const uAxis={0:2,1:0,2:0};
for (const face of FACE_LIST) {
    const axis=faceNormal(face).findIndex(v=>v);
    for (const name of surfaceNames[axis]) {
        assert.deepEqual(cubeOf(cornerGeo,`center_${face}`).uv[name],{uv:[13,13],uv_size:[6,6],material_instance:'hub'},`${face} hub pixels`);
    }
    for (const toward of tangentFaces(face)) {
        const along=faceNormal(toward).findIndex(v=>v);
        for (const name of surfaceNames[axis]) {
            const uv=cubeOf(cornerGeo,`arm_${face}_${toward}`).uv[name];
            assert.deepEqual([uv.uv,uv.uv_size],[[19,14],[5,4]],`${face} ${toward} samples the conductor strip`);
            assert.equal(uv.uv_rotation||0,uAxis[axis]===along?0:90,`${face} ${toward} strip runs along the arm`);
        }
    }
}
// On the floor the corner uses exactly the cable's face UVs.
for (const arm of ARM_NAMES) {
    const toward=faceOfVector(worldOffset('up',arm));
    assert.deepEqual(cubeOf(cornerGeo,`arm_up_${toward}`).uv,cubeOf(cableGeo,arm.replace('local_','arm_')).uv);
}
assert.deepEqual(cubeOf(cornerGeo,'center_up').uv,cubeOf(cableGeo,'center').uv);

// --- Runtime helpers ------------------------------------------------------------
const definitions=new Map();
mc.system.beforeEvents={startup:{subscribe(callback){callback({blockComponentRegistry:{registerCustomComponent(id,component){definitions.set(id,component);}}});}}};
registerCableComponent();
const component=definitions.get('starstone:inner_corner');
assert.ok(component?.beforeOnPlayerPlace);
function visibleBones(corner) {
    const s={};
    for (const name of ['starstone:face_mask_low','starstone:face_mask_high','starstone:arms_low','starstone:arms_high'])
        s[name]=corner.permutation.getState(name);
    return Object.keys(compiled).filter(bone=>compiled[bone](s)).sort();
}
const bones=(...names)=>names.sort();
// Place as a player would: the before event sees air, then onPlace runs on
// the block created from the chosen permutation.
function place(f,x,y,z,face) {
    const air=f.put('minecraft:air',x,y,z);
    const initial=f.put('starstone:inner_corner',x,y,z);
    const event={dimension:f.dim,block:air,face,cancel:false,permutationToPlace:initial.permutation};
    f.put('minecraft:air',x,y,z);
    component.beforeOnPlayerPlace(event);
    assert.equal(event.cancel,false);
    const corner=f.put('starstone:inner_corner',x,y,z);
    corner.permutation=event.permutationToPlace;
    component.onPlace({block:corner});
    flushPending();
    return f.store.get(`${x},${y},${z}`);
}
function settle(...blocks) {
    for (const block of blocks) scheduleAffected(block);
    flushPending(); flushPending();
}
const stones=(f,list)=>list.forEach(([x,y,z])=>f.put('minecraft:stone',x,y,z));

// --- Floor-wall bend: arms only toward contacted neighbors ---------------------
const f=fixture(); f.dim.id='test:inner';
stones(f,[[0,-1,0],[-1,0,0],[1,-1,0],[-1,1,0],[-1,2,0],[1,0,1]]);
const corner=place(f,0,0,0,'up');
assert.equal(pairFromPermutation(corner.permutation),'up_east');
assert.equal(armsFromPermutation(corner.permutation),0);
assert.deepEqual(visibleBones(corner),bones('center_up','center_east','arm_up_west','arm_east_down'),
    'a bare floor-wall corner shows only its L bend');
assert.equal(isSupportValid(corner),true,'both faces retain full support');
f.store.delete('-1,0,0');
assert.equal(isSupportValid(corner),false,'loss of either support invalidates a two-face bend');
f.put('minecraft:stone',-1,0,0);

const floor=f.put('starstone:cable',1,0,0,{'minecraft:block_face':'up'});
settle(floor);
assert.equal(armsFromPermutation(corner.permutation),1<<ARM_BIT.up.east,'floor cable draws the floor arm only');
assert.ok(visibleBones(corner).includes('arm_up_east'));
assert.ok(!visibleBones(corner).includes('arm_east_north') && !visibleBones(corner).includes('arm_east_south'));
assert.equal(floor.permutation.getState('starstone:connections'),8,'floor cable draws its west arm into the bend');
const wall=f.put('starstone:cable',0,1,0,{'minecraft:block_face':'east'});
settle(wall);
assert.equal(armsFromPermutation(corner.permutation),(1<<ARM_BIT.up.east)|(1<<ARM_BIT.east.up));
assert.equal(wall.permutation.getState('starstone:connections'),4,'wall cable draws its down arm into the bend');
// A cable on a face this corner does not support is not a contact.
const stranger=f.put('starstone:cable',0,0,1,{'minecraft:block_face':'west'});
settle(stranger);
assert.equal(pairFromPermutation(corner.permutation),'up_east','an unsupported face never grows');
assert.equal(armsFromPermutation(corner.permutation),(1<<ARM_BIT.up.east)|(1<<ARM_BIT.east.up),'missing neighbor faces draw no arm');
assert.equal(stranger.permutation.getState('starstone:connections'),0);
f.store.delete('0,0,1');
// Breaking a neighbor removes only that arm.
f.store.delete('0,1,0');
settle(wall);
assert.equal(armsFromPermutation(corner.permutation),1<<ARM_BIT.up.east,'broken neighbor arm disappears');
settle(f.put('starstone:cable',0,1,0,{'minecraft:block_face':'east'}));

const source=f.put('starstone:generator',2,0,0);
const lamp=f.put('starstone:lamp',0,2,0,{'minecraft:block_face':'east'});
settle(source,lamp);
const livePromise=discoverNetwork(source); await drain();
const live=await livePromise;
assert.ok(live.nodes.has(`${f.dim.id}|0|2|0#main`),'source reaches lamp up wall through inner bend');
const entries=[source,floor,corner,f.store.get('0,1,0'),lamp].map(b=>({location:b.location,descriptor:descriptorForBlock(b)}));
const graph=buildSegmentGraph([buildChunkSegments(f.dim.id,0,0,entries)]);
assert.equal(graph.networks.length,1,'saved segment graph preserves inner bend');
assert.equal(graph.networks[0].powered,true);

// --- Inner corner next to an outer corner: floor, up the wall, over its top -------
// The corner sits at x=16 and the cable on the wall top at x=15, so the outside
// edge also crosses a chunk border.
const lul=fixture(); lul.dim.id='test:left_up_left';
stones(lul,[[16,-1,0],[17,-1,0],[15,0,0],[14,0,0],[13,0,0]]);
const lulSource=lul.put('starstone:generator',18,0,0);
const lulFloor=lul.put('starstone:cable',17,0,0,{'minecraft:block_face':'up'});
const lulTop=lul.put('starstone:cable',15,1,0,{'minecraft:block_face':'up'});
const lulTop2=lul.put('starstone:cable',14,1,0,{'minecraft:block_face':'up'});
const lulLamp=lul.put('starstone:lamp',13,1,0,{'minecraft:block_face':'up'});
const lulCorner=place(lul,16,0,0,'up');
settle(lulCorner,lulFloor,lulTop,lulTop2,lulLamp,lulSource);
assert.equal(pairFromPermutation(lulCorner.permutation),'up_east');
assert.equal(armsFromPermutation(lulCorner.permutation),(1<<ARM_BIT.up.east)|(1<<ARM_BIT.east.up),
    'the wall face draws its arm up to the outside edge');
assert.ok(visibleBones(lulCorner).includes('arm_east_up'));
assert.equal(lulTop.permutation.getState('starstone:connections'),2|8,'wall-top cable draws its arm over the edge to the corner');
const lulPromise=discoverNetwork(lulSource); await drain();
assert.ok((await lulPromise).nodes.has('test:left_up_left|13|1|0#main'),'power runs floor -> inner corner -> over the edge');
const lulSegments=[0,1].map(cx=>buildChunkSegments(lul.dim.id,cx,0,[lulSource,lulFloor,lulCorner,lulTop,lulTop2,lulLamp]
    .filter(b=>b.location.x>>4===cx).map(b=>({location:b.location,descriptor:descriptorForBlock(b)}))));
const lulGraph=buildSegmentGraph(lulSegments);
assert.equal(lulGraph.networks.length,1,'saved diagonal corner contact joins across the chunk border');
assert.equal(lulGraph.networks[0].powered,true);
// A corner whose arm toward the edge ends in its own ceiling support cannot wrap.
assert.equal(outerWrap({kind:'inner-corner',facePair:'up_down_east'},{kind:'cable',mountFace:'up'},[-1,1,0]),undefined);
assert.deepEqual(outerWrap({kind:'inner-corner',facePair:'up_east'},{kind:'inner-corner',facePair:'up_south'},[-1,1,0]),
    {fromFace:'east',toFace:'up'},'two inner corners wrap one edge too');
// Placing the corner after both cables still picks the wall face from the edge.
lul.store.delete('16,0,0');
lul.put('minecraft:stone',16,0,1);
const lulAgain=place(lul,16,0,0,'up');
assert.equal(pairFromPermutation(lulAgain.permutation),'up_east','outer contact selects the wall, not the bare side wall');

// --- Wall-wall bend on a vertical edge ----------------------------------------
const ww=fixture(); ww.dim.id='test:wallwall';
stones(ww,[[-1,0,0],[0,0,1]]);
const wallCorner=place(ww,0,0,0,'east');
assert.equal(pairFromPermutation(wallCorner.permutation),'north_east');
assert.deepEqual(visibleBones(wallCorner),bones('center_north','center_east','arm_north_west','arm_east_south'),
    'wall-wall corner bends into the shared vertical edge');

// --- Stacked corners carry power and draw vertical arms -------------------------
const st=fixture(); st.dim.id='test:stacked';
stones(st,[[-1,0,0],[0,0,1],[-1,1,0],[0,1,1],[-1,2,0]]);
const low=place(st,0,0,0,'east');
const high=place(st,0,1,0,'east');
settle(low,high);
assert.equal(pairFromPermutation(high.permutation),'north_east');
assert.equal(armsFromPermutation(low.permutation),(1<<ARM_BIT.north.up)|(1<<ARM_BIT.east.up),'lower corner draws both shared faces up');
assert.equal(armsFromPermutation(high.permutation),(1<<ARM_BIT.north.down)|(1<<ARM_BIT.east.down),'upper corner draws both shared faces down');
const stGenerator=st.put('starstone:generator',0,-1,0);
const stLamp=st.put('starstone:lamp',0,2,0,{'minecraft:block_face':'east'});
settle(stGenerator,stLamp);
assert.equal(pairFromPermutation(low.permutation),'north_east','a generator below is a contact, not a new floor face');
assert.ok(armsFromPermutation(high.permutation)&(1<<ARM_BIT.east.up),'upper corner reaches the lamp');
assert.ok(!(armsFromPermutation(high.permutation)&(1<<ARM_BIT.north.up)),'no arm on a face the lamp does not use');
const stackPromise=discoverNetwork(stGenerator); await drain();
const stack=await stackPromise;
assert.ok(stack.nodes.has('test:stacked|0|2|0#main'),'power climbs through stacked corners');
const stackGraph=buildSegmentGraph([buildChunkSegments(st.dim.id,0,0,[stGenerator,low,high,stLamp]
    .map(b=>({location:b.location,descriptor:descriptorForBlock(b)})))]);
assert.equal(stackGraph.networks.length,1);
assert.equal(stackGraph.networks[0].powered,true);

// --- Floor with several walls ------------------------------------------------------
const tr=fixture(); tr.dim.id='test:trench';
stones(tr,[[0,-1,0],[-1,0,0],[1,0,0],[0,-1,-1],[-1,0,-1],[1,0,-1]]);
tr.put('starstone:cable',0,0,-1,{'minecraft:block_face':'up'});
const trench=place(tr,0,0,0,'up');
assert.equal(pairFromPermutation(trench.permutation),'up_east_west','a floor contact alone uses both trench walls');
assert.deepEqual(visibleBones(trench),bones('center_up','center_east','center_west','arm_up_west','arm_up_east',
    'arm_east_down','arm_west_down','arm_up_north'));

// Growth: a conductor on another supported face joins it; support loss shrinks.
const gr=fixture(); gr.dim.id='test:grow';
stones(gr,[[0,-1,0],[-1,0,0],[1,0,-1]]);
const grow=place(gr,0,0,0,'up');
assert.equal(pairFromPermutation(grow.permutation),'up_east');
gr.put('minecraft:stone',0,0,-1);
const southCable=gr.put('starstone:cable',1,0,0,{'minecraft:block_face':'south'});
settle(southCable);
assert.equal(pairFromPermutation(grow.permutation),'up_south_east','a cable on a supported face grows the corner');
assert.equal(armsFromPermutation(grow.permutation),1<<ARM_BIT.south.east);
assert.ok(visibleBones(grow).includes('arm_south_west') && visibleBones(grow).includes('arm_south_down'),'new face bends into the others');
assert.equal(southCable.permutation.getState('starstone:connections'),computeCableMask(southCable));
assert.notEqual(southCable.permutation.getState('starstone:connections'),0,'grown face gives the cable an arm');
await drain();
const growPromise=discoverNetwork(southCable); await drain();
assert.ok((await growPromise).nodes.has('test:grow|0|0|0#main'),'grown face joins the network');
gr.store.delete('0,0,-1');
settle(grow);
assert.equal(gr.store.has('0,0,0'),true,'losing one of three supports keeps the corner');
assert.equal(pairFromPermutation(grow.permutation),'up_east','and drops only that face');
assert.equal(armsFromPermutation(grow.permutation),0);

// --- Placement selection and support rules -----------------------------------------
const hl=fixture(); hl.dim.id='test:hole';
stones(hl,[[0,-1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1]]);
const holeCorner=place(hl,0,0,0,'up');
assert.equal(pairFromPermutation(holeCorner.permutation),'up_north_south_east_west');
const deferredAir=hl.put('minecraft:air',5,0,0);
const deferred={dimension:{getBlock(){return undefined;}},block:deferredAir,face:'up',cancel:false,
    permutationToPlace:hl.put('starstone:inner_corner',6,0,0).permutation};
component.beforeOnPlayerPlace(deferred);
assert.equal(deferred.cancel,false,'unavailable pre-place reads must not silently cancel placement');
const unresolved=hl.put('starstone:inner_corner',0,0,0);
component.onPlace({block:unresolved});
assert.equal(pairFromPermutation(unresolved.permutation),'up_north_south_east_west',
    'onPlace resolves all supported faces when the before event could not read them');
hl.store.delete('1,0,0');
assert.equal(isSupportValid(unresolved),true,'a five-face corner keeps a bend after losing one wall');
settle(unresolved);
assert.equal(pairFromPermutation(unresolved.permutation),'up_north_south_east');

const sel=fixture(); sel.dim.id='test:selective';
stones(sel,[[0,-1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,1,0],[1,-1,0],[-1,1,0]]);
sel.put('starstone:cable',1,0,0,{'minecraft:block_face':'up'});
sel.put('starstone:cable',0,1,0,{'minecraft:block_face':'east'});
const selective=place(sel,0,0,0,'up');
assert.equal(pairFromPermutation(selective.permutation),'up_east',
    'bare walls and ceiling do not acquire wire when two contacted faces are known');

// An unreadable support is not proof that it vanished.
f.unloaded.add('-1,0,0');
assert.equal(computeInnerCornerState(corner),null);
f.unloaded.delete('-1,0,0');

// --- Saved graphs across chunk borders -------------------------------------------------
const edgeA=buildChunkSegments(f.dim.id,0,0,[
    {location:{x:15,y:0,z:0},descriptor:innerCornerDescriptor({facePair:'up_east'})}
]);
const edgeB=buildChunkSegments(f.dim.id,1,0,[
    {location:{x:16,y:0,z:0},descriptor:cableDescriptor({mountFace:'up',connections:15})}
]);
assert.equal(buildSegmentGraph([edgeA,edgeB]).networks.length,1,
    'saved face-pair boundary joins the correctly mounted cable across chunks');
const wrongFace=buildChunkSegments(f.dim.id,1,0,[
    {location:{x:16,y:0,z:0},descriptor:cableDescriptor({mountFace:'north',connections:15})}
]);
assert.equal(buildSegmentGraph([edgeA,wrongFace]).networks.length,2,
    'saved face-pair boundary rejects a cable mounted on the wrong plane');
const row=(id,a,b)=>[[15,a],[16,b]].map(([x,pair])=>buildChunkSegments(id,x>>4,0,[
    {location:{x,y:0,z:0},descriptor:innerCornerDescriptor({facePair:pair})}]));
assert.equal(buildSegmentGraph(row('test:row','up_south','up_south')).networks.length,1,'corners along one edge join across a chunk border');
assert.equal(buildSegmentGraph(row('test:row2','up_south','down_south')).networks.length,1,'corners sharing only the wall join along it');
assert.equal(buildSegmentGraph(row('test:row3','up_south','down_north')).networks.length,2,'corners without a shared face stay separate');
const hub=innerCornerDescriptor({facePair:'up_north_south_east_west'});
const branches=[
    [[1,0,0],'up'], [[0,1,0],'north'], [[-1,0,0],'south'],
    [[0,0,1],'east'], [[0,0,-1],'west']
];
const multiEntries=[{location:{x:0,y:0,z:0},descriptor:hub},
    ...branches.map(([p,face])=>({location:{x:p[0],y:p[1],z:p[2]},
        descriptor:cableDescriptor({mountFace:face,connections:15})}))];
const multiSegments=buildChunkSegments('test:multi',0,0,multiEntries.filter(e=>e.location.x>=0&&e.location.z>=0));
const multiOther=[
    buildChunkSegments('test:multi',-1,0,multiEntries.filter(e=>e.location.x<0)),
    buildChunkSegments('test:multi',0,-1,multiEntries.filter(e=>e.location.z<0))
];
const multiGraph=buildSegmentGraph([multiSegments,...multiOther]);
assert.equal(multiGraph.networks.length,1,'all five selected faces join across chunk boundaries');
assert.equal(multiGraph.networks[0].nodes.size,6);
const liveHub=fixture(); liveHub.dim.id='test:multi_live';
const center=liveHub.put('starstone:inner_corner',0,0,0,
    {'starstone:face_mask_low':13,'starstone:face_mask_high':3});
for (const [p,face] of branches) liveHub.put('starstone:cable',...p,
    {'minecraft:block_face':face,'starstone:connections':15});
const joinedPromise=discoverNetwork(center); await drain();
assert.equal((await joinedPromise).nodes.size,6,'live traversal reaches every selected face');

// --- Support removal destroys a corner left without a bend ---------------------------------
f.store.delete('-1,0,0');
scheduleAffected(corner);
flushPending();
await drain();
assert.equal(f.store.has('0,0,0'),false,'support loss destroys unsupported corner');
console.log('inner corner: contact arms, cable-matched geometry, wall/stacked/multi-face bends, growth, support loss and saved graphs passed');
