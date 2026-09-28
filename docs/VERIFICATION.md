# Verification coverage

The shared verifier is `.claude/skills/bedrock-lookup/scripts/verify_addon.py`.
It remains generic: no Starstone block IDs or gameplay rules are embedded in it.
The original positional BP/RP invocation still works. Node.js is now required
when the BP has JavaScript: scripts are parsed as modules without executing them.
A missing Node executable is an error rather than a silently skipped check.

Run all relevant Starstone checks from `C:\mcmods`:

```powershell
python -B .claude/skills/bedrock-lookup/scripts/verify_addon.py mods/starstone/starstone_bp mods/starstone/starstone_rp --regression-tests mods/starstone/tests/run.mjs
```

`--regression-tests` runs the explicitly named .py/.js/.mjs project runner and
propagates failure or timeout into the verifier's nonzero exit status. It does
not run arbitrary pack scripts. Only request a test runner you trust.
`--reference-dir` optionally selects another whitelist directory; normal use
continues to use the verifier's existing sibling reference directory.

## Coverage of the audit findings

| Error class | Check that prevents recurrence |
|---|---|
| Malformed JSON / JavaScript | Existing JSON parsing; new `node --input-type=module --check` on every production .js/.mjs file |
| Invented components, misplaced states/traits/boxes, invalid loot/light shapes, dependency cycle, removed API calls | Existing generic verifier checks retained and original regression fixtures still passing |
| Item display_name.translate / missing string value | New generic item parameter check; good and bad fixtures |
| block_placer below documented stable format floor | New generic item-format gate, including malformed/missing versions and exact boundary fixtures |
| Loot count placed directly on entries | New recursive generic entry check; set_count functions remain accepted |
| Missing block custom-component registration | New static literal/constant registration check, including permutation attachments and commented-out registrations; existing wrong-registry check retained |
| Component defined but not wired by main | New Starstone eventWiring suite imports the actual entry point and dispatches startup, placement, interaction, break and script-command handlers |
| query.is_valid() bone visibility | New generic geometry check for both query and q spellings |
| Geometry/bone reference mistakes; unbound named conduit materials | New generic cross-pack geometry/bone/UV-material checks; positive fixtures allow built-in geometry and wildcard materials |
| Missing powered cable visuals; lamp transparency; wrong conduit face textures | Pack contract suite checks all cable masks in both power states, both lamp power materials, and conduit end/casing materials on each axis |
| Cable contacts missing devices/generators; placement skipping mask refresh | Integration suite covers six faces; eventWiring covers cable-last, lamp-last and generator-last placement |
| Only one bridge lane discovered / lane short circuit | Bridge placement, split, descriptor and graph suites |
| Different-plane graph connections / bad neighbor aborting graph | Integration graph cases for different mounting faces and out-of-bounds neighbors; existing graph/port tests |
| Surface support removal not dropping devices or splitting networks | Integration checks cable, bridge and lamp removal; eventWiring dispatches the actual support-break event |
| Conduit axis cannot be selected | Startup registration and beforeOnPlayerPlace dispatch for all six faces |
| Rapid toggles leave stale power writes / unload between plan and write | Deferred scheduler integration tests plus independent bridge-lane and power batching tests |
| Rebuild only counts blocks / guard stuck / unbounded scan / wrong source entity / missing diagnostics registration | Diagnostics and eventWiring suites check restored networks and lamp state, concurrent rejection, cleanup after errors, 2,601-position maximum scan, player filter and command dispatch |
| Broken tests or silently failed child process | Tests are executed, not just syntax-checked; nonzero results and timeouts fail the shared verifier when the project runner is requested |
| Placement hints lost on restart, malformed shards, oversized properties, failed writes | Persistence suite checks fresh instances, negative coordinates, all 4,096 section positions, corruption isolation, and storage failure |
| Recovery ignores bridge lanes, duplicates spawn work, or blocks queued requests | Repair suite exercises powered circuits, isolated lanes, section/dimension deduplication, respawn filtering, queue draining, and failure cleanup |
| Missing persistence hooks or spawn registration | Actual main entry point tests saved placement, support drops, unowned breaks, and powered initial-spawn recovery |
| Unexpected traversal exception published as a partial network | Integration suite injects descriptor failure and checks rejection without runtime registration |
| Invented nested match_tool or min/max enchantment ranges | General Python verifier rejects these shapes; positive fixtures retain range_min/range_max and valid set_count min/max |
| Explosion batching, missed command replacement, unbounded recurring validation | Mutation suite checks deduplication, support removal, stale-cache splits, round-robin progress and the fixed validation budget |
| False cross-chunk edges, corrupt segment pages, partial commit | Segment suites check exact reciprocity, lane/plane/conduit isolation, dense paging, restart, corrupt data and failed commit rollback |
| Stale power through unloaded metadata or race during yielded rebuild | Chunk-controller suite checks A–B–C metadata paths, unavailable-world-read avoidance, source durability, revision rejection and retry after storage/read failures |
| Input feedback, wrong binary transitions or polling every cable | Adapter suite checks all six supports, 0→1/1→15/15→0, unloaded retention, source-state protection and cable-free registry |
| Large synchronous power reads and obsolete queued writes | Power-budget suite checks 32-node deferred planning, 16-write callbacks, backpressure and newer-state supersession |
| Ore yields nothing with an ordinary iron/diamond pickaxe | Ore-loot suite executes the pre-break tool handler for base, Fortune, Silk Touch, invalid tools, Creative, unrelated blocks, and duplicate-prevention; survival suite checks feature/rule links |
| Cable arms reversed, disconnected or tiled from the wrong pixels | Cable visual suite checks all 16 masks, all six mounting rotations, actual neighbor-mask selection, centered hub UV and edge-reaching continuous arms |
| Floating bridge/adapters or bridge lanes sharing a state | Visual geometry suite checks grounded bounds, compact bridge body and its texture binding, all lane-state combinations, adapter housing and transformed support contact |
| Invalid support or missing generator/adjacent adapter contacts | Support connection suite checks all six generator mounting faces, thin-device rejection, tangent graph links and adjacent redstone input polling |
| Unsupported surface appears briefly before dropping | Placement-guard suite checks beforeOnPlayerPlace cancellation on all six faces while keeping after-place recovery for command changes |
| Missing recipe unlocks, wrong yields or unwanted amethyst gate | General verifier checks recipe-book unlocks and survival suite checks crafting/furnace ingredients, outputs, precursor and no-amethyst choices |
| Outside-edge cables fail or leak power across chunk borders | Outer-corner suite checks 24 perpendicular face pairs, reciprocal masks, live discovery, saved boundary contacts and break/rebuild repair |
| Inside corner joins wrong face or survives support loss | Inner-corner suite checks all 12 face pairs, unique-support placement, dual support removal, joined route, masks, live and saved graph, cross-chunk boundaries and wrong-plane rejection |
| Far lamp waits behind a long cable visual wave or remains lit after a loaded middle break | Power-budget and chunk-controller suites check consumer-first updates and a three-chunk split/rejoin |
| Missing pack icon or identical powered/off machine art | Pack-contract suite checks both 256px icons and distinct 32px Generator/Conduit power textures |

