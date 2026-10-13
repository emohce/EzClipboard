import { canWhenClausesOverlap } from './keybindingConflicts.js'
import { isShortcutIdFixedNonConfigurable, normalizeShortcutId } from './shortcutKey.js'

/** @type {Array<{ shortcutId: string, commandId: string, when: string, description: string, scope?: string }>} */
// when 必须与 hotkeyBindings.js 的实际默认绑定同源。主层没有全局输入焦点短路
// （isEditableHotkeyTarget 只在 setting 层生效），因此主层保留项不写 !inputFocus，
// 输入态放行由各 handler 自己守卫；设置页保留项才可以写 !inputFocus。
export const SHORTCUT_RESERVATION_RULES = [
  { shortcutId: 'esc', commandId: 'main.escape', when: 'mainFocus', description: '主界面退出搜索/有锁条件', scope: 'system' },
  { shortcutId: 'esc', commandId: 'dialog.clear.close', when: 'clearDialogOpen', description: '关闭清除对话框', scope: 'system' },
  { shortcutId: 'esc', commandId: 'drawer.close', when: 'drawerOpen', description: '关闭剪贴板抽屉', scope: 'system' },
  { shortcutId: 'esc', commandId: 'preview.full.close', when: 'fullDataOpen', description: '关闭全文预览', scope: 'system' },
  { shortcutId: 'esc', commandId: 'tag.search.close', when: 'tagSearchOpen', description: '关闭标签搜索', scope: 'system' },
  { shortcutId: 'esc', commandId: 'tag.edit.close', when: 'tagEditOpen', description: '关闭标签编辑', scope: 'system' },
  { shortcutId: 'esc', commandId: 'pin.group.edit.close', when: 'pinGroupEditOpen', description: '关闭置顶组合编辑', scope: 'system' },
  { shortcutId: 'cr', commandId: 'list.item.copyPaste', when: 'mainFocus', description: '粘贴选中项（搜索态回车直接粘贴，由 handler 自守卫）', scope: 'system' },
  { shortcutId: 'cr', commandId: 'dialog.clear.confirm', when: 'clearDialogOpen', description: '确认清除对话框', scope: 'system' },
  { shortcutId: 'cr', commandId: 'drawer.select', when: 'drawerOpen', description: '选择抽屉项', scope: 'system' },
  { shortcutId: 'c-c', commandId: 'list.item.copyOnly', when: 'mainFocus', description: '复制选中项', scope: 'system' },
  { shortcutId: 'c-r', commandId: 'main.tab.next', when: 'mainFocus', description: '系统刷新保留（浏览器）', scope: 'system' },
  { shortcutId: 'tab', commandId: 'main.tab.nextExplicit', when: 'mainFocus', description: '主界面下一个主 Tab', scope: 'system' },
  { shortcutId: 's-tab', commandId: 'main.tab.prev', when: 'mainFocus', description: '主界面上一个主 Tab', scope: 'system' },
  { shortcutId: 'c-tab', commandId: 'main.collectSubTab.next', when: 'mainFocus', description: '收藏子 Tab 下一个', scope: 'system' },
  { shortcutId: 'c-s-tab', commandId: 'main.collectSubTab.prev', when: 'mainFocus', description: '收藏子 Tab 上一个', scope: 'system' },
  { shortcutId: 'tab', commandId: 'dialog.clear.focus.next', when: 'clearDialogOpen', description: '清除对话框焦点切换', scope: 'system' },
  { shortcutId: 's-tab', commandId: 'dialog.clear.focus.next', when: 'clearDialogOpen', description: '清除对话框焦点切换', scope: 'system' },
  { shortcutId: 'tab', commandId: 'tag.edit.focus.next', when: 'tagEditOpen', description: '标签编辑焦点切换', scope: 'system' },
  { shortcutId: 'space', commandId: 'list.multi.toggleCurrent', when: 'mainFocus', description: '多选当前项（搜索面板展开时由 handler 放行输入）', scope: 'system' },
  { shortcutId: 'space', commandId: 'pin.group.edit.toggleSelect', when: 'pinGroupEditOpen', description: '置顶组合编辑切换选择', scope: 'system' },
  { shortcutId: 'left', commandId: 'setting.tab.prev', when: 'settingFocus && !inputFocus', description: '设置页上一个 Tab', scope: 'setting-ui' },
  { shortcutId: 'right', commandId: 'setting.tab.next', when: 'settingFocus && !inputFocus', description: '设置页下一个 Tab', scope: 'setting-ui' },
  { shortcutId: 'up', commandId: 'setting.scroll.up', when: 'settingFocus', description: '设置页向上滚动', scope: 'setting-ui' },
  { shortcutId: 'down', commandId: 'setting.scroll.down', when: 'settingFocus', description: '设置页向下滚动', scope: 'setting-ui' },
  { shortcutId: 'c-f', commandId: 'search.focus', when: 'mainFocus', description: '主界面聚焦搜索', scope: 'setting-ui' }
]

