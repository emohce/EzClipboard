export const PINNED_ITEM_MAP_KEY = "pin.item.map";
export const PIN_LAST_ACTIVE_CONTEXT_KEY = "pin.lastActiveContext";
export const PIN_GROUP_KEY = "pin.group";
export const PIN_GROUP_STATE_VERSION = 2;
export const PIN_GROUP_TYPES = ["collect", "all", "text", "image", "file"];
export const DEFAULT_PIN_GROUP_TYPE = "all";
export const PIN_GROUP_OPERATION = "pin-group";

const readStorageObject = (key) => {
    try {
        const value = utools?.dbStorage?.getItem?.(key);
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
    } catch (_) {
        return {};
    }
};

const writeStorageObject = (key, value) => {
    try {
        utools?.dbStorage?.setItem?.(key, value);
    } catch (_) {
        // dbStorage is unavailable in browser-only development.
    }
};

export const getPinnedMap = () => readStorageObject(PINNED_ITEM_MAP_KEY);

export const isPinnedItem = (itemId) => {
    if (!itemId) return false;
    return Boolean(getPinnedMap()[itemId]);
};

export const togglePinnedItem = (item) => {
    if (!item?.id) return { pinned: false, map: getPinnedMap() };
    const map = { ...getPinnedMap() };
    if (map[item.id]) {
        delete map[item.id];
        writeStorageObject(PINNED_ITEM_MAP_KEY, map);
        return { pinned: false, map };
    }
    map[item.id] = { pinnedAt: Date.now() };
    writeStorageObject(PINNED_ITEM_MAP_KEY, map);
    return { pinned: true, map };
};

export const removePinnedItems = (ids = []) => {
    const idSet = new Set(ids.filter(Boolean));
    if (!idSet.size) return getPinnedMap();
    const map = { ...getPinnedMap() };
    let changed = false;
    idSet.forEach((id) => {
        if (map[id]) {
            delete map[id];
            changed = true;
        }
    });
    if (changed) writeStorageObject(PINNED_ITEM_MAP_KEY, map);
    return map;
};

export const sortPinnedItems = (items = [], map = getPinnedMap()) =>
    [...items].sort((a, b) => {
        const aTime = Number(map[a?.id]?.pinnedAt) || 0;
        const bTime = Number(map[b?.id]?.pinnedAt) || 0;
        return bTime - aTime;
    });

export const getLastActiveContext = () => {
    const context = readStorageObject(PIN_LAST_ACTIVE_CONTEXT_KEY);
    return {
        tab: context.tab || "all",
        collectTag: context.collectTag || "*全部*",
        keyword: typeof context.keyword === "string" ? context.keyword : "",
        lockFilter: context.lockFilter || "all",
    };
};

export const setLastActiveContext = (context = {}) => {
    writeStorageObject(PIN_LAST_ACTIVE_CONTEXT_KEY, {
        tab: context.tab || "all",
        collectTag: context.collectTag || "*全部*",
        keyword: typeof context.keyword === "string" ? context.keyword : "",
        lockFilter: context.lockFilter || "all",
        updatedAt: Date.now(),
    });
};

export const normalizePinGroupType = (type) =>
    PIN_GROUP_TYPES.includes(type) ? type : DEFAULT_PIN_GROUP_TYPE;

const uniqueItemIds = (itemIds = []) => [
    ...new Set(
        (Array.isArray(itemIds) ? itemIds : [])
            .filter((id) => id && id !== "__ez_pin_group__"),
    ),
];

const normalizePinGroup = (group = {}, type = DEFAULT_PIN_GROUP_TYPE) => {
    const itemIds = uniqueItemIds(group.itemIds);
    return {
        type: normalizePinGroupType(group.type || type),
        operation: group.operation || PIN_GROUP_OPERATION,
        itemIds,
        cursor: Math.min(
            Math.max(0, Number(group.cursor) || 0),
            Math.max(0, itemIds.length - 1),
        ),
        updatedAt: Number(group.updatedAt) || 0,
    };
};

const createEmptyPinGroup = (type = DEFAULT_PIN_GROUP_TYPE, updatedAt = 0) => ({
    type: normalizePinGroupType(type),
    operation: PIN_GROUP_OPERATION,
    itemIds: [],
    cursor: 0,
    updatedAt: Number(updatedAt) || 0,
});

const createEmptyPinGroupState = (currentType = DEFAULT_PIN_GROUP_TYPE) => {
    const groups = {};
    PIN_GROUP_TYPES.forEach((type) => {
        groups[type] = createEmptyPinGroup(type);
    });
    return {
        version: PIN_GROUP_STATE_VERSION,
        currentType: normalizePinGroupType(currentType),
        groups,
        updatedAt: 0,
    };
};

