# Offline algorithm stress measurements

Run from `C:\mcmods`:

```powershell
node mods/starstone/tests/stress.mjs
```

The harness builds one generator followed by 1,000, 5,000, or 10,000 cables,
discovers the connected network, builds and persists chunk segments, reconstructs
the logical graph from those saved segments, then powers all cables. It asserts
the expected membership, power, and actual write count. The fixture uses loaded
blocks in Node.js; these are **not game ticks, simulation-distance tests, frame
times, or watchdog measurements**.

The loader is registered by `runtimeFixture.mjs` before dynamically importing the
Minecraft-dependent production modules. No alternate production algorithms are
implemented in the harness.

## Measured change

Before bounded planning, applying power read 1,001 / 5,001 / 10,001 world blocks
in the calling stack, although permutation writes already drained 16 at a time.
The concrete write queue peaked at 1,000 / 5,000 / 10,000 entries respectively.

Power propagation now defers plans for networks above `PLAN_BATCH=32`. One
planning callback reads at most 32 nodes, and concrete writes retain
`WRITE_BATCH=16`. Backpressure limits a large request's concrete write backlog to
32 entries. Pending plans retain only references, desired booleans, dimension
handles, and progress records. New targets supersede old unread plans and queued
writes per node/state; bridge lane state keys remain independent. Small networks
still return exact immediate planned-write counts, preserving the existing API.

Large `applyPower` calls return live `{written,unresolved,pending}` counters.
`written` counts actual scheduled state changes, not candidate members. `pending`
becomes zero after planning or supersession; writes may still be draining.
`powerStats()` preserves `queued`, `peakQueued`, `appliedWrites`, `writeBudget`
and adds `planning`, `peakPlanning`, `planningBudget`.

Latest run on 2026-09-28, Node 22.14.0:

| Cable count | Discovery generator advances | Segment generator advances | Power callbacks | Synchronous power reads | Max reads/callback | Peak write backlog | Peak pending plans |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 42 | 1,064 | 125 | 0 | 32 | 32 | 1,001 |
| 5,000 | 209 | 5,314 | 625 | 0 | 32 | 32 | 5,001 |
| 10,000 | 417 | 10,627 | 1,249 | 0 | 32 | 32 | 10,001 |

| Cable count | Discovery ms | Segment/storage/graph ms | Power ms | Process heap delta bytes | Dynamic-property bytes | Largest property bytes |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 25 | 128 | 8 | 10,080,048 | 345,427 | 5,422 |
| 5,000 | 74 | 415 | 32 | 19,686,856 | 1,750,280 | 5,512 |
| 10,000 | 75 | 1,066 | 41 | 32,147,808 | 3,542,234 | 5,566 |

Generator advances include completion calls. Callback counts include both
planning and writing. Timings are illustrative, affected by JIT and concurrent
host activity, and are not acceptance thresholds. Heap delta is process heap
after the scenario minus before fixture creation; it includes fixture/index
allocations and garbage collection, is not peak memory, and is not isolated
Minecraft addon memory. Each pending-plan count includes the generator, which
is inspected but does not receive a powered-state write.

Dynamic-property sizes are UTF-8 byte totals for current placement and segment
properties; the largest remains below 32,767 bytes. This straight-line fixture
has sparse chunks. The separate dense `chunkSegments.test.mjs` exercises paging
of 4,096 positions in one chunk.

## Regression coverage and limits

`powerBudget.test.mjs` verifies deferred large-network reads, per-callback read
and write budgets, backpressure, unchanged-network no-op behavior, superseding
toggles and small splits, unloaded-block avoidance, and bridge lane isolation.
The existing `powerPropagation.test.mjs` still verifies the pure planner and
exact small-network return counts; `integrationRegression.test.mjs` retains
rapid-toggle and unloading checks.

Enqueuing pending references remains O(network members) synchronous work without
world reads. Multiple separate small calls can collectively schedule more than
32 writes; the 32-entry backlog measurement applies to deferred large requests,
while write callbacks still cap actual writes at 16. Chunk JSON serialization,
metadata graph computation, and the pure local component builder remain
synchronous CPU work and require real dense-chunk/game profiling. No claim of
in-game compatibility, rendering performance, unloaded-middle continuity, or
watchdog safety follows from these Node measurements.
