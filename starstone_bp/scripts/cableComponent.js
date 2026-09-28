import { world, system } from "@minecraft/server";
import { isSupportValid, isFaceSupportValid, dropAndClear, mountFace } from "./support.js";
import { worldOffset, ARM_NAMES, supportOffset, FACE_LIST, faceNormal } from "./surfaceFrame.js";
import { cableConnectionMask, ARM_BITS } from "./cableTopology.js";
import { outerCornerOffset, outerWrap, innerOuterArmBits, outerContactedFaces } from "./cornerTopology.js";
import { innerSupports, stateOfFaces, facesOfPair, pairFromPermutation, withFacePair,
    armsFromPermutation, withArms, innerArmBits, contactedFaces } from "./innerCorner.js";
import { descriptorForBlock, cableDescriptor } from "./electricalBlocks.js";
import { discoverAllLanes, captureRemovedNetworks, removeAndSplitNetwork } from "./networkController.js";
import { CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID, KIND_BY_ID } from "./constants.js";
import { placementIndex } from "./persistence.js";
import { trackInput, refreshAdapterVisuals } from "./redstoneAdapters.js";
import { queueMutation } from "./mutationController.js";

const SURFACES = new Set([CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID]);
const OFFSETS = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
for (let axis=0; axis<3; axis++) for (let other=axis+1; other<3; other++) {
    for (const a of [-1,1]) for (const b of [-1,1]) {
        const offset=[0,0,0]; offset[axis]=a; offset[other]=b; OFFSETS.push(offset);
    }
}
const same = (a,b) => a.every((value,i)=>value===b[i]);
const pending = new Map();
const discoveries = new Map();
function read(dim, location) {
    try {
        if (dim.isChunkLoaded?.(location) === false) return undefined;
        return dim.getBlock(location);
    } catch { return undefined; }
}
function queue(map, dim, location) {
    if (!map.has(dim)) map.set(dim, new Set());
    map.get(dim).add(`${location.x},${location.y},${location.z}`);
}
export function scheduleAffected(block) {
    const { dimension, location } = block;
    queue(pending, dimension, location);
    for (const [dx,dy,dz] of OFFSETS) {
        queue(pending, dimension, { x: location.x + dx, y: location.y + dy, z: location.z + dz });
    }
}
export function schedulePlaced(block) {
    trackInput(block);
    try {
        placementIndex.record(block);
    } catch (err) {
        // A persistence failure must not stop the live network from updating.
        console.warn(`[Starstone] Could not persist placement: ${err.message}`);
    }
    scheduleAffected(block);
    queue(discoveries, block.dimension, block.location);
}

