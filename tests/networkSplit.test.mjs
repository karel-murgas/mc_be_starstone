// Task 4.5 split-after-removal contract, plus verification that main.js keys the
// removal filter on the broken permutation rather than the (already replaced)
// current block. Run with:
// node tests/networkSplit.test.mjs
//
// Uses the existing minecraft-server loader shim and drives real production
// modules (networkController, networkGraph, electricalBlocks, runtime) end to
// end over a fake world. Fake blocks reference the actual fake dimension so
// discovery reads them directly.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
    "./minecraft-server-loader.mjs",
    new URL("./shims/", import.meta.url)
);

// Grab the fake world/system so the test can install subscribe stubs and drain
// the deferred system.run / system.runJob scheduling the production modules use.
const mc = await import("./shims/minecraft-server.mjs");

const runQueue = [];
globalThis.__mcRun = (callback) => {
    runQueue.push(callback);
};
async function drainRuns() {
    while (runQueue.length > 0) {
        await runQueue.shift()();
        await Promise.resolve();
    }
}
globalThis.__mcRunJob = (job) => {
    while (!job.next().done) {
        /* drain the discovery generator to completion */
    }
};
globalThis.__mcRunInterval = () => {
    /* intervals are not exercised here */
};

globalThis.__mcWorldSubscribers = {};
mc.system.beforeEvents = { startup: { subscribe() {} } };
await import("../starstone_bp/scripts/main.js");

// Fire every registered playerBreakBlock subscriber against one event, exactly
// as Minecraft would dispatch it to main.js and cableComponent.
function fireBreak(event) {
    const list = globalThis.__mcWorldSubscribers.playerBreakBlock || [];
    for (const handler of list) {
        handler(event);
    }
}

const {
    CABLE_ID,
    GENERATOR_ID,
    LAMP_ID,
    BRIDGE_ID,
    ARM_BITS,
    STATE_CONNECTIONS,
    STATE_ENABLED,
    STATE_BLOCK_FACE,
    STATE_POWERED
} = await import(
    "../starstone_bp/scripts/constants.js"
);
const runtime = await import(
    "../starstone_bp/scripts/networkRuntime.js"
);
const {
    removeAndSplitNetwork,
    captureRemovedNetworks,
    discoverAndRegisterNetwork
} = await import(
    "../starstone_bp/scripts/networkController.js"
);

let failures = 0;
function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}
function eq(a, b, label) {
    check(label || `${a} == ${b}`, a === b);
}

function makeBlock({ id, location, dimension, connections = 0, mountFace = "up", enabled = true, powered = false }) {
    const perm = {
        getState(name) {
            switch (name) {
                case STATE_CONNECTIONS: return connections;
                case STATE_BLOCK_FACE: return mountFace;
                case STATE_POWERED: return powered;
                case STATE_ENABLED: return enabled;
                default: return undefined;
            }
        },
        withState() { return perm; }
    };
    return {
        isValid: true,
        type: { id },
        location,
        dimension,
        permutation: perm,
        setPermutation() { /* no-op in tests */ }
    };
}

function makeDimension(id, blocks, unloadSet = new Set()) {
    return {
        id,
        getBlock({ x, y, z }) {
            return blocks.get(`${x},${y},${z}`);
        },
        isChunkLoaded({ x, y, z }) {
            return !unloadSet.has(`${x},${y},${z}`);
        }
    };
}

// Build a straight line of blocks along the +x axis, mounted "up". A cell with
// no explicit connections is a full cable (east + west tangent arms set).
function buildLine(dimId, cells, unloadSet = new Set()) {
    const blocks = new Map();
    const dim = makeDimension(dimId, blocks, unloadSet);
    for (const c of cells) {
        const connections = c.connections !== undefined
            ? c.connections
            : ARM_BITS.local_e + ARM_BITS.local_w;
        const b = makeBlock({
            id: c.id,
            location: { x: c.x, y: c.y, z: c.z },
            dimension: dim,
            connections,
            enabled: c.enabled !== false
        });
        blocks.set(`${c.x},${c.y},${c.z}`, b);
    }
    return { dim, blocks };
}

