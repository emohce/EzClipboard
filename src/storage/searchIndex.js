import { getClipboardDisplayType } from '../utils/imagePresentation.mjs'

const safeString = (value) => (value == null ? '' : String(value))

const parseFileList = (raw) => {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

const basename = (filePath = '') => {
  const parts = safeString(filePath).split(/[/\\]/)
  return parts[parts.length - 1] || ''
}

export const normalizeQueryCursor = (cursor) => {
  const n = Number(cursor)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

export const normalizeAliasMapEntry = (entry) => {
  if (typeof entry === 'string') {
    return { value: entry.trim(), cleared: false, exists: true }
  }
  if (entry && typeof entry === 'object') {
    const value = typeof entry.value === 'string' ? entry.value.trim() : ''
    return { value, cleared: entry.cleared === true, exists: true }
  }
  return { value: '', cleared: false, exists: false }
}

export const getAliasForItem = (item, aliasMap = {}) => {
  if (!item) return ''
  const fromMap = normalizeAliasMapEntry(aliasMap?.[item.id])
  if (fromMap.value) return fromMap.value
  if (fromMap.cleared) return ''
  if (typeof item.alias === 'string' && item.alias.trim()) return item.alias.trim()
  if (typeof item.remark === 'string' && item.remark.trim()) return item.remark.trim()
  if (Array.isArray(item.tags) && typeof item.tags[0] === 'string' && item.tags[0].trim()) {
    return item.tags[0].trim()
  }
  return ''
}

export const buildSearchIndex = (item, aliasMap = {}) => {
  if (!item) return ''
  const bits = [
    getAliasForItem(item, aliasMap),
    item.remark,
    ...(Array.isArray(item.tags) ? item.tags : [])
  ]

  if (item.type === 'text') {
    bits.push(item.data)
  } else if (item.type === 'file') {
    const files = parseFileList(item.data)
    files.forEach((file) => {
      bits.push(file?.name, file?.path, basename(file?.path))
    })
    if (Array.isArray(item.originPaths)) {
      item.originPaths.forEach((p) => bits.push(p, basename(p)))
    }
    if (Array.isArray(item.sourcePaths)) {
      item.sourcePaths.forEach((p) => bits.push(p, basename(p)))
    }
  }

  return bits
    .filter((bit) => bit != null && bit !== '')
    .map((bit) => safeString(bit).toLowerCase())
    .join('\n')
}

export const parseKeywordParts = (keyword) => {
  const value = safeString(keyword).trim().toLowerCase()
  if (!value) return []
  return value.split(/\s+/).filter(Boolean)
}

const matchesKeyword = (item, keywordParts, aliasMap, searchIndexMap) => {
  if (!keywordParts.length) return true
  const haystack = searchIndexMap?.get?.(item.id) || buildSearchIndex(item, aliasMap)
  return keywordParts.every((part) => haystack.includes(part))
}

const matchesTab = (item, tab) => {
  if (!tab || tab === 'all' || tab === 'collect') return true
  return getClipboardDisplayType(item) === tab
}

const matchesLockFilter = (item, lockFilter) => {
  if (lockFilter === 'locked') return item?.locked === true
  return true
}

const matchesCollectTag = (item, collectTag) => {
  if (!collectTag || collectTag === '*全部*') return true
  const tags = Array.isArray(item?.tags) ? item.tags : []
  return tags.includes(collectTag)
}

export const queryClipboardItems = ({
  items = [],
  collectItems = [],
  collectIds = new Set(),
  aliasMap = {},
  tab = 'all',
  keyword = '',
  lockFilter = 'all',
  collectTag = '*全部*',
  cursor = 0,
  limit = 30,
  searchIndexMap = null
} = {}) => {
  const offset = normalizeQueryCursor(cursor)
  const pageSize = Math.max(1, Number(limit) || 30)
  const keywordParts = parseKeywordParts(keyword)
  const source = tab === 'collect' ? collectItems : items
  const filtered = []

  for (const item of Array.isArray(source) ? source : []) {
    if (!item) continue
    if (tab !== 'collect' && collectIds.has(item.id)) continue
    if (!matchesTab(item, tab)) continue
    if (!matchesLockFilter(item, lockFilter)) continue
    if (tab === 'collect' && !matchesCollectTag(item, collectTag)) continue
    if (!matchesKeyword(item, keywordParts, aliasMap, searchIndexMap)) continue
    filtered.push(item)
  }

  const total = filtered.length
  const page = filtered.slice(offset, offset + pageSize)
  const nextCursor = offset + page.length < total ? offset + page.length : null

  return {
    items: page,
    total,
    cursor: offset,
    nextCursor
  }
}
