// portDirections.js
//
// Pure port -> world direction resolution for the Starstone electrical graph
// (Task 3.5A).
//
// A descriptor port is one of three things:
//   - an absolute world_* direction (conduits, and the full-cube generator which
//     has no mounting face and still contacts all six faces);
//   - the "back" contact of a surface element, which points along the support
//     offset toward the supporting block one way along the mount face;
//   - a local tangent arm of the element's own mount face.
//
// The "back" contact resolves to supportOffset(mountFace), NOT to worldOffset,
// which only knows the four local arms. Resolving it here keeps the graph
// traversal correct for backed cables and keeps this module free of
// @minecraft/server so the traversal code stays testable outside Minecraft.
//
// Pure data and functions only. No Minecraft imports, no side effects at load.

import { worldOffset, supportOffset } from "./surfaceFrame.js";
import { BACK_PORT } from "./constants.js";

// Absolute world directions as unit world vectors (Bedrock: +X east, +Y up,
// +Z south). These are the only ports a mount-face-less source such as the
// generator exposes, and they resolve the same way whether or not a descriptor
// has a mount face.
export const WORLD_PORTS = {
    world_up: [0, 1, 0],
    world_down: [0, -1, 0],
    world_north: [0, 0, -1],
    world_south: [0, 0, 1],
    world_east: [1, 0, 0],
    world_west: [-1, 0, 0]
};

// Resolve a descriptor port to the unit world vector that reaches its neighbour.
// Absolute world_* ports resolve regardless of mount face. The back contact
// points along the support offset when the element has a mount face (a source
// with no mount face, like the generator, never has a back port). Anything
// else is a local tangent arm of the mount face. Returns undefined when a back
// port or arm cannot be resolved without a mount face.
export function worldDirOfPort(mountFace, port) {
    if (port in WORLD_PORTS) {
        return WORLD_PORTS[port];
    }
    if (port === BACK_PORT) {
        return mountFace ? supportOffset(mountFace) : undefined;
    }
    if (mountFace) {
        return worldOffset(mountFace, port);
    }
    return undefined;
}
