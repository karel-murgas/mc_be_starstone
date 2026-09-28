import assert from "node:assert";
import { SUPPORT_SHAPE, supportMountAllowed } from "../starstone_bp/scripts/supportPolicy.js";

const faces = ["up", "down", "north", "south", "east", "west"];
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`ok - ${name}`);
    } catch (err) {
        failed++;
        console.error(`not ok - ${name}`);
        console.error("  " + err.message);
    }
}

test("full and double slab support every face", () => {
    for (const face of faces) {
        assert.equal(supportMountAllowed(SUPPORT_SHAPE.FULL, face), true, `FULL on ${face}`);
        assert.equal(supportMountAllowed(SUPPORT_SHAPE.DOUBLE_SLAB, face), true, `DOUBLE_SLAB on ${face}`);
    }
});

test("top slab only mounts above it", () => {
    assert.equal(supportMountAllowed(SUPPORT_SHAPE.SINGLE_SLAB_TOP, "up"), true);
    for (const face of faces) {
        if (face !== "up") {
            assert.equal(supportMountAllowed(SUPPORT_SHAPE.SINGLE_SLAB_TOP, face), false, `slab_top on ${face}`);
        }
    }
});

test("bottom slab only mounts beneath it", () => {
    assert.equal(supportMountAllowed(SUPPORT_SHAPE.SINGLE_SLAB_BOTTOM, "down"), true);
    for (const face of faces) {
        if (face !== "down") {
            assert.equal(supportMountAllowed(SUPPORT_SHAPE.SINGLE_SLAB_BOTTOM, face), false, `slab_bottom on ${face}`);
        }
    }
});

test("normal stair supports only its flat (down) face", () => {
    assert.equal(supportMountAllowed(SUPPORT_SHAPE.STAIR_NORMAL, "down"), true);
    for (const face of faces) {
        if (face !== "down") {
            assert.equal(supportMountAllowed(SUPPORT_SHAPE.STAIR_NORMAL, face), false, `stair_normal on ${face}`);
        }
    }
});

test("upside-down stair supports only its flat (up) face", () => {
    assert.equal(supportMountAllowed(SUPPORT_SHAPE.STAIR_UPSIDE_DOWN, "up"), true);
    for (const face of faces) {
        if (face !== "up") {
            assert.equal(supportMountAllowed(SUPPORT_SHAPE.STAIR_UPSIDE_DOWN, face), false, `stair_upside_down on ${face}`);
        }
    }
});

test("partial and none support no face", () => {
    for (const face of faces) {
        assert.equal(supportMountAllowed(SUPPORT_SHAPE.PARTIAL, face), false, `PARTIAL on ${face}`);
        assert.equal(supportMountAllowed(SUPPORT_SHAPE.NONE, face), false, `NONE on ${face}`);
    }
});

test("the enum covers every shape the classifier can return", () => {
    const expected = ["NONE", "FULL", "DOUBLE_SLAB", "SINGLE_SLAB_TOP", "SINGLE_SLAB_BOTTOM", "STAIR_NORMAL", "STAIR_UPSIDE_DOWN", "PARTIAL"];
    assert.deepEqual(Object.keys(SUPPORT_SHAPE).sort(), expected.slice().sort());
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