function nodeRef(dimId, x, y, z, lane) {
    return `${dimId}|${x}|${y}|${z}#${lane}`;
}

// Simulate the game actually removing the broken block after the event captured
// the network state: drop it from the world's block map so discovery no longer
// traverses through it.
function removeBlock(world, x, y, z) {
    world.blocks.delete(`${x},${y},${z}`);
}

function findNet(registered, ref) {
    return registered.find((n) => n.nodes.has(ref));
}

console.log("networkSplit: breaking the middle of a line splits into two");
{
    runtime.default.clearNetworks();
    const { dim, blocks } = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: CABLE_ID },
        { x: 3, y: 0, z: 0, id: CABLE_ID },
        { x: 4, y: 0, z: 0, id: LAMP_ID }
    ]);
    await discoverAndRegisterNetwork(blocks.get("0,0,0"));
    await drainRuns();

    const before = runtime.default.networkIdOf(nodeRef("overworld", 2, 0, 0, "main"));
    check("the broken block is cached before removal", typeof before === "number");

    const capture = captureRemovedNetworks(dim, 2, 0, 0);
    check("capture records the removed #main ref", capture.removedRefs.has(nodeRef("overworld", 2, 0, 0, "main")));
    removeBlock({ blocks }, 2, 0, 0);
    const registered = await removeAndSplitNetwork(capture);
    await drainRuns();

    check("exactly two networks result", registered.length === 2);
    check("the removed node is no longer cached", runtime.default.networkIdOf(nodeRef("overworld", 2, 0, 0, "main")) === undefined);

    const genNet = findNet(registered, nodeRef("overworld", 0, 0, 0, "main"));
    const lampNet = findNet(registered, nodeRef("overworld", 4, 0, 0, "main"));
    check("source side keeps its generator", genNet !== undefined);
    check("source side is on", genNet && genNet.powered === true);
    check("lamp side is on its own", lampNet !== undefined);
    check("lamp side is off", lampNet && lampNet.powered === false);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: breaking a block in a loop keeps it one network");
{
    runtime.default.clearNetworks();
    // Square loop in the XZ plane: A(0,0,0)-B(1,0,0)-C(1,0,1)-D(0,0,1)-A.
    const { dim, blocks } = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: CABLE_ID, connections: ARM_BITS.local_e + ARM_BITS.local_s },
        { x: 1, y: 0, z: 0, id: CABLE_ID, connections: ARM_BITS.local_w + ARM_BITS.local_s },
        { x: 1, y: 0, z: 1, id: CABLE_ID, connections: ARM_BITS.local_n + ARM_BITS.local_w },
        { x: 0, y: 0, z: 1, id: CABLE_ID, connections: ARM_BITS.local_e + ARM_BITS.local_n }
    ]);
    await discoverAndRegisterNetwork(blocks.get("0,0,0"));
    await drainRuns();

    const beforeCount = runtime.default.networkCount();
    const capture = captureRemovedNetworks(dim, 1, 0, 0);
    const registered = await removeAndSplitNetwork(capture);
    await drainRuns();

    check("one network was cached before the break", beforeCount === 1);
    eq(registered.length, 1, "one network remains after the break");
    check("the loop is still one cached network", runtime.default.networkCount() === 1);
    check("the removed node is gone", runtime.default.networkIdOf(nodeRef("overworld", 1, 0, 0, "main")) === undefined);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: removing a bridge processes both of its lane networks");
{
    runtime.default.clearNetworks();
    const { dim, blocks } = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },      // gen_ew
        { x: 1, y: 0, z: 0, id: BRIDGE_ID },          // bridge (shared)
        { x: 2, y: 0, z: 0, id: LAMP_ID },            // lamp_ew
        { x: 1, y: 0, z: -1, id: GENERATOR_ID },      // gen_ns
        { x: 1, y: 0, z: 1, id: LAMP_ID }             // lamp_ns
    ]);
    await discoverAndRegisterNetwork(blocks.get("0,0,0"));
    await discoverAndRegisterNetwork(blocks.get("1,0,-1"));
    await drainRuns();

    const nsId = runtime.default.networkIdOf(nodeRef("overworld", 1, 0, 0, "ns"));
    const ewId = runtime.default.networkIdOf(nodeRef("overworld", 1, 0, 0, "ew"));
    check("the bridge has two distinct cached networks", nsId !== ewId);

    const capture = captureRemovedNetworks(dim, 1, 0, 0);
    check("capture saw both bridge lanes",
        capture.removedRefs.has(nodeRef("overworld", 1, 0, 0, "ns")) &&
        capture.removedRefs.has(nodeRef("overworld", 1, 0, 0, "ew")));
    // The bridge block is gone from the world by the time the split runs.
    removeBlock({ blocks }, 1, 0, 0);
    const registered = await removeAndSplitNetwork(capture);
    await drainRuns();

    check("no bridge lane remains cached",
        runtime.default.networkIdOf(nodeRef("overworld", 1, 0, 0, "ns")) === undefined &&
        runtime.default.networkIdOf(nodeRef("overworld", 1, 0, 0, "ew")) === undefined);
    check("both lanes were rediscovered (4 single-block networks)", registered.length === 4);
    const genNetEw = findNet(registered, nodeRef("overworld", 0, 0, 0, "main"));
    const genNetNs = findNet(registered, nodeRef("overworld", 1, 0, -1, "main"));
    check("the east-west generator side is on", genNetEw && genNetEw.powered === true);
    check("the north-south generator side is on", genNetNs && genNetNs.powered === true);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: a surviving bridge ew seed stays on ew");
{
    runtime.default.clearNetworks();
    const { dim, blocks } = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: BRIDGE_ID },
        { x: 3, y: 0, z: 0, id: CABLE_ID },
        { x: 4, y: 0, z: 0, id: LAMP_ID }
    ]);
    await discoverAndRegisterNetwork(blocks.get("0,0,0"));
    await drainRuns();

    const capture = captureRemovedNetworks(dim, 1, 0, 0);
    const registered = await removeAndSplitNetwork(capture);
    await drainRuns();

    const ewOwned = runtime.default.networkIdOf(nodeRef("overworld", 2, 0, 0, "ew"));
    check("the bridge ew lane was rediscovered onto its own lane", ewOwned !== undefined);
    const ewNet = findNet(registered, nodeRef("overworld", 2, 0, 0, "ew"));
    check("the ew seed followed the ew line (cable + lamp present)",
        ewNet && ewNet.nodes.has(nodeRef("overworld", 3, 0, 0, "main")) &&
        ewNet.nodes.has(nodeRef("overworld", 4, 0, 0, "main")));
    check("the bridge ns lane was not pulled into any network",
        runtime.default.networkIdOf(nodeRef("overworld", 2, 0, 0, "ns")) === undefined);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: an unrelated cached network is left unchanged");
{
    runtime.default.clearNetworks();
    const unrelated = buildLine("overworld", [
        { x: 100, y: 0, z: 0, id: GENERATOR_ID },
        { x: 101, y: 0, z: 0, id: CABLE_ID },
        { x: 102, y: 0, z: 0, id: LAMP_ID }
    ]);
    const working = buildLine("nether", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: CABLE_ID },
        { x: 3, y: 0, z: 0, id: CABLE_ID },
        { x: 4, y: 0, z: 0, id: LAMP_ID }
    ]);
    await discoverAndRegisterNetwork(unrelated.blocks.get("100,0,0"));
    await discoverAndRegisterNetwork(working.blocks.get("0,0,0"));
    await drainRuns();

    const genRef = nodeRef("overworld", 100, 0, 0, "main");
    const lampRef = nodeRef("overworld", 102, 0, 0, "main");
    const beforeId = runtime.default.networkIdOf(genRef);
    const beforePowered = runtime.default.snapshot().find((n) => n.nodes.has(genRef))?.powered;

    const capture = captureRemovedNetworks(working.dim, 2, 0, 0);
    await removeAndSplitNetwork(capture);
    await drainRuns();

    check("the unrelated generator keeps its id", runtime.default.networkIdOf(genRef) === beforeId);
    check("the unrelated lamp still maps to that id", runtime.default.networkIdOf(lampRef) === beforeId);
    const still = runtime.default.snapshot().find((n) => n.nodes.has(genRef));
    check("the unrelated network keeps its powered flag", still && still.powered === beforePowered);
    check("the unrelated network still exists", typeof runtime.default.networkIdOf(lampRef) === "number");
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: a disabled generator reports off, an enabled one reports on");
{
    runtime.default.clearNetworks();
    const disabled = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID, enabled: false },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: LAMP_ID }
    ]);
    const offNet = await discoverAndRegisterNetwork(disabled.blocks.get("0,0,0"));
    await drainRuns();

    runtime.default.clearNetworks();
    const enabled = buildLine("overworld2", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID, enabled: true },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: LAMP_ID }
    ]);
    const onNet = await discoverAndRegisterNetwork(enabled.blocks.get("0,0,0"));
    await drainRuns();

    check("a disabled generator produces an off network", offNet.powered === false);
    check("an enabled generator produces an on network", onNet.powered === true);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("networkSplit: an unavailable neighbour chunk is guarded, not crashed");
{
    runtime.default.clearNetworks();
    const unload = new Set(["3,0,0"]);
    const { dim, blocks } = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: CABLE_ID },
        { x: 3, y: 0, z: 0, id: CABLE_ID },
        { x: 4, y: 0, z: 0, id: LAMP_ID }
    ], unload);
    await discoverAndRegisterNetwork(blocks.get("0,0,0"));
    await drainRuns();

    let threw = false;
    const capture = captureRemovedNetworks(dim, 2, 0, 0);
    let registered = [];
    try {
        registered = await removeAndSplitNetwork(capture);
    } catch {
        threw = true;
    }
    await drainRuns();
    check("removal did not throw through the unloaded neighbour", !threw);
    const genNet = findNet(registered, nodeRef("overworld", 0, 0, 0, "main"));
    check("the reachable source side is still processed", genNet && genNet.powered === true);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

