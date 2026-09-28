// generatorToggle tests for Task 4.6.
//
// Prove that toggling a generator recomputes only the containing network's
// powered value, applies power only on a change, and never rebuilds topology:
// the network id and count stay fixed across repeated toggles, which a
// discoverAndRegisterNetwork rebuild would have broken by allocating a new id.
//
// Uses the real runtime index, the real anySourceOn, and the real applyPower;
// only the world blocks are faked.
//
// Run: node tests/generatorToggle.test.mjs
// Exits nonzero on the first failed assertion.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
    "./minecraft-server-loader.mjs",
    new URL("./shims/", import.meta.url)
);

// Drive system.run() synchronously so applyPower writes land in this tick.
let runCalls = [];
let invoke = true;
globalThis.__mcRun = (cb) => {
    runCalls.push(cb);
    if (invoke) cb();
};
globalThis.__mcRunJob = () => {};
globalThis.__mcRunInterval = () => {};

const runtime = await import(
    "../starstone_bp/scripts/networkRuntime.js"
);
const { reactToGeneratorToggle, registerGeneratorController } = await import(
    "../starstone_bp/scripts/generatorComponent.js"
);

let failures = 0;
function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}
function eq(a, b, label) {
    check(`${label || a} (${a}) == ${b}`, a === b);
}

const CABLE_ID = "starstone:cable";
const LAMP_ID = "starstone:lamp";
const GENERATOR_ID = "starstone:generator";
const STATE_POWERED = "starstone:powered";
const STATE_ENABLED = "starstone:enabled";

const GEN = "overworld|0|0|0#main";
const CABLE_1 = "overworld|1|0|0#main";
const CABLE_2 = "overworld|2|0|0#main";
const LAMP = "overworld|3|0|0#main";

// A fake block whose permutation tracks its states and records writes.
function makeBlock(id, states) {
    return {
        isValid: true,
        type: { id },
        permutation: {
            getState: (name) => states[name],
            withState: (name, value) => {
                states[name] = value;
                return { __state: name, __value: value };
            }
        },
        setPermutation: (perm) => {
            applied.push({ key: `${xKey},${yKey},${zKey}`, state: perm.__state, value: perm.__value });
        }
    };
}

let applied = [];
let xKey = 0;
let yKey = 0;
let zKey = 0;

// Store keyed by "x,y,z" so getBlock resolves by coordinate.
let store = new Map();

function makeDimension() {
    return {
        id: "overworld",
        isChunkLoaded: () => true,
        getBlock: ({ x, y, z }) => store.get(`${x},${y},${z}`)
    };
}

const dimension = makeDimension();

// A generator+cable+cable+lamp line with the generator as the only source.
function registerLine(generatorOn) {
    const nodes = new Set([GEN, CABLE_1, CABLE_2, LAMP]);
    const sources = new Set([GEN]);
    const consumers = new Set([LAMP]);
    return runtime.default.addNetwork(
        { nodes, sources, consumers, unresolvedBoundaries: new Set() },
        { assignId: true }
    );
}

function setGeneratorOn(on) {
    store.get("0,0,0").permutation.getState = (name) => (name === STATE_ENABLED ? on : undefined);
}
function cablePowered() {
    return store.get("1,0,0").permutation.getState(STATE_POWERED);
}

console.log("toggle applies power exactly once per state change");
{
    applied = [];
    runCalls = [];
    invoke = true;
    store = new Map();
    xKey = 0; yKey = 0; zKey = 0;
    store.set("0,0,0", makeBlock(GENERATOR_ID, { [STATE_ENABLED]: false }));
    xKey = 1; yKey = 0; zKey = 0;
    store.set("1,0,0", makeBlock(CABLE_ID, { [STATE_POWERED]: false }));
    xKey = 2; yKey = 0; zKey = 0;
    store.set("2,0,0", makeBlock(CABLE_ID, { [STATE_POWERED]: false }));
    xKey = 3; yKey = 0; zKey = 0;
    store.set("3,0,0", makeBlock(LAMP_ID, { [STATE_POWERED]: false }));

    const network = registerLine(false);
    eq(runtime.default.networkCount(), 1, "one network is cached");
    const ownerId = runtime.default.networkIdOf(GEN);
    const ownerCountBefore = runtime.default.networkCount();

    // Toggle the generator ON.
    setGeneratorOn(true);
    const onToggle = reactToGeneratorToggle(dimension, 0, 0, 0);
    eq(onToggle.changed, true, "powered changed when the generator turns on");
    eq(onToggle.powered, true, "any source on recomputes powered to true");
    eq(applied.length, 3, "power written to the two cables and the lamp once");
    eq(cablePowered(), true, "cable reflects the new powered state");

    // Toggle the generator OFF.
    applied = [];
    setGeneratorOn(false);
    const offToggle = reactToGeneratorToggle(dimension, 0, 0, 0);
    eq(offToggle.changed, true, "powered changed when the generator turns off");
    eq(offToggle.powered, false, "recompute recomputes powered to false");
    eq(applied.length, 3, "power written back once when it turns off");
    eq(cablePowered(), false, "cable reflects the powered-off state");

    // Toggle again with no state change: writes nothing.
    applied = [];
    const noChange = reactToGeneratorToggle(dimension, 0, 0, 0);
    eq(noChange.changed, false, "an unchanged toggle writes nothing");
    eq(applied.length, 0, "no permutation writes on a no-op toggle");

    // No topology was rebuilt: the network kept its id and count.
    eq(runtime.default.networkIdOf(GEN), ownerId, "the containing network keeps its id after toggles");
    eq(runtime.default.networkCount(), ownerCountBefore, "no new network was allocated — no rebuild");
}

console.log("toggle on an unconnected generator is a no-op");
{
    applied = [];
    runCalls = [];
    invoke = true;
    store = new Map();
    xKey = 9; yKey = 9; zKey = 9;
    store.set("9,9,9", makeBlock(GENERATOR_ID, { [STATE_ENABLED]: true }));
    const result = reactToGeneratorToggle(dimension, 9, 9, 9);
    eq(result, undefined, "a generator with no cached network returns undefined");
    eq(applied.length, 0, "nothing is written for an unconnected generator");
}


console.log("generator registration and interaction use the supported startup component API");
{
    const { system } = await import("./shims/minecraft-server.mjs");
    let startup;
    let component;
    system.beforeEvents = { startup: { subscribe(cb) { startup = cb; } } };
    registerGeneratorController();
    startup({ blockComponentRegistry: { registerCustomComponent(id, definition) {
        eq(id, "starstone:generator", "registered component matches block attachment");
        component = definition;
    } } });
    runtime.default.clearNetworks();
    store = new Map();
    store.set("0,0,0", makeBlock(GENERATOR_ID, { [STATE_ENABLED]: true }));
    registerLine(true);
    reactToGeneratorToggle(dimension, 0, 0, 0);
    const block = store.get("0,0,0");
    block.dimension = dimension;
    block.location = { x: 0, y: 0, z: 0 };
    const owner = runtime.default.networkIdOf(GEN);
    component.onPlayerInteract({ block });
    eq(block.permutation.getState(STATE_ENABLED), false, "interaction disables generator");
    eq(runtime.default.networkOf(owner).powered, false, "interaction powers network off");
    component.onPlayerInteract({ block });
    eq(runtime.default.networkOf(owner).powered, true, "second interaction restores power");
    eq(runtime.default.networkIdOf(GEN), owner, "interaction preserves network topology");
}

if (failures > 0) {
    console.error(`\ngeneratorToggle: ${failures} failure(s).`);
    process.exit(1);
}
console.log("generatorToggle: all checks passed");