// A neighbor cable exposes potential contacts regardless of its old mask.
export function computeCableMask(block) {
    const face = mountFace(block);
    if (!face) return 0;
    const neighbors = {};
    for (const arm of ARM_NAMES) {
        const [dx,dy,dz] = worldOffset(face, arm);
        const { x,y,z } = block.location;
        const nb = read(block.dimension, { x: x+dx, y: y+dy, z: z+dz });
        if (!nb?.isValid) continue;
        neighbors[arm] = nb.type.id === CABLE_ID
            ? cableDescriptor({ mountFace: mountFace(nb), connections: 15 })
            : descriptorForBlock(nb);
    }
    let mask = cableConnectionMask(face, neighbors);
    const self = cableDescriptor({mountFace:face,connections:15});
    for (const arm of ARM_NAMES) {
        if (mask & ARM_BITS[arm]) continue;
        const towardEdge = worldOffset(face,arm);
        const otherFace = FACE_LIST.find(candidate => same(faceNormal(candidate),towardEdge));
        const offset = otherFace && outerCornerOffset(face,otherFace);
        if (!offset) continue;
        const {x,y,z}=block.location;
        const other = read(block.dimension,{x:x+offset[0],y:y+offset[1],z:z+offset[2]});
        if (!other?.isValid || (other.type.id !== CABLE_ID && other.type.id !== INNER_CORNER_ID)) continue;
        const otherMount = other.type.id === CABLE_ID ? mountFace(other) : undefined;
        if (other.type.id === CABLE_ID && !FACE_LIST.includes(otherMount)) continue;
        const descriptor = other.type.id === CABLE_ID
            ? cableDescriptor({mountFace:otherMount,connections:15}) : descriptorForBlock(other);
        if (outerWrap(self,descriptor,offset)?.toFace === otherFace) mask |= ARM_BITS[arm];
    }
    return mask;
}
function removeUnsupported(block) {
    const { x,y,z } = block.location;
    const snapshot = { dimension: block.dimension, location: { x,y,z } };
    const capture = captureRemovedNetworks(block.dimension, x,y,z);
    dropAndClear(block, () => {
        try {
            placementIndex.remove(snapshot.dimension.id, snapshot.location);
        } catch (err) {
            console.warn(`[Starstone] Could not persist support removal: ${err.message}`);
        }
        scheduleAffected(snapshot);
        removeAndSplitNetwork(capture).catch(err => console.warn(`[Starstone] Support split: ${err.message}`));
    });
}
// The descriptor seen from a neighboring surface. A cable exposes its potential
// arms regardless of its old mask, so contacts are symmetric on first sight.
function contactDescriptor(dimension, location) {
    const nb = read(dimension, location);
    if (!nb?.isValid) return undefined;
    return nb.type.id === CABLE_ID
        ? cableDescriptor({ mountFace: mountFace(nb), connections: 15 })
        : descriptorForBlock(nb);
}
function supportedFaces(dimension, location) {
    const result = [];
    for (const face of FACE_LIST) {
        const [dx,dy,dz] = supportOffset(face);
        const support = read(dimension, { x: location.x+dx, y: location.y+dy, z: location.z+dz });
        if (support && isFaceSupportValid(support, face)) result.push(face);
    }
    return result;
}
function neighborReader(dimension, location) {
    const cache = new Map();
    return face => {
        if (!cache.has(face)) {
            const [dx,dy,dz] = faceNormal(face);
            cache.set(face, contactDescriptor(dimension, { x: location.x+dx, y: location.y+dy, z: location.z+dz }));
        }
        return cache.get(face);
    };
}
// Descriptors one outside edge away, keyed by diagonal offset.
function diagonalReader(dimension, location) {
    const cache = new Map();
    return ([dx,dy,dz]) => {
        const key = `${dx},${dy},${dz}`;
        if (!cache.has(key))
            cache.set(key, contactDescriptor(dimension, { x: location.x+dx, y: location.y+dy, z: location.z+dz }));
        return cache.get(key);
    };
}
// The face set and visual arms an inner corner should show now. Returns
// undefined when fewer than two perpendicular faces keep support, and null
// when a support is unreadable, which is never proof that it was removed.
export function computeInnerCornerState(block) {
    const { dimension, location } = block;
    const active = facesOfPair(pairFromPermutation(block.permutation)) || [];
    for (const { position } of innerSupports(location, stateOfFaces(active)) || [])
        if (!read(dimension, position)) return null;
    const supported = supportedFaces(dimension, location);
    const neighborAt = neighborReader(dimension, location);
    const diagonalAt = diagonalReader(dimension, location);
    // A conductor that arrives on another supported face, directly or around
    // an outside edge, joins the corner; a face whose own support vanished is
    // dropped instead of the whole bend.
    const grown = [...contactedFaces(supported, neighborAt), ...outerContactedFaces(supported, diagonalAt)];
    const pair = stateOfFaces([...active.filter(face => supported.includes(face)), ...grown]);
    if (!pair) return undefined;
    return { pair, arms: innerArmBits(pair, neighborAt) | innerOuterArmBits(pair, diagonalAt) };
}
export function refreshInnerCorner(block, { notify = true } = {}) {
    if (!block?.isValid || block.type.id !== INNER_CORNER_ID) return;
    const next = computeInnerCornerState(block);
    if (next === null) return;
    if (next === undefined) { removeUnsupported(block); return; }
    const oldPair = pairFromPermutation(block.permutation);
    let permutation = block.permutation;
    if (oldPair !== next.pair) permutation = withFacePair(permutation, next.pair);
    if (armsFromPermutation(permutation) !== next.arms) permutation = withArms(permutation, next.arms);
    if (permutation === block.permutation) return;
    block.setPermutation(permutation);
    if (oldPair !== next.pair && notify) {
        // Other faces change which neighbors may draw arms and join the graph.
        scheduleAffected(block);
        try { queueMutation(block.dimension, block.location); }
        catch (err) { console.warn(`[Starstone] Inner corner rebuild: ${err.message}`); }
    }
}
// Repair refreshes masks before discovering graph edges.
export function refreshCable(block) {
    if (block?.isValid && block.type.id === INNER_CORNER_ID) refreshInnerCorner(block);
    if (block?.isValid && block.type.id === CABLE_ID) {
        const mask = computeCableMask(block);
        if (block.permutation.getState("starstone:connections") !== mask) {
            block.setPermutation(block.permutation.withState("starstone:connections", mask));
        }
    }
}
export function flushPending() {
    const work = [...pending];
    pending.clear();
    // Corners settle their faces first, so neighboring cables in the same pass
    // already see the faces they may connect to.
    for (const cornersPass of [true, false]) for (const [dim, positions] of work) {
        for (const key of positions) {
            const [x,y,z] = key.split(",").map(Number);
            const block = read(dim, { x,y,z });
            if (!block?.isValid || !SURFACES.has(block.type.id)) continue;
            if ((block.type.id === INNER_CORNER_ID) !== cornersPass) continue;
            try {
                let supports;
                if (block.type.id===INNER_CORNER_ID) {
                    supports=innerSupports(block.location,pairFromPermutation(block.permutation));
                } else {
                    const [dx,dy,dz]=supportOffset(mountFace(block));
                    supports=[{position:{x:x+dx,y:y+dy,z:z+dz}}];
                }
                // An unavailable support is not proof it was destroyed.
                if (!supports || supports.some(({position})=>!read(dim,position))) continue;
                if (!isSupportValid(block)) removeUnsupported(block);
                else if (block.type.id === CABLE_ID || block.type.id === INNER_CORNER_ID) refreshCable(block);
                else refreshAdapterVisuals(block);
            } catch (err) { console.warn(`[Starstone] Surface refresh: ${err.message}`); }
        }
    }
    const seeds = [...discoveries];
    discoveries.clear();
    for (const [dim, positions] of seeds) {
        for (const key of positions) {
            const [x,y,z] = key.split(",").map(Number);
            const block = read(dim, { x,y,z });
            if (!block?.isValid || !KIND_BY_ID[block.type.id]) continue;
            if (SURFACES.has(block.type.id) && !isSupportValid(block)) continue;
            discoverAllLanes(block).catch(err => console.warn(`[Starstone] Placement discovery: ${err.message}`));
        }
    }
}
function cornerPlacementState(dimension, location, clickedFace) {
    const supported=supportedFaces(dimension,location);
    const contacted=[...contactedFaces(supported,neighborReader(dimension,location)),
        ...outerContactedFaces(supported,diagonalReader(dimension,location))];
    // A block placer may target an existing thin cable rather than the bare
    // supporting face. The selected supports, not the clicked face, decide
    // whether this cell can contain an inner corner. Bare faces join only when
    // the contacted ones cannot form a bend on their own.
    const chosen=[...new Set([...contacted,...(supported.includes(clickedFace)?[clickedFace]:[])])];
    return stateOfFaces(chosen) || stateOfFaces(supported);
}
export function registerCableComponent() {
    system.beforeEvents.startup.subscribe(init => {
        const surface = {
            beforeOnPlayerPlace(event) {
                try {
                    const face = String(event.face).toLowerCase();
                    const [dx,dy,dz] = supportOffset(face);
                    const { x,y,z } = event.block.location;
                    const location = { x:x+dx, y:y+dy, z:z+dz };
                    const dimension = event.dimension;
                    if (dimension.isChunkLoaded?.(location) === false) { event.cancel = true; return; }
                    event.cancel = !isFaceSupportValid(dimension.getBlock(location), face);
                } catch {
                    // An unreadable support is not a valid player placement.
                    event.cancel = true;
                }
            },
            onPlace({ block }) { schedulePlaced(block); },
            onPlayerBreak({ block }) { scheduleAffected(block); }
        };
        init.blockComponentRegistry.registerCustomComponent("starstone:cable", surface);
        init.blockComponentRegistry.registerCustomComponent("starstone:bridge", surface);
        init.blockComponentRegistry.registerCustomComponent("starstone:surface", surface);
        init.blockComponentRegistry.registerCustomComponent("starstone:inner_corner", {
            beforeOnPlayerPlace(event) {
                try {
                    const face=String(event.face).toLowerCase();
                    const state=cornerPlacementState(event.dimension,event.block.location,face);
                    // Reads may be unavailable in this read-only callback. A
                    // missing result is rechecked after placement, where the
                    // world state is authoritative.
                    if (!state) return;
                    event.permutationToPlace=withFacePair(event.permutationToPlace,state);
                } catch (err) {
                    // Some world reads are unavailable during the read-only
                    // before event. Complete placement in onPlace instead.
                    console.warn(`[Starstone] Inner corner pre-place deferred: ${err.message}`);
                }
            },
            onPlace({block,player}) {
                try {
                    // Keep the face set chosen before placement while it is
                    // still supported; the clicked face is not available here.
                    const placed=pairFromPermutation(block.permutation);
                    const supported=supportedFaces(block.dimension,block.location);
                    const state=placed && facesOfPair(placed).every(face=>supported.includes(face))
                        ? placed : cornerPlacementState(block.dimension,block.location);
                    if (!state) {
                        system.run(()=>{
                            try { player?.sendMessage("[Starstone] Inner Corner needs two perpendicular solid support faces."); }
                            catch { /* Player may have left before the next tick. */ }
                        });
                        removeUnsupported(block);
                        return;
                    }
                    if (pairFromPermutation(block.permutation)!==state)
                        block.setPermutation(withFacePair(block.permutation,state));
                    // Placement discovery below rebuilds the graph once.
                    refreshInnerCorner(block,{notify:false});
                    schedulePlaced(block);
                } catch (err) {
                    console.warn(`[Starstone] Inner corner placement failed: ${err.message}`);
                    removeUnsupported(block);
                }
            },
            onPlayerBreak({block}) {scheduleAffected(block);}
        });
        init.blockComponentRegistry.registerCustomComponent("starstone:conduit", {
            beforeOnPlayerPlace(event) {
                const face = String(event.face).toLowerCase();
                const axis = face === "up" || face === "down" ? "y" :
                    face === "east" || face === "west" ? "x" : "z";
                event.permutationToPlace = event.permutationToPlace.withState("starstone:axis", axis);
            }
        });
    });
    world.afterEvents.playerBreakBlock.subscribe(event => {
        if (event.block) scheduleAffected(event.block);
    });
    world.afterEvents.playerPlaceBlock?.subscribe(event => {
        if (event.block) scheduleAffected(event.block);
    });
    system.runInterval(flushPending, 1);
}
