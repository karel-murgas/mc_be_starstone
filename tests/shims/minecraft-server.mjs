// Minimal @minecraft/server fake for Node tests that exercise deferred work.
// Tests provide the callback implementations through globalThis.
export const system = {
    afterEvents: { scriptEventReceive: { subscribe() {} } },
    run: (callback) => globalThis.__mcRun(callback),
    runJob: (job) => globalThis.__mcRunJob(job),
    runInterval: (callback, tickInterval) =>
        globalThis.__mcRunInterval(callback, tickInterval)
};

// Subscribers registered by production modules (main.js, cableComponent.js) go
// into a global registry so a test can find them regardless of which module
// instance (@minecraft/server resolved via the loader vs. a direct import)
// owns the object that calls `.subscribe()`.
const dynamicProperties = new Map();
export const world = {
    getDimension(id) {
        const dimension = globalThis.__mcDimensions?.get(id);
        if (!dimension) throw new Error(`Unknown dimension ${id}`);
        return dimension;
    },
    getAllPlayers: () => globalThis.__mcPlayers || [],
    getDynamicProperty: (key) => dynamicProperties.get(key),
    getDynamicPropertyIds: () => [...dynamicProperties.keys()],
    // Test estimate only; production uses the actual engine byte counter.
    getDynamicPropertyTotalByteCount: () => [...dynamicProperties.values()].reduce((sum,value)=>sum+Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value),'utf8'),0),
    setDynamicProperty(key, value) {
        if (value === undefined) dynamicProperties.delete(key);
        else dynamicProperties.set(key, value);
    },
    afterEvents: {
        blockExplode: { subscribe(cb) { (globalThis.__mcWorldSubscribers.blockExplode ??= []).push(cb); } },
        pistonActivate: { subscribe(cb) { (globalThis.__mcWorldSubscribers.pistonActivate ??= []).push(cb); } },
        playerSpawn: {
            subscribe(cb) {
                (globalThis.__mcWorldSubscribers.playerSpawn ??= []).push(cb);
            }
        },
        worldLoad: {
            subscribe(cb) {
                (globalThis.__mcWorldSubscribers.worldLoad ??= []).push(cb);
            }
        },
        playerPlaceBlock: {
            subscribe(cb) {
                (globalThis.__mcWorldSubscribers.playerPlaceBlock ??= []).push(
                    cb
                );
            }
        },
        playerBreakBlock: {
            subscribe(cb) {
                (globalThis.__mcWorldSubscribers.playerBreakBlock ??= []).push(
                    cb
                );
            }
        }
    },
    runtime: {}
};
export class LiquidType {}
export class BlockSourceType {}
export class ItemStack {
    constructor(typeId, amount = 1) {
        this.typeId = typeId;
        this.amount = amount;
    }
}