const MODIFIER_SHORTCUTS = new Set([
  'c',
  's',
  'a',
  'mod-c',
  'mod-s',
  'mod-a'
])

export function getShortcutReservationRows() {
  return SHORTCUT_RESERVATION_RULES.map((rule) => ({ ...rule }))
}

export function findReservationConflicts(shortcutId, { commandId = '', when = '' } = {}) {
  const normalized = normalizeShortcutId(shortcutId)
  if (!normalized) return []
  const overlappingRules = SHORTCUT_RESERVATION_RULES.filter((rule) => {
    if (normalizeShortcutId(rule.shortcutId) !== normalized) return false
    return canWhenClausesOverlap(when, rule.when)
  })
  if (!overlappingRules.length) return []
  if (overlappingRules.some((rule) => rule.commandId === commandId)) return []
  return overlappingRules.filter((rule) => rule.commandId !== commandId)
}

export function isShortcutAssignable(shortcutId, { commandId = '', when = '' } = {}) {
  const normalized = normalizeShortcutId(shortcutId)
  if (!normalized) {
    return { allowed: false, reason: 'invalid-shortcut' }
  }
  if (MODIFIER_SHORTCUTS.has(normalized)) {
    return { allowed: false, reason: 'modifier-only' }
  }
  if (isShortcutIdFixedNonConfigurable(normalized)) {
    return { allowed: false, reason: 'fixed-key' }
  }
  const conflicts = findReservationConflicts(normalized, { commandId, when })
  if (conflicts.length) {
    return { allowed: false, reason: 'reserved', rules: conflicts }
  }
  return { allowed: true }
}

export function isRecordableShortcutId(shortcutId, context = null) {
  const normalized = normalizeShortcutId(shortcutId)
  if (!normalized) return false
  if (MODIFIER_SHORTCUTS.has(normalized)) return false
  if (isShortcutIdFixedNonConfigurable(normalized)) return false
  if (context && typeof context === 'object') {
    return isShortcutAssignable(normalized, context).allowed
  }
  return true
}

export function isNonConfigurableShortcutId(shortcutId, context = null) {
  if (context && typeof context === 'object') {
    return !isShortcutAssignable(shortcutId, context).allowed
  }
  const normalized = normalizeShortcutId(shortcutId)
  if (!normalized) return false
  return SHORTCUT_RESERVATION_RULES.some((rule) => normalizeShortcutId(rule.shortcutId) === normalized)
}

/** @deprecated use SHORTCUT_RESERVATION_RULES */
export const NON_CONFIGURABLE_SHORTCUT_IDS = [
  'esc',
  'cr',
  'c-c',
  'c-r',
  'tab',
  'space',
  'left',
  'right'
]

/** @deprecated use SHORTCUT_RESERVATION_RULES */
export const SETTING_PAGE_FIXED_SHORTCUTS = SHORTCUT_RESERVATION_RULES.filter((rule) => rule.scope === 'setting-ui').map(
  (rule) => ({
    shortcutId: rule.shortcutId,
    description: rule.description
  })
)
