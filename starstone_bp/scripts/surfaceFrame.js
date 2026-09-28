// surfaceFrame.js
//
// The surface-frame table for Starstone surface devices.
//
// Every surface device (cable, bridge, generator, lamp, both adapters) mounts on
// exactly one of the six block faces of its support block. This module is the
// single authority that translates a mounting face plus a local arm into a world
// offset, and it exposes the support offset (the inverse of the outward face
// normal) used to validate the supporting block.
//
// Design rules:
// - Pure data and functions only. No Minecraft imports, no side effects at load.
// - The four local arms (local_n, local_e, local_s, local_w) are the canonical
//   cable arms defined by GRAPHICS.md. For each face they map to four unique
//   tangent world offsets that are perpendicular to the face normal.
// - local_n and local_s are one opposite pair; local_e and local_w are the other.
// - The frame is right-handed: local_e x local_n == normal for every face.

// World axes (Bedrock convention): +X east, +Y up, +Z south.
const WORLD_UP = [0, 1, 0];

export const FACE_LIST = ["up", "down", "north", "south", "east", "west"];

export const ARM_NAMES = ["local_n", "local_e", "local_s", "local_w"];

// Outward face normals as unit world vectors.
export const NORMALS = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0]
};

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function negate(v) {
  return [-v[0], -v[1], -v[2]];
}

// The horizontal tangent of a face: the tangent lying in the XZ plane.
// For the vertical faces this is cross(world_up, normal); for the horizontal
// faces (up/down) world_up is parallel to the normal so the tangent plane is
// the whole XZ plane and we fall back to the east axis.
function horizontalTangent(normal) {
  const candidate = cross(WORLD_UP, normal);
  if (candidate[0] === 0 && candidate[1] === 0 && candidate[2] === 0) {
    return [1, 0, 0];
  }
  return candidate;
}

// Build the four local arms for a face. local_e is the horizontal tangent and
// local_n is the remaining tangent (normal x local_e), which is vertical for the
// four wall faces and north/south for the floor/ceiling faces.
function armsForFace(normal) {
  const localE = horizontalTangent(normal);
  const localN = cross(normal, localE);
  return {
    local_n: localN,
    local_e: localE,
    local_s: negate(localN),
    local_w: negate(localE)
  };
}

const FRAME_CACHE = {};

FACE_LIST.forEach((face) => {
  FRAME_CACHE[face] = {
    face,
    normal: NORMALS[face],
    supportOffset: negate(NORMALS[face]),
    arms: armsForFace(NORMALS[face])
  };
});

export function isValidFace(face) {
  return Object.prototype.hasOwnProperty.call(NORMALS, face);
}

export function faceNormal(face) {
  if (!isValidFace(face)) {
    throw new Error(`Unknown face: ${face}`);
  }
  return NORMALS[face];
}

// The support offset is the inverse of the outward face normal: the world vector
// from the device toward the block that supports it.
export function supportOffset(face) {
  return FRAME_CACHE[face].supportOffset;
}

// The four tangent world offsets for the local arms of a face.
export function arms(face) {
  if (!isValidFace(face)) {
    throw new Error(`Unknown face: ${face}`);
  }
  return FRAME_CACHE[face].arms;
}

// The full frame for a face: normal, support offset, and four arm vectors.
export function frameForFace(face) {
  if (!isValidFace(face)) {
    throw new Error(`Unknown face: ${face}`);
  }
  return FRAME_CACHE[face];
}

// The world offset for a single local arm of a face, e.g.
// worldOffset("north", "local_n").
export function worldOffset(face, arm) {
  if (!isValidFace(face)) {
    throw new Error(`Unknown face: ${face}`);
  }
  if (!ARM_NAMES.includes(arm)) {
    throw new Error(`Unknown arm: ${arm}`);
  }
  return FRAME_CACHE[face].arms[arm];
}

export default {
  FACE_LIST,
  ARM_NAMES,
  NORMALS,
  isValidFace,
  faceNormal,
  supportOffset,
  arms,
  frameForFace,
  worldOffset
};