console.log("main.js: the removal filter keys on the broken permutation");
{
    // Valid removal: a Starstone cable, identified via brokenBlockPermutation.
    runtime.default.clearNetworks();
    const working = buildLine("overworld", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: CABLE_ID },
        { x: 3, y: 0, z: 0, id: CABLE_ID },
        { x: 4, y: 0, z: 0, id: LAMP_ID }
    ]);
    await discoverAndRegisterNetwork(working.blocks.get("0,0,0"));
    await drainRuns();
    const beforeCount = runtime.default.networkCount();

    const breakEvent = {
        block: { type: { id: "minecraft:air" }, location: { x: 2, y: 0, z: 0 }, dimension: working.dim },
        brokenBlockPermutation: { type: { id: CABLE_ID } },
        dimension: working.dim,

    };
    removeBlock(working, 2, 0, 0);
    fireBreak(breakEvent);

    await drainRuns();

    check("a valid removal split into two", runtime.default.networkCount() === 2);
    check("the source side is on via the real handler",
        runtime.default.networkIdOf(nodeRef("overworld", 0, 0, 0, "main")) !== undefined);

    // Invalid removal: a non-Starstone block must be skipped without splitting.
    runtime.default.clearNetworks();
    const other = buildLine("overworld3", [
        { x: 0, y: 0, z: 0, id: GENERATOR_ID },
        { x: 1, y: 0, z: 0, id: CABLE_ID },
        { x: 2, y: 0, z: 0, id: LAMP_ID }
    ]);
    await discoverAndRegisterNetwork(other.blocks.get("0,0,0"));
    await drainRuns();
    const otherCount = runtime.default.networkCount();
    const otherRef = nodeRef("overworld3", 0, 0, 0, "main");

    const invalidEvent = {
        block: undefined,
        brokenBlockPermutation: { type: { id: "minecraft:stone" } },
        dimension: other.dim,
        location: { x: 1, y: 0, z: 0 }
    };
    fireBreak(invalidEvent);
    await drainRuns();

    check("a non-Starstone removal queues no split work", runtime.default.networkCount() === otherCount);
    check("the unrelated network is untouched", runtime.default.networkIdOf(otherRef) !== undefined);
    check("runtime invariant holds", runtime.default.invariantHolds());
}

if (failures > 0) {
    console.error(`\nnetworkSplit: ${failures} failure(s).`);
    process.exit(1);
}
console.log("networkSplit: all checks passed");
