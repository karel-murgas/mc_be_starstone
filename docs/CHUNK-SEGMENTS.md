# Chunk segments (tasks 7.1–7.3)

`chunkIndex.js` builds and saves chunk-local components; `segmentGraph.js` joins
their metadata. Blocks remain authoritative. These modules do not load chunks,
force simulation, poll blocks, or apply permutations. Integration and the real
unloaded-middle game test are separate tasks.

## Public interface

- `buildChunkSegments(dimensionId, cx, cz, entries)` is pure. Each entry contains
  `{location:{x,y,z}, descriptor}` using the existing electrical descriptor.
  All entries must belong to that chunk. The result is the snapshot below.
- `buildIndexedChunkSegments(dimension, cx, cz, placementIndex)` is a synchronous
  generator suitable for `yield*` inside `system.runJob`. It reads indexed
  positions only, yields after each position, and returns a snapshot. If any
  indexed position is unavailable it returns `undefined`; callers must retain
  existing metadata. Loaded stale/non-electrical positions are excluded. Both
  direct and descriptor support reads check `isChunkLoaded` first. Callers must
  retry if topology changes during the scan; this module does not own event
  subscriptions or revision counters.
- `createChunkIndex(storage, {warn})` accepts world-style dynamic-property
  get/set/list methods. `chunkIndex` is a world-backed singleton with no world
  reads at import. `readChunk(dimensionId,cx,cz)` returns a detached snapshot or
  `undefined`. `writeChunk(snapshot)` validates and durably commits a snapshot.
  `chunks()` lazily yields valid committed snapshots and isolates corrupt ones.
  `updateSource(nodeRef,on)` patches a known source summary without any block
  reads; returns `false` for an unknown source and `true` for durable success,
  including no-op. Storage exceptions propagate from all methods.
- `buildSegmentGraph(chunks)` consumes snapshots only. Returns
  `{networks,nodeToNetwork,segmentToNetwork}`; both Maps point to network objects.
  Each network has stable `id`, `powered`, and Sets `segments`, `nodes`, `sources`,
  `activeSources`, `consumers`, `unresolvedBoundaries`. Power is the OR of saved
  active-source summaries. Invalid input and duplicate chunk snapshots throw.
- `validateChunkSegments(snapshot)` and `parseSegmentNodeRef(ref)` expose the
  validators. `reciprocalSegmentContact(a,b,direction)` shares the mounting and
  conduit compatibility rule between the local builder and metadata graph.

## Snapshot schema

Schema version `1` records `{v,dimensionId,cx,cz,segments}`. A segment contains
`{key,members,sources,activeSources,consumers,boundaries}`. NodeRefs retain the
`#main`, `#ns`, or `#ew` lane; a bridge's lanes never acquire an implicit edge.
The stable key is the lexicographically smallest member NodeRef. It stays the
same for unchanged membership regardless of input order, power, or visible
cable mask. Splits/merges may change keys, so keys are not block-state IDs.

Each boundary has `{ref,direction:[dx,dy,dz],destination:[cx,cz],kind,mountFace}`.
`ref` identifies the exact source lane, not merely a chunk edge. Destination is
the chunk containing the adjacent block. The opposite chunk must expose a port
from exactly that adjacent position pointing back, with compatible mounting
faces and conduit support direction. Mere chunk adjacency never connects.
Unpaired ports stay unresolved, including potential ports facing empty space.

Cable ports represent all potential tangent contacts even when a stored visual
mask lost its border arm. Surface devices also preserve potential back contacts
against unloaded supports; reciprocity permits only a full generator or matching
conduit there. Bridges do not gain a back contact. A corrupt bridge boundary
that assigns east/west contact to its north/south lane is rejected.

Illustrative complete JSON for a short straight route leaving a chunk:

```json
{"v":1,"dimensionId":"minecraft:overworld","cx":0,"cz":0,"segments":[{"key":"minecraft:overworld|14|0|8#main","members":["minecraft:overworld|14|0|8#main","minecraft:overworld|15|0|8#main"],"sources":[],"activeSources":[],"consumers":[],"boundaries":[{"ref":"minecraft:overworld|15|0|8#main","direction":[1,0,0],"destination":[1,0],"kind":"cable","mountFace":"up"}]}]}
```

Two independent routes leaving the same chunk keep separate records:

```json
{"v":1,"dimensionId":"minecraft:overworld","cx":0,"cz":0,"segments":[{"key":"minecraft:overworld|14|0|4#main","members":["minecraft:overworld|14|0|4#main","minecraft:overworld|15|0|4#main"],"sources":[],"activeSources":[],"consumers":[],"boundaries":[{"ref":"minecraft:overworld|15|0|4#main","direction":[1,0,0],"destination":[1,0],"kind":"cable","mountFace":"up"}]},{"key":"minecraft:overworld|14|0|10#main","members":["minecraft:overworld|14|0|10#main","minecraft:overworld|15|0|10#main"],"sources":[],"activeSources":[],"consumers":[],"boundaries":[{"ref":"minecraft:overworld|15|0|10#main","direction":[1,0,0],"destination":[1,0],"kind":"cable","mountFace":"up"}]}]}
```

A T-junction inside the chunk produces one component:

```json
{"v":1,"dimensionId":"minecraft:overworld","cx":0,"cz":0,"segments":[{"key":"minecraft:overworld|7|0|8#main","members":["minecraft:overworld|7|0|8#main","minecraft:overworld|8|0|7#main","minecraft:overworld|8|0|8#main","minecraft:overworld|9|0|8#main"],"sources":[],"activeSources":[],"consumers":[],"boundaries":[]}]}
```

## Recoverable storage

Exported constants: `CHUNK_SCHEMA_VERSION=1`,
`CHUNK_PROPERTY_PREFIX="starstone:segments:"`, `CHUNK_PAGE_BYTES=24000`,
`CHUNK_MAX_PAGES=4096`.

Property base is
`starstone:segments:<encodeURIComponent(dimensionId)>|<cx>|<cz>`.
`<base>:head` stores `{v:1,bank:0|1,pages,length,checksum}`. Properties
`<base>:<bank>:<pageIndex>` hold consecutive raw ASCII slices of JSON. Non-ASCII
characters are escaped before slicing; every page is at most 24,000 UTF-8 bytes,
below the 32,767-byte API string limit. The head is small. The checksum is FNV-1a
over serialized characters and detects accidental corruption; it is not a
security/authenticity mechanism.

A writer fills every page of the inactive bank before replacing the head. The
head write is the sole commit point. A failed page or head write preserves the
previous complete bank. Readers use only the bank/count named by the head, verify
length/checksum and validate the complete schema and shard membership, and never
admit a partial chunk. Read/write API failures propagate rather than being
treated as empty data. Identical snapshots do not write. Corrupt chunks warn once
per index instance and do not hide other chunks. A complete new authoritative
snapshot can repair corrupt segment storage.

Trailing unused pages remain ignored. Alternating two banks bounds retained
pages by each bank's largest historical snapshot and avoids post-commit cleanup
errors being mistaken for a failed commit. A missing/corrupt head is not guessed
from orphan pages. Rebuild that loaded chunk from its placement index to repair
it. A snapshot over 4,096 pages fails explicitly rather than truncating data.

The persisted source summaries are sufficient to recompute logical power
without reading unloaded blocks. They describe the last observed source state;
external edits in unloaded chunks become authoritative when subsequently
observed. Graph evaluation itself has no world reads or writes.

## Live result versus saved metadata

Snapshots are rebuilt a chunk at a time after every edit, so they briefly
describe the previous topology. `isCompleteNetwork(network, dimension)` in
`networkRuntime.js` decides which answer wins: a live network whose walk found
no unresolved boundary, and whose chunks are all still loaded, is exact and its
own sources decide its power. Saved metadata is consulted only when some part
is out of reach, and then it can add a hidden source but never turn off a
network the live walk saw powered. Rediscovery, logical refresh, generator
toggles and redstone inputs all apply this rule (`staleMetadata.test.mjs`).
New source kinds must do the same.

## Verification and remaining gate

`chunkSegments.test.mjs` exercises deterministic membership, bridge isolation,
negative chunks, absent visual border arms, guarded support reads, restart,
dense paged storage, page/head failure recovery, corruption isolation, source
patches, and malformed/cross-chunk rejection. Separate segment-graph acceptance
tests cover A–B–C connectivity from saved metadata and exact reciprocal ports.
These are offline checks. Task 7.6 still requires a real session with middle
chunk B confirmed unloaded while A and C remain observable.
