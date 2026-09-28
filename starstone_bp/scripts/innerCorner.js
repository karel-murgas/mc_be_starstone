import { FACE_LIST, faceNormal, supportOffset } from "./surfaceFrame.js";
import { worldDirOfPort } from "./portDirections.js";

const same=(a,b)=>a.every((value,i)=>value===b[i]);
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const negate=v=>v.map(value=>-value||0);
// Keep the original two-face state names stable for existing placed corners.
// Any set containing a perpendicular pair may share one joined conductor.
export const INNER_PAIRS=[];
for (let mask=0;mask<(1<<FACE_LIST.length);mask++) {
    const faces=FACE_LIST.filter((_,index)=>mask&(1<<index));
    if (faces.some((a,i)=>faces.slice(i+1).some(b=>dot(faceNormal(a),faceNormal(b))===0)))
        INNER_PAIRS.push(faces.join("_"));
}
export function facesOfPair(pair) {
    return INNER_PAIRS.includes(pair) ? pair.split("_") : undefined;
}
export function pairOfFaces(a,b) {
    return INNER_PAIRS.find(pair=>{const faces=pair.split("_");return faces.length===2&&faces.includes(a)&&faces.includes(b);});
}
export function stateOfFaces(faces) {
    const state=FACE_LIST.filter(face=>faces.includes(face)).join("_");
    return facesOfPair(state) ? state : undefined;
}
export function pairFromPermutation(permutation) {
    const low=permutation.getState("starstone:face_mask_low");
    const high=permutation.getState("starstone:face_mask_high");
    if (!Number.isInteger(low) || !Number.isInteger(high)) return undefined;
    const mask=low | (high << 4);
    return stateOfFaces(FACE_LIST.filter((_,index)=>mask & (1<<index)));
}
export function withFacePair(permutation,pair) {
    const faces=facesOfPair(pair);
    if (!faces) throw new Error(`Invalid inner corner faces: ${pair}`);
    const mask=FACE_LIST.reduce((bits,face,index)=>bits | (faces.includes(face) ? 1<<index : 0),0);
    return permutation.withState("starstone:face_mask_low",mask & 15)
        .withState("starstone:face_mask_high",mask >> 4);
}
// A face is a surface conductor, with four tangent edges just like a cable.
// The neighboring block determines which of those potential edges is active;
// merely having a second supported face must not connect an empty edge.
export function innerRoutes(pair) {
    const faces=facesOfPair(pair);
    if (!faces) return [];
    return faces.flatMap(face=>FACE_LIST.filter(other=>dot(faceNormal(face),faceNormal(other))===0)
        .map(other=>({direction:faceNormal(other),neighborFace:face})));
}
export function innerNeighborAllowed(corner,other,dir) {
    if (corner?.kind!=="inner-corner" || !other) return false;
    const neighborFaces=other.kind==="inner-corner" ? facesOfPair(other.facePair) :
        other.mountFace ? [other.mountFace] : undefined;
    return innerRoutes(corner.facePair).some(route=>same(route.direction,dir) &&
        (neighborFaces ? neighborFaces.includes(route.neighborFace) : other.kind==="source"));
}
export function innerSupports(location,pair) {
    const faces=facesOfPair(pair);
    return faces?.map(face=>{
        const off=supportOffset(face);
        return {face,position:{x:location.x+off[0],y:location.y+off[1],z:location.z+off[2]}};
    });
}

// --- Visual arms -------------------------------------------------------------
//
// Face f draws an arm toward tangent direction t. When the face whose support
// lies at t is also active, that arm is the internal bend into it and is always
// drawn. Otherwise it is an external arm, drawn only when the block at t carries
// a reciprocal conductor on the same face f.
//
// Each of the 24 arms has a fixed bit (0..7) in starstone:arms_low/high. The
// table is a colouring: for every valid face set, the external arms own distinct
// bits, so geometry visibility never depends on the face set's bit layout.
export const ARM_BIT={
    up:{north:0,south:1,east:2,west:3},
    down:{north:4,south:5,east:6,west:7},
    north:{up:6,down:3,east:1,west:5},
    south:{up:7,down:2,east:4,west:0},
    east:{up:5,down:0,north:7,south:3},
    west:{up:4,down:1,north:2,south:6}
};
export function oppositeFace(face) {
    return FACE_LIST.find(other=>same(faceNormal(other),negate(faceNormal(face))));
}
export function tangentFaces(face) {
    return FACE_LIST.filter(other=>dot(faceNormal(face),faceNormal(other))===0);
}
// The arm on `face` toward `toward` ends in the support of oppositeFace(toward).
export function isInternalArm(faces,face,toward) {
    return faces.includes(face) && faces.includes(oppositeFace(toward));
}
export function externalArms(faces) {
    return faces.flatMap(face=>tangentFaces(face).filter(toward=>!faces.includes(oppositeFace(toward)))
        .map(toward=>({face,toward,bit:ARM_BIT[face][toward]})));
}
export function armsFromPermutation(permutation) {
    const low=permutation.getState("starstone:arms_low");
    const high=permutation.getState("starstone:arms_high");
    return (Number.isInteger(low) ? low : 0) | ((Number.isInteger(high) ? high : 0) << 4);
}
export function withArms(permutation,bits) {
    return permutation.withState("starstone:arms_low",bits & 15)
        .withState("starstone:arms_high",(bits >> 4) & 15);
}
// True when `neighbor`, found one block from the corner along `toward`, has a
// conductor on `face` exposing a port back at the corner. Cables must be passed
// with their potential (all four) arms, as for ordinary cable masks.
export function neighborContactsFace(neighbor,face,toward) {
    if (!neighbor?.lanes || neighbor.kind==="conduit") return false;
    const back=negate(faceNormal(toward));
    if (neighbor.kind==="inner-corner")
        return innerNeighborAllowed(neighbor,{mountFace:face},back);
    if (neighbor.mountFace && neighbor.mountFace!==face) return false;
    if (!neighbor.mountFace && neighbor.kind!=="source") return false;
    return neighbor.lanes.some(lane=>[...(lane?.ports||[])].some(port=>{
        const direction=worldDirOfPort(neighbor.mountFace,port);
        return direction && same(direction,back);
    }));
}
// neighborAt(face) returns the descriptor of the block one step along that
// face's normal, or undefined when absent or unreadable.
export function innerArmBits(pair,neighborAt) {
    const faces=facesOfPair(pair);
    if (!faces) return 0;
    let bits=0;
    for (const {face,toward,bit} of externalArms(faces))
        if (neighborContactsFace(neighborAt(toward),face,toward)) bits|=1<<bit;
    return bits;
}
// Supported faces that a neighbor conductor already reaches from outside.
export function contactedFaces(supported,neighborAt) {
    return supported.filter(face=>tangentFaces(face).some(toward=>
        !supported.includes(oppositeFace(toward)) &&
        neighborContactsFace(neighborAt(toward),face,toward)));
}