The general verifier's negative fixtures are permanent at
`tools/verification/test_verify_addon.py`. Run:

```powershell
python -B tools/verification/test_verify_addon.py
```

Result after installation: 32 new verifier regression assertions passed; earlier
verifier regression checks passed; 15/15 Starstone suites passed; full shared
verification reported 0 errors and 0 warnings.

Milestone 5 adds persistence and recovery suites: 17/17 Starstone suites pass.
The same shared verification command reports 0 errors and 0 warnings.

Later milestone coverage includes the suites above. The generic verifier now
has 37 positive/negative regression assertions. Final suite totals are recorded
in IMPLEMENTATION-STATUS.md. `node mods/starstone/tests/mutation-check.mjs`
deliberately permits a wrong mounting-plane edge in an isolated temporary copy;
the graph acceptance test rejects it. The original fixture used nonreciprocal
local ports and did not catch that mutation; it now uses an explicit reciprocal
world port so the assertion tests the intended rule.

`node mods/starstone/tests/stress.mjs` measures 1k/5k/10k algorithm scenarios.
STRESS.md distinguishes Node generator advances/callbacks from game ticks and
watchdog behavior; TEST-WORLD.md contains the remaining live-game acceptance.

## Limits

Static registration analysis cannot prove computed IDs, aliases, or startup code
execute. When an ID cannot be resolved and dynamic registration is present, the
verifier emits a warning requiring a runtime test rather than declaring a valid
pattern nonexistent. Project runtime tests validate actual registration/wiring.
The source checks are targeted, not complete JavaScript type checking or a full
Bedrock/Molang schema. TypeScript source gets a warning; check compiled JS.

Geometry and asset resolution uses the supplied pack pair. If another dependency
provides an asset, include it in the validation context before treating a missing
reference as an engine defect. Performance optimizations do not establish safe
network sizes: watchdog limits and actual game loading, rendering, collision,
partial-block support behavior, and unloaded-chunk continuity still require
measured in-game tests. Bridge back-contact lane policy remains a design choice,
not an API/schema rule the generic verifier can infer.
