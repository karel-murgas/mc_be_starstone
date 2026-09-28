const NONE = "none";
const FULL = "full";
const DOUBLE_SLAB = "double_slab";
const SINGLE_SLAB_TOP = "slab_top";
const SINGLE_SLAB_BOTTOM = "slab_bottom";
const STAIR_NORMAL = "stair_normal";
const STAIR_UPSIDE_DOWN = "stair_upside_down";
const PARTIAL = "partial";

export const SUPPORT_SHAPE = {
    NONE,
    FULL,
    DOUBLE_SLAB,
    SINGLE_SLAB_TOP,
    SINGLE_SLAB_BOTTOM,
    STAIR_NORMAL,
    STAIR_UPSIDE_DOWN,
    PARTIAL
};

const FACES = new Set(["up", "down", "north", "south", "east", "west"]);

export function supportMountAllowed(shape, mountFace) {
    if (!FACES.has(mountFace)) return false;
    switch (shape) {
        case FULL:
        case DOUBLE_SLAB:
            return true;
        case SINGLE_SLAB_TOP:
            return mountFace === "up";
        case SINGLE_SLAB_BOTTOM:
            return mountFace === "down";
        case STAIR_UPSIDE_DOWN:
            return mountFace === "up";
        case STAIR_NORMAL:
            return mountFace === "down";
        default:
            return false;
    }
}
