// Two surface cables can wrap an outside edge when mounted on perpendicular
// faces of the same full support cube. Their occupied cells are diagonal; the
// surfaces meet at the cube edge. An inner corner's faces wrap the same way,
// so a run can go floor -> inner corner -> wall -> over the top edge.
import { FACE_LIST, faceNormal } from "./surfaceFrame.js";
import { facesOfPair, oppositeFace, externalArms, tangentFaces } from "./innerCorner.js";

const equal = (a, b) => a.every((value, i) => value === b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function outerCornerOffset(fromFace, toFace) {
    const a = faceNormal(fromFace), b = faceNormal(toFace);
    if (dot(a, b) !== 0) return undefined;
    return b.map((value, i) => value - a[i]);
}

export function outerCornerContact(from, to, delta, fromPort, toPort) {
    if (from?.kind !== "cable" || to?.kind !== "cable" ||
        !from.mountFace || !to.mountFace) return false;
    const expected = outerCornerOffset(from.mountFace, to.mountFace);
    if (!expected || !equal(expected, delta)) return false;
    const a = faceNormal(from.mountFace), b = faceNormal(to.mountFace);
    // Each arm must actually point toward the shared outside edge.
    return equal(fromPort, b) && equal(toPort, a);
}

// The surfaces a conductor can carry around an outside edge.
export function wrapFaces(descriptor) {
    if (descriptor?.kind === "cable") return descriptor.mountFace ? [descriptor.mountFace] : [];
    if (descriptor?.kind === "inner-corner") return facesOfPair(descriptor.facePair) || [];
    return [];
}

// The faces joined when `from` and `to` (at `delta` from it) wrap one outside
// edge, or undefined. An inner corner's arm toward that edge must be external:
// an arm ending in another of its own supports cannot reach the edge.
export function outerWrap(from, to, delta) {
    const fromFaces = wrapFaces(from), toFaces = wrapFaces(to);
    for (const fromFace of fromFaces) for (const toFace of toFaces) {
        const expected = outerCornerOffset(fromFace, toFace);
        if (!expected || !equal(expected, delta)) continue;
        if (from.kind === "inner-corner" && fromFaces.includes(oppositeFace(toFace))) continue;
        if (to.kind === "inner-corner" && toFaces.includes(oppositeFace(fromFace))) continue;
        return { fromFace, toFace };
    }
    return undefined;
}

// Diagonal offsets a conductor may reach through its arm toward `armDir`.
export function outerOffsets(descriptor, armDir) {
    const edgeFace = FACE_LIST.find(face => equal(faceNormal(face), armDir));
    if (!edgeFace) return [];
    const faces = wrapFaces(descriptor);
    return faces.filter(face => dot(faceNormal(face), armDir) === 0 &&
        !(descriptor.kind === "inner-corner" && faces.includes(oppositeFace(edgeFace))))
        .map(face => outerCornerOffset(face, edgeFace));
}

// External inner-corner arms that wrap an outside edge. diagonalAt(offset)
// returns the descriptor at that diagonal offset.
export function innerOuterArmBits(pair, diagonalAt) {
    const faces = facesOfPair(pair);
    if (!faces) return 0;
    const self = { kind: "inner-corner", facePair: pair };
    let bits = 0;
    for (const { face, toward, bit } of externalArms(faces)) {
        const offset = outerCornerOffset(face, toward);
        const wrap = offset && outerWrap(self, diagonalAt(offset), offset);
        if (wrap && wrap.fromFace === face) bits |= 1 << bit;
    }
    return bits;
}

// Supported faces whose edge already wraps to a conductor on a neighbor face.
export function outerContactedFaces(supported, diagonalAt) {
    return supported.filter(face => tangentFaces(face).some(toward => {
        if (supported.includes(oppositeFace(toward))) return false;
        const offset = outerCornerOffset(face, toward);
        return Boolean(outerWrap({ kind: "cable", mountFace: face }, diagonalAt(offset), offset));
    }));
}
