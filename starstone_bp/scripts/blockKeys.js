// Canonical coordinate strings shared by controllers and persistent metadata.
export function blockKey(dimension, location) {
    const id = typeof dimension === "string" ? dimension : dimension.id;
    const { x, y, z } = location;
    if (typeof id !== "string" || /[|#]/.test(id) || ![x,y,z].every(Number.isSafeInteger)) {
        throw new Error("Invalid block key");
    }
    return `${id}|${x}|${y}|${z}`;
}

export function nodeRef(dimension, location, lane = "main") {
    if (!["main", "ns", "ew"].includes(lane)) throw new Error("Invalid lane");
    return `${blockKey(dimension, location)}#${lane}`;
}

export function parseBlockKey(key) {
    if (typeof key !== "string") return undefined;
    const parts = key.split("|");
    if (parts.length !== 4 || !parts[0] || /[#]/.test(parts[0]) ||
        !parts.slice(1).every(value => /^(0|-?[1-9]\d*)$/.test(value))) return undefined;
    const [x, y, z] = parts.slice(1).map(Number);
    if (![x,y,z].every(Number.isSafeInteger)) return undefined;
    return { dimensionId: parts[0], x, y, z };
}

export function parseNodeRef(ref) {
    if (typeof ref !== "string") return undefined;
    const parts = ref.split("#");
    if (parts.length !== 2 || !["main", "ns", "ew"].includes(parts[1])) return undefined;
    const location = parseBlockKey(parts[0]);
    return location ? { ...location, lane: parts[1] } : undefined;
}