const normalizePinGroupState = (raw = {}) => {
    if (Array.isArray(raw.itemIds)) {
        const state = createEmptyPinGroupState(DEFAULT_PIN_GROUP_TYPE);
        const group = normalizePinGroup(raw, DEFAULT_PIN_GROUP_TYPE);
        state.groups[DEFAULT_PIN_GROUP_TYPE] = group;
        state.currentType = DEFAULT_PIN_GROUP_TYPE;
        state.updatedAt = group.updatedAt;
        return state;
    }

    const state = createEmptyPinGroupState(raw.currentType || raw.type);
    const rawGroups =
        raw.groups && typeof raw.groups === "object" && !Array.isArray(raw.groups)
            ? raw.groups
            : {};
    PIN_GROUP_TYPES.forEach((type) => {
        state.groups[type] = normalizePinGroup(rawGroups[type], type);
    });
    state.updatedAt = Number(raw.updatedAt) || Math.max(
        0,
        ...Object.values(state.groups).map((group) => Number(group.updatedAt) || 0),
    );
    return state;
};

const writePinGroupState = (state) => {
    const normalized = normalizePinGroupState(state);
    writeStorageObject(PIN_GROUP_KEY, normalized);
    return normalized;
};

export const getPinGroupState = () =>
    normalizePinGroupState(readStorageObject(PIN_GROUP_KEY));

export const getPinGroup = (type) => {
    const state = getPinGroupState();
    const targetType = normalizePinGroupType(type || state.currentType);
    return state.groups[targetType] || createEmptyPinGroup(targetType);
};

export const savePinGroup = (itemIds = [], options = {}) => {
    const state = getPinGroupState();
    const type = normalizePinGroupType(options.type || state.currentType);
    const ids = uniqueItemIds(itemIds);
    const prev = state.groups[type] || createEmptyPinGroup(type);
    const group = {
        type,
        operation: PIN_GROUP_OPERATION,
        itemIds: ids,
        cursor: Math.min(
            Math.max(0, Number(options.cursor ?? prev.cursor) || 0),
            Math.max(0, ids.length - 1),
        ),
        updatedAt: Date.now(),
    };
    state.groups[type] = group;
    state.currentType = type;
    state.updatedAt = group.updatedAt;
    writePinGroupState(state);
    if (options.activeContext && typeof options.activeContext === "object") {
        setLastActiveContext({
            ...options.activeContext,
            tab: type,
        });
    }
    return group;
};

export const clearPinGroup = (typeOrOptions) => {
    const state = getPinGroupState();
    const type = normalizePinGroupType(
        typeof typeOrOptions === "string"
            ? typeOrOptions
            : typeOrOptions?.type || state.currentType,
    );
    const group = createEmptyPinGroup(type, Date.now());
    state.groups[type] = group;
    state.currentType = type;
    state.updatedAt = group.updatedAt;
    writePinGroupState(state);
    return group;
};

export const removePinGroupItems = (ids = [], options = {}) => {
    const idSet = new Set(ids.filter(Boolean));
    const state = getPinGroupState();
    const returnType = normalizePinGroupType(options.type || state.currentType);
    if (!idSet.size) return state.groups[returnType] || createEmptyPinGroup(returnType);

    let changed = false;
    PIN_GROUP_TYPES.forEach((type) => {
        const group = state.groups[type] || createEmptyPinGroup(type);
        if (!group.itemIds.length) return;
        const itemIds = group.itemIds.filter((id) => !idSet.has(id));
        if (itemIds.length === group.itemIds.length) return;
        changed = true;
        state.groups[type] = {
            ...group,
            itemIds,
            cursor: Math.min(group.cursor, Math.max(0, itemIds.length - 1)),
            updatedAt: Date.now(),
        };
    });
    if (changed) {
        state.updatedAt = Math.max(
            ...Object.values(state.groups).map((group) => Number(group.updatedAt) || 0),
        );
        writePinGroupState(state);
    }
    return getPinGroup(returnType);
};

/**
 * 只推进 cursor 的轻量写回：不改写 itemIds，也不改写 state.currentType。
 * 循环粘贴等运行时行为必须走这里；用 savePinGroup 推进 cursor 会把调用方持有的
 * （可能已过期的）itemIds 覆盖回存储，并顺带改写当前 Type。
 */
export const setPinGroupCursor = (type, cursor) => {
    const state = getPinGroupState();
    const groupType = normalizePinGroupType(type || state.currentType);
    const prev = state.groups[groupType] || createEmptyPinGroup(groupType);
    if (!prev.itemIds.length) return prev;
    const nextCursor = Math.min(
        Math.max(0, Number(cursor) || 0),
        Math.max(0, prev.itemIds.length - 1),
    );
    if (nextCursor === prev.cursor) return prev;
    const group = { ...prev, cursor: nextCursor, updatedAt: Date.now() };
    state.groups[groupType] = group;
    state.updatedAt = group.updatedAt;
    writePinGroupState(state);
    return group;
};

export const advancePinGroupCursor = (type) => {
    const group = getPinGroup(type);
    if (!group.itemIds.length) return group;
    const nextCursor = (group.cursor + 1) % group.itemIds.length;
    return setPinGroupCursor(group.type, nextCursor);
};
