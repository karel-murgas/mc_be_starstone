// Pure callback boundary: importing controllers never accesses the world.
const discoveries = new Set();
let sourceHandler, powerResolver;
export function subscribeNetworkDiscovery(listener) {
    discoveries.add(listener);
    return () => discoveries.delete(listener);
}
export function notifyNetworkDiscovered(network, dimension) {
    for (const listener of discoveries) listener(network, dimension);
}
export function configureNetworkPersistence({ sourceChanged, resolvePower }) {
    sourceHandler = sourceChanged;
    powerResolver = resolvePower;
}
export function sourceChanged(dimension, location, on) {
    return sourceHandler ? sourceHandler(dimension, location, Boolean(on)) : false;
}
export function resolveNetworkPower(network, dimension) {
    return powerResolver?.(network, dimension);
}
