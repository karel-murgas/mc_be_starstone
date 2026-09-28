// constants.js
//
// Central registry of every Starstone identifier used by the descriptor and
// graph systems: block ids, node lanes, block kinds, local arm names, descriptor
// port names, mounting faces, block-state names and conduit axis values.
//
// Pure data only. No Minecraft imports, no side effects at load.

// Block ids.
export const CABLE_ID = "starstone:cable";
export const INNER_CORNER_ID = "starstone:inner_corner";
export const BRIDGE_ID = "starstone:bridge";
export const CONDUIT_ID = "starstone:conduit";
export const ORE_ID = "starstone:ore";
export const GENERATOR_ID = "starstone:generator";
export const LAMP_ID = "starstone:lamp";
export const REDSTONE_INPUT_ID = "starstone:redstone_input";
export const REDSTONE_OUTPUT_ID = "starstone:redstone_output";

// Block kinds in the descriptor contract (plan section 5.4).
export const KIND_CABLE = "cable";
export const KIND_INNER_CORNER = "inner-corner";
export const KIND_BRIDGE = "bridge";
export const KIND_CONDUIT = "conduit";
export const KIND_SOURCE = "source";
export const KIND_CONSUMER = "consumer";
export const KIND_ADAPTER_IN = "adapter-in";
export const KIND_ADAPTER_OUT = "adapter-out";

// Map a block id to its descriptor kind.
export const KIND_BY_ID = {
    [CABLE_ID]: KIND_CABLE,
    [INNER_CORNER_ID]: KIND_INNER_CORNER,
    [BRIDGE_ID]: KIND_BRIDGE,
    [CONDUIT_ID]: KIND_CONDUIT,
    [GENERATOR_ID]: KIND_SOURCE,
    [LAMP_ID]: KIND_CONSUMER,
    [REDSTONE_INPUT_ID]: KIND_ADAPTER_IN,
    [REDSTONE_OUTPUT_ID]: KIND_ADAPTER_OUT
};

// Electrical node lanes (plan section 5.1). A bridge contributes two; every
// other electrical block contributes one.
export const LANE_MAIN = "main";
export const LANE_NS = "ns";
export const LANE_EW = "ew";

// Mounting faces.
export const FACE_UP = "up";
export const FACE_DOWN = "down";
export const FACE_NORTH = "north";
export const FACE_SOUTH = "south";
export const FACE_EAST = "east";
export const FACE_WEST = "west";
export const FACE_LIST = [FACE_UP, FACE_DOWN, FACE_NORTH, FACE_SOUTH, FACE_EAST, FACE_WEST];

// Local cable arms and their connection bits (plan section 5.2).
export const ARM_NAMES = ["local_n", "local_e", "local_s", "local_w"];
export const ARM_BITS = {
    local_n: 1,
    local_e: 2,
    local_s: 4,
    local_w: 8
};

// Descriptor port names (plan section 5.4).
export const LOCAL_PORT_NAMES = ["local_n", "local_e", "local_s", "local_w"];
export const BACK_PORT = "back";
export const WORLD_UP = "world_up";
export const WORLD_DOWN = "world_down";
export const WORLD_NORTH = "world_north";
export const WORLD_SOUTH = "world_south";
export const WORLD_EAST = "world_east";
export const WORLD_WEST = "world_west";
export const WORLD_PORT_NAMES = [WORLD_UP, WORLD_DOWN, WORLD_NORTH, WORLD_SOUTH, WORLD_EAST, WORLD_WEST];

// Block-state names (plan section 5.2/5.3).
export const STATE_BLOCK_FACE = "minecraft:block_face";
export const STATE_CONNECTIONS = "starstone:connections";
export const STATE_POWERED = "starstone:powered";
export const STATE_STAR_POWERED = "starstone:star_powered";
export const STATE_POWERED_NS = "starstone:powered_ns";
export const STATE_POWERED_EW = "starstone:powered_ew";
export const STATE_AXIS = "starstone:axis";
export const STATE_ENABLED = "starstone:enabled";

// Conduit axis values. A surface element only gains a back contact when its
// support is a conduit whose axis points along the element's support normal.
export const AXIS_X = "x";
export const AXIS_Y = "y";
export const AXIS_Z = "z";
export const AXIS_FOR_FACE = {
    [FACE_UP]: AXIS_Y,
    [FACE_DOWN]: AXIS_Y,
    [FACE_NORTH]: AXIS_Z,
    [FACE_SOUTH]: AXIS_Z,
    [FACE_EAST]: AXIS_X,
    [FACE_WEST]: AXIS_X
};
