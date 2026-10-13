import { getClipboardDisplayType } from "../utils/imagePresentation.mjs"
const pushUniqueItem = (result, seen, item) => {
  if (!item?.id || seen.has(item.id)) return
  seen.add(item.id)
  result.push(item)
}

const PIN_GROUP_CACHE_ENTRY_TYPE = 'clipboard-item'
const PASTEABLE_CLIPBOARD_ITEM_TYPES = new Set(['text', 'image', 'file'])

const isExternalizedPayloadItem = (item) =>
  Boolean(item?.id && item.dataPath && (item.data == null || item.data === ''))

const resolveItemById = (id, byId, getItemById) => {
  const known = byId.get(id) || null
  if (isExternalizedPayloadItem(known)) {
    const hydrated = getItemById(id)
    return hydrated?.id && !isExternalizedPayloadItem(hydrated) ? hydrated : null
  }
  if (known) return known
  const fallback = getItemById(id)
  return isExternalizedPayloadItem(fallback) ? null : fallback
}

const isPasteableClipboardItem = (item) =>
  Boolean(
    item?.id &&
    !item.__pinGroup &&
    !isExternalizedPayloadItem(item) &&
    PASTEABLE_CLIPBOARD_ITEM_TYPES.has(item.type)
  )

const getCachePasteItem = (entry = {}) =>
  entry.type === PIN_GROUP_CACHE_ENTRY_TYPE && isPasteableClipboardItem(entry.value)
    ? entry.value
    : null

export function composeQuickPasteTopItems(options = {}) {
  const { baseItems = [], pinnedItems = [] } = options
  const seen = new Set()
  const result = []
  pinnedItems.forEach((item) => pushUniqueItem(result, seen, item))
  baseItems.forEach((item) => pushUniqueItem(result, seen, item))
  return result
}

export function resolveQuickPastePinnedItem(pinnedItems = []) {
  const list = Array.isArray(pinnedItems) ? pinnedItems.filter((item) => item?.id) : []
  return list[0] || null
}

export function resolvePinGroupCursorItem(items = [], cursor = 0) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (!list.length) return { item: null, index: 0 }
  const index = Math.min(Math.max(Number(cursor) || 0, 0), list.length - 1)
  return { item: list[index], index }
}

export function resolvePinGroupCursorEntry(itemIds = [], options = {}) {
  const ids = Array.isArray(itemIds) ? itemIds.filter((id) => id && id !== '__ez_pin_group__') : []
  const knownItems = Array.isArray(options.knownItems) ? options.knownItems : []
  const byId = new Map(knownItems.filter((item) => item?.id).map((item) => [item.id, item]))
  const getItemById = typeof options.getItemById === 'function' ? options.getItemById : () => null
  const entries = ids
    .map((id, sourceIndex) => ({
      item: resolveItemById(id, byId, getItemById),
      sourceIndex
    }))
    .filter((entry) => entry.item?.id && !entry.item.__pinGroup)
  if (!entries.length) return { item: null, index: 0, nextIndex: 0 }

  const cursor = Math.max(0, Number(options.cursor) || 0)
  const entryIndex = entries.findIndex((entry) => entry.sourceIndex >= cursor)
  const selectedEntryIndex = entryIndex === -1 ? 0 : entryIndex
  const selected = entries[selectedEntryIndex]
  const next = entries[(selectedEntryIndex + 1) % entries.length]
  return {
    item: selected.item,
    index: selected.sourceIndex,
    nextIndex: next.sourceIndex
  }
}

export function buildPinGroupRuntimeCache(itemIds = [], options = {}) {
  const ids = Array.isArray(itemIds) ? itemIds.filter((id) => id && id !== '__ez_pin_group__') : []
  const knownItems = Array.isArray(options.knownItems) ? options.knownItems : []
  const byId = new Map(knownItems.filter((item) => item?.id).map((item) => [item.id, item]))
  const getItemById = typeof options.getItemById === 'function' ? options.getItemById : () => null
  const entries = ids
    .map((id, sourceIndex) => {
      const item = resolveItemById(id, byId, getItemById)
      return {
        type: PIN_GROUP_CACHE_ENTRY_TYPE,
        value: isPasteableClipboardItem(item) ? item : null,
        sourceIndex
      }
    })
    .filter((entry) => getCachePasteItem(entry))
  return {
    itemIds: ids,
    entries,
    cursor: Math.max(0, Number(options.cursor) || 0),
    updatedAt: Number(options.updatedAt) || 0
  }
}

export function resolvePinGroupCacheCursorEntry(cache = {}, options = {}) {
  const entries = Array.isArray(cache.entries) ? cache.entries.filter((entry) => getCachePasteItem(entry)) : []
  if (!entries.length) return { item: null, index: 0, nextIndex: 0 }

  const cursor = Math.max(0, Number(options.cursor ?? cache.cursor) || 0)
  const entryIndex = entries.findIndex((entry) => entry.sourceIndex >= cursor)
  const selectedEntryIndex = entryIndex === -1 ? 0 : entryIndex
  const selected = entries[selectedEntryIndex]
  const next = entries[(selectedEntryIndex + 1) % entries.length]
  return {
    item: getCachePasteItem(selected),
    type: selected.type || PIN_GROUP_CACHE_ENTRY_TYPE,
    value: getCachePasteItem(selected),
    index: selected.sourceIndex,
    nextIndex: next.sourceIndex
  }
}

export function resolvePinGroupItemsById(itemIds = [], options = {}) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter(Boolean))]
  const knownItems = Array.isArray(options.knownItems) ? options.knownItems : []
  const byId = new Map(knownItems.filter((item) => item?.id).map((item) => [item.id, item]))
  const getItemById = typeof options.getItemById === 'function' ? options.getItemById : () => null
  return ids
    .filter((id) => id !== '__ez_pin_group__')
    .map((id) => resolveItemById(id, byId, getItemById))
    .filter((item) => item?.id && !item.__pinGroup)
}

export function matchSearchableItemType(item, keyword = '', tab = 'all', matchBodyKeyword) {
  if (!item) return false
  if (tab === 'text') return item.type === 'text'
  if (tab === 'image') return getClipboardDisplayType(item) === 'image'
  if (tab === 'file') return getClipboardDisplayType(item) === 'file'
  if (tab === 'collect') return true
  if (keyword && item.type === 'image') return matchBodyKeyword(item, keyword)
  return keyword ? item.type !== 'image' : true
}
