import { LiquidType, system } from "@minecraft/server";
import { supportOffset } from "./surfaceFrame.js";
import { SUPPORT_SHAPE, supportMountAllowed } from "./supportPolicy.js";
import { GENERATOR_ID, CONDUIT_ID, CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID } from "./constants.js";
import { innerSupports, pairFromPermutation, stateOfFaces } from "./innerCorner.js";

const TAG = "[Starstone]";
const FULL_STARSTONE = new Set([GENERATOR_ID, CONDUIT_ID]);
const THIN_STARSTONE = new Set([CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID]);

export function mountFace(block) {
    if (!block || !block.isValid) return undefined;
    try {
        return block.permutation.getState("minecraft:block_face");
    } catch {
        return undefined;
    }
}

export function supportBlock(block) {
    const face = mountFace(block);
    if (!face) return undefined;
    const off = supportOffset(face);
    const l = block.location;
    const location = {
        x: Math.floor(l.x) + off[0],
        y: Math.floor(l.y) + off[1],
        z: Math.floor(l.z) + off[2]
    };
    try {
        if (block.dimension.isChunkLoaded?.(location) === false) return undefined;
        return block.dimension.getBlock(location);
    } catch { return undefined; }
}

function readState(block, name) {
    try {
        return block.permutation.getState(name);
    } catch {
        return undefined;
    }
}

function isSupportable(block) {
    if (!block || !block.isValid) return false;
    try {
        if (block.isAir) return false;
        if (block.isLiquid) return false;
    } catch {
        return false;
    }
    return true;
}

function isFullSupportSafe(block) {
    // Custom full cubes do not have to report vanilla liquid-blocking traits.
    // Thin Starstone surfaces never support another surface, even if a future
    // engine revision reports their permutation as liquid blocking.
    if (THIN_STARSTONE.has(block.typeId)) return false;
    if (FULL_STARSTONE.has(block.typeId)) return true;
    try {
        return block.permutation.isLiquidBlocking(LiquidType.Water);
    } catch {
        return false;
    }
}

const PARTIAL_MARKERS = [
    "fence",
    "fence_gate",
    "wall",
    "pane",
    "door",
    "trapdoor",
    "button",
    "plate",
    "rail",
    "carpet",
    "sign",
    "torch",
    "chest",
    "hopper",
    "scaffolding",
    "snow_layer",
    "leaves",
    "lily_pad",
    "reeds"
];

function isPartialById(id) {
    return PARTIAL_MARKERS.some((marker) => id.includes(marker));
}

function classifySupport(support) {
    if (!isSupportable(support)) return SUPPORT_SHAPE.NONE;
    const id = support.typeId.toLowerCase();
    if (id.includes("slab")) {
        if (id.includes("double")) {
            return SUPPORT_SHAPE.DOUBLE_SLAB;
        }
        switch (readState(support, "minecraft:vertical_half")) {
            case "top":
                return SUPPORT_SHAPE.SINGLE_SLAB_TOP;
            case "bottom":
                return SUPPORT_SHAPE.SINGLE_SLAB_BOTTOM;
            default:
                return SUPPORT_SHAPE.PARTIAL;
        }
    }
    if (id.endsWith("stairs")) {
        const upsideDown = readState(support, "upside_down_bit");
        if (upsideDown === true || upsideDown === "true") {
            return SUPPORT_SHAPE.STAIR_UPSIDE_DOWN;
        }
        return SUPPORT_SHAPE.STAIR_NORMAL;
    }
    if (isPartialById(id)) return SUPPORT_SHAPE.PARTIAL;
    return SUPPORT_SHAPE.FULL;
}

export function isSupportValid(block) {
    if (block?.type?.id === INNER_CORNER_ID) {
        const pair=pairFromPermutation(block.permutation);
        const supports=innerSupports(block.location,pair);
        if (!supports) return false;
        // A multi-face corner survives losing one face while the remaining
        // supported faces still form a bend; the refresh then drops that face.
        const kept=supports.filter(({face,position})=>{
            try {
                if (block.dimension.isChunkLoaded?.(position) === false) return false;
                return isFaceSupportValid(block.dimension.getBlock(position),face);
            } catch { return false; }
        }).map(({face})=>face);
        return stateOfFaces(kept) !== undefined;
    }
    const support = supportBlock(block);
    const face = mountFace(block);
    return isFaceSupportValid(support,face);
}

// Also used by the player pre-place hook, where the surface Block has not
// entered the world yet. Keeping one policy avoids a one-tick invalid block.
export function isFaceSupportValid(support, face) {
    if (!support || !support.isValid) return false;
    const shape = classifySupport(support);
    if (!face) return false;
    if (shape === SUPPORT_SHAPE.NONE || shape === SUPPORT_SHAPE.PARTIAL) return false;
    if (shape === SUPPORT_SHAPE.FULL) return supportMountAllowed(shape,face) && isFullSupportSafe(support);
    return supportMountAllowed(shape, face);
}

export function dropAndClear(block, afterRemoval = () => {}) {
    const dimension = block.dimension;
    const location = { ...block.location };
    const typeId = block.type.id;
    system.run(() => {
        try {
            const current = dimension.getBlock(location);
            if (!current?.isValid || current.type.id !== typeId) return;
            const l = location;
            dimension.runCommand(
                `setblock ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} air destroy`
            );
            afterRemoval();
        } catch (err) {
            console.warn(`${TAG} Could not drop unsupported cable: ${err.message}`);
        }
    });
}
