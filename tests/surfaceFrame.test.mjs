// Surface-frame table tests for Task 1.4.
//
// Run: node tests/surfaceFrame.test.mjs
// Exits nonzero on the first failed assertion.

import {
  FACE_LIST,
  ARM_NAMES,
  supportOffset,
  arms,
  frameForFace,
  worldOffset
} from "../starstone_bp/scripts/surfaceFrame.js";

let failures = 0;
const failuresByCategory = new Map();

function check(name, condition) {
  if (condition) return;
  failures += 1;
  failuresByCategory.set(name, (failuresByCategory.get(name) || 0) + 1);
  console.error(`  FAIL: ${name}`);
}

function eqVec(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function vecList(vectors) {
  return JSON.stringify(vectors.map((v) => `[${v.join(",")}]`));
}

function length3(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Six explicit expected mappings: the four local arms and the support offset for
// every mounting face. This table is the source of truth the RP transformation
// table is checked against (Task 1.5).
const EXPECTED = {
  up: {
    normal: [0, 1, 0],
    support: [0, -1, 0],
    arms: { local_n: [0, 0, -1], local_e: [1, 0, 0], local_s: [0, 0, 1], local_w: [-1, 0, 0] }
  },
  down: {
    normal: [0, -1, 0],
    support: [0, 1, 0],
    arms: { local_n: [0, 0, 1], local_e: [1, 0, 0], local_s: [0, 0, -1], local_w: [-1, 0, 0] }
  },
  north: {
    normal: [0, 0, -1],
    support: [0, 0, 1],
    arms: { local_n: [0, 1, 0], local_e: [-1, 0, 0], local_s: [0, -1, 0], local_w: [1, 0, 0] }
  },
  south: {
    normal: [0, 0, 1],
    support: [0, 0, -1],
    arms: { local_n: [0, 1, 0], local_e: [1, 0, 0], local_s: [0, -1, 0], local_w: [-1, 0, 0] }
  },
  east: {
    normal: [1, 0, 0],
    support: [-1, 0, 0],
    arms: { local_n: [0, 1, 0], local_e: [0, 0, -1], local_s: [0, -1, 0], local_w: [0, 0, 1] }
  },
  west: {
    normal: [-1, 0, 0],
    support: [1, 0, 0],
    arms: { local_n: [0, 1, 0], local_e: [0, 0, 1], local_s: [0, -1, 0], local_w: [0, 0, -1] }
  }
};

console.log("surfaceFrame: six explicit expected mappings");
for (const face of FACE_LIST) {
  const frame = frameForFace(face);
  const expected = EXPECTED[face];

  check(`[${face}] face count`, FACE_LIST.length === 6);
  check(`[${face}] normal`, eqVec(frame.normal, expected.normal));
  check(`[${face}] support offset is inverse of normal`, eqVec(frame.supportOffset, expected.support));
  for (const arm of ARM_NAMES) {
    check(`[${face}] ${arm} matches expected`, eqVec(frame.arms[arm], expected.arms[arm]));
  }
  check(`[${face}] supportOffset matches worldOffset(face,"back")-style inverse`, eqVec(supportOffset(face), expected.support));
  check(`[${face}] worldOffset(face,local_e) resolves`, eqVec(worldOffset(face, "local_e"), expected.arms.local_e));
}

console.log("surfaceFrame: geometric checks for every face");
for (const face of FACE_LIST) {
  const frame = frameForFace(face);
  const { normal, arms: a } = frame;
  const vectors = [a.local_n, a.local_e, a.local_s, a.local_w];

  // unit length
  for (const arm of ARM_NAMES) {
    check(`[${face}] ${arm} unit length`, Math.abs(length3(a[arm]) - 1) < 1e-9);
  }

  // unique
  const unique = new Set(vectors.map((v) => `${v.join(",")}`));
  check(`[${face}] four arms unique`, unique.size === 4);

  // perpendicular to the face normal
  for (const arm of ARM_NAMES) {
    check(`[${face}] ${arm} perpendicular to normal`, Math.abs(dot(a[arm], normal)) < 1e-9);
  }

  // opposites in north/south and east/west pairs
  check(`[${face}] local_n == -local_s`, eqVec(a.local_n, a.local_s.map((v) => -v)));
  check(`[${face}] local_e == -local_w`, eqVec(a.local_e, a.local_w.map((v) => -v)));

  // right-handed frame: local_e x local_n == normal
  const crossE = [
    a.local_e[1] * a.local_n[2] - a.local_e[2] * a.local_n[1],
    a.local_e[2] * a.local_n[0] - a.local_e[0] * a.local_n[2],
    a.local_e[0] * a.local_n[1] - a.local_e[1] * a.local_n[0]
  ];
  check(`[${face}] local_e x local_n == normal`, eqVec(crossE, normal));
}

if (failures > 0) {
  console.error(`\nsurfaceFrame: ${failures} failure(s) across ${failuresByCategory.size} check group(s).`);
  process.exit(1);
}

console.log("surfaceFrame: all checks passed");
