import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { canWhenClausesOverlap } from './src/global/keybindingConflicts.js'
import { findReservationConflicts } from './src/global/shortcutReservations.js'
import { savePinGroup, getPinGroupState, advancePinGroupCursor } from './src/storage/pinnedItems.js'

// Advancing a different Tab's group must not change the active group or member set.
const storage = new Map()
globalThis.utools = { dbStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }
savePinGroup(['all-a', 'all-b'], { type: 'all' })
savePinGroup(['image-a'], { type: 'image' })
advancePinGroupCursor('all')
assert.equal(getPinGroupState().currentType, 'image')
assert.deepEqual(getPinGroupState().groups.all.itemIds, ['all-a', 'all-b'])
assert.equal(getPinGroupState().groups.all.cursor, 1)
advancePinGroupCursor('all')
assert.equal(getPinGroupState().groups.all.cursor, 0)
assert.equal(getPinGroupState().currentType, 'image')
assert.equal(advancePinGroupCursor('text').itemIds.length, 0)

// Main and overlay bindings cannot be simultaneously active; editable search remains reserved.
for (const layer of ['drawerOpen', 'clearDialogOpen', 'fullDataOpen', 'tagSearchOpen', 'tagEditOpen', 'pinGroupEditOpen']) {
  assert.equal(canWhenClausesOverlap('mainFocus', layer), false)
}
assert.equal(canWhenClausesOverlap('mainFocus', 'mainFocus && inputFocus'), true)
assert.ok(findReservationConflicts('cr', { commandId: 'custom', when: 'mainFocus && inputFocus' }).length)
assert.equal(findReservationConflicts('cr', { commandId: 'custom', when: 'drawerOpen' })
  .some(row => row.commandId === 'list.item.copyPaste'), false)

// Replay production navigation handlers with synthetic list/clock, without changing live focus.
const source = fs.readFileSync('src/cpns/ClipItemList.vue', 'utf8')
const pageStart = source.indexOf('    const handleListPageUpCommand = () => {')
const pageEnd = source.indexOf('    const handleListNavLeftCommand = () => {', pageStart)
const autoStart = source.indexOf('const startAutoScroll = (direction) => {')
const autoEnd = source.indexOf('const runPageNavigation = (direction, options = {}) => {', autoStart)
const jobs = new Map(), steps = [], pages = []
let token = 0, dialog = false
const context = {
  props: { showList: Array.from({ length: 50 }), isSearchPanelExpand: true },
  activeIndex: { value: 20 }, autoScrollDirection: { value: null },
  autoScrollTimer: { value: null }, autoScrollSpeed: { value: 100 },
  autoScrollTick: { value: 0 }, autoScrollAcceleration: { value: 1.2 },
  currentNavigationAction: { value: null }, AUTO_SCROLL_STEP_TICKS: 6, AUTO_SCROLL_INITIAL_DELAY: 260,
  STEP_NAV_UP_REVEAL_OPTIONS: {}, STEP_NAV_CENTER_OPTIONS: {},
  isAliasDialogOpen: () => dialog, isFocusInSearch: () => true,
  runPageNavigation: direction => { pages.push(direction); return true },
  submitNavigationAction: (_action, index) => { context.activeIndex.value = index; steps.push(index) },
  setTimeout: fn => { jobs.set(++token, fn); return token }, clearTimeout: id => jobs.delete(id)
}
const api = vm.runInNewContext(source.slice(pageStart, pageEnd) + source.slice(autoStart, autoEnd) +
  ';({handleListPageUpCommand, handleListPageDownCommand, startAutoScroll, stopAutoScroll})', context)
assert.equal(api.handleListPageUpCommand(), true)
assert.equal(api.handleListPageDownCommand(), true)
dialog = true; assert.equal(api.handleListPageUpCommand(), false); assert.equal(api.handleListPageDownCommand(), false)
dialog = false; context.props.showList = []
assert.equal(api.handleListPageUpCommand(), false); assert.equal(api.handleListPageDownCommand(), false)
context.props.showList = Array.from({ length: 50 })
for (const direction of ['up', 'down']) {
  steps.length = 0; pages.length = 0; context.activeIndex.value = 20
  api.startAutoScroll(direction)
  for (let tick = 0; tick < 6; tick++) {
    const [id, fn] = jobs.entries().next().value; jobs.delete(id); fn()
  }
  assert.equal(steps.length, 6); assert.equal(pages.length, 0)
  const [id, fn] = jobs.entries().next().value; jobs.delete(id); fn()
  assert.deepEqual(pages, [direction])
  api.stopAutoScroll(); assert.equal(jobs.size, 0); assert.equal(context.autoScrollTick.value, 0)
}
console.log('Earlier keyboard, page/hold navigation and pin-cursor preservation checks passed')
