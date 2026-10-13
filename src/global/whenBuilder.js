import { getWhenLiteralSets, parseWhenExpression } from './whenExpression.js'

export const WHEN_CONTEXT_GROUPS = [
  {
    id: 'surface',
    title: '界面层',
    keys: [
      { key: 'mainFocus', label: '主界面' },
      { key: 'settingFocus', label: '设置页' }
    ]
  },
  {
    id: 'state',
    title: '状态',
    keys: [
      { key: 'searchActive', label: '搜索中' },
      { key: 'inputFocus', label: '输入框聚焦' },
      { key: 'searchInputFocus', label: '搜索输入框' }
    ]
  },
  {
    id: 'overlay',
    title: '弹层',
    keys: [
      { key: 'clearDialogOpen', label: '清除对话框' },
      { key: 'drawerOpen', label: '抽屉' },
      { key: 'fullDataOpen', label: '全文预览' },
      { key: 'tagSearchOpen', label: '标签搜索' },
      { key: 'tagEditOpen', label: '标签编辑' },
      { key: 'pinGroupEditOpen', label: '置顶组合编辑' }
    ]
  }
]

export const WHEN_PRESETS = [
  { label: '主界面', when: 'mainFocus' },
  { label: '主界面非输入', when: 'mainFocus && !inputFocus' },
  { label: '设置页非输入', when: 'settingFocus && !inputFocus' },
  { label: '搜索中', when: 'mainFocus && searchActive' },
  { label: '抽屉', when: 'drawerOpen' },
  { label: '始终', when: '' }
]

/**
 * 同一时刻最多只有一个为真：overlay 层激活时 buildHotkeyContextSnapshot 会把 mainFocus
 * 置为 false（overlay 层优先级都高于 main），settingFocus 与 overlay 也不共存。
 * 少写 mainFocus 会让冲突检测把「overlay 键位 × 主界面键位」全部误判为冲突。
 */
export const WHEN_MUTEX_GROUPS = [
  [
    'mainFocus',
    'settingFocus',
    'clearDialogOpen',
    'drawerOpen',
    'fullDataOpen',
    'tagSearchOpen',
    'tagEditOpen',
    'pinGroupEditOpen'
  ]
]

export function getWhenBuilderDisabledKeys(states = {}, operator = '&&') {
  if (operator === '||') return new Set()
  const disabled = new Set()
  const includes = Object.entries(states)
    .filter(([, state]) => state === 'include')
    .map(([key]) => key)
  if (!includes.length) return disabled
  for (const group of WHEN_MUTEX_GROUPS) {
    const selected = includes.filter((key) => group.includes(key))
    if (!selected.length) continue
    const anchor = selected[0]
    for (const key of group) {
      if (key !== anchor && !includes.includes(key)) disabled.add(key)
    }
  }
  return disabled
}

export function createEmptyWhenSelection() {
  return {
    operator: '&&',
    states: {}
  }
}

export function buildWhenExpression(selection = {}) {
  const operator = selection.operator === '||' ? '||' : '&&'
  const states = selection.states && typeof selection.states === 'object' ? selection.states : {}
  const parts = Object.entries(states)
    .filter(([, state]) => state === 'include' || state === 'exclude')
    .map(([key, state]) => (state === 'exclude' ? `!${key}` : key))
  return parts.join(` ${operator} `)
}

export function parseWhenToSelection(expression) {
  const source = String(expression || '').trim()
  const selection = createEmptyWhenSelection()
  if (!source) return { ok: true, mode: 'builder', selection }
  try {
    parseWhenExpression(source)
    const sets = getWhenLiteralSets(source)
    const nonEmptySets = sets.filter((set) => set.positive.size || set.negative.size)
    if (!nonEmptySets.length) return { ok: true, mode: 'text', selection, reason: 'complex' }
    const operator = nonEmptySets.length > 1 ? '||' : '&&'
    const first = nonEmptySets[0]
    const states = {}
    for (const value of first.positive) states[value] = 'include'
    for (const value of first.negative) states[value] = 'exclude'
    for (let index = 1; index < nonEmptySets.length; index += 1) {
      const set = nonEmptySets[index]
      for (const value of set.positive) {
        if (states[value] && states[value] !== 'include') return { ok: true, mode: 'text', selection, reason: 'complex' }
        states[value] = 'include'
      }
      for (const value of set.negative) {
        if (states[value] && states[value] !== 'exclude') return { ok: true, mode: 'text', selection, reason: 'complex' }
        states[value] = 'exclude'
      }
    }
    return { ok: true, mode: 'builder', selection: { operator, states } }
  } catch (err) {
    return { ok: false, mode: 'text', selection, reason: err?.message || String(err) }
  }
}

export function getWhenBuilderSummary(expression) {
  const parsed = parseWhenToSelection(expression)
  if (!parsed.ok) return '表达式无效'
  if (parsed.mode !== 'builder') return expression ? '复杂表达式' : '始终'
  const labels = new Map(
    WHEN_CONTEXT_GROUPS.flatMap((group) => group.keys.map((item) => [item.key, item.label]))
  )
  const parts = Object.entries(parsed.selection.states || {}).map(([key, state]) => {
    const label = labels.get(key) || key
    return state === 'exclude' ? `非${label}` : label
  })
  return parts.length ? parts.join(parsed.selection.operator === '||' ? ' 或 ' : ' 且 ') : '始终'
}
