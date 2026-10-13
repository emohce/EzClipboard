import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

// Exercise the actual restore, event and fallback consumers without a real pasteboard or DB.
const source = fs.readFileSync('src/global/initPlugin.js', 'utf8')
const captureSource = source.slice(source.indexOf('  // 防止剪贴板写回循环的标志'),
  source.indexOf('  // 首次启动插件 即开启监听'))
function harness() {
  let now = 0, current = null, reads = 0, writes = 0
  const jobs = [], rows = new Map(), updates = []
  const listener = new EventEmitter()
  const schedule = (fn, delay) => jobs.push({ at: now + delay, fn })
  const context = {
    crypto, window: {}, console: { log() {}, warn() {}, error() {} },
    isAliasPasting: false, pollingStarted: false, isEventListenerRegistered: false,
    hasFallbackToPolling: false, setTimeout: schedule,
    time: { sleep: delay => ({ then: fn => schedule(fn, delay) }) },
    pbpaste: () => { reads++; return current ? { ...current } : undefined },
    clipboard: { writeText: data => { current = { type: 'text', data }; writes++ } },
    nativeImage: { createFromDataURL: data => ({ isEmpty: () => false, data }) },
    isGifDataUrl: data => data.startsWith('data:image/gif;'),
    enrichSourceWindowInfoLater() {}, utools: { showNotification() {} },
    db: { dataBase: { data: [] },
      updateItemViaId: id => { if (!rows.has(id)) return false; updates.push(id); return true },
      addItem: item => rows.set(item.id, { ...item }) }
  }
  context.clipboard.writeImage = image => { current = { type: 'image', data: image.data }; writes++ }
  const api = vm.runInNewContext(captureSource + '\n({registerClipEvent, addCommonListener, handleClipboardChange})', context)
  api.registerClipEvent(listener)
  return { api, listener, context, rows, updates,
    set: item => { current = item }, reads: () => reads, writes: () => writes,
    advance(ms) {
      const end = now + ms
      while (true) {
        jobs.sort((a, b) => a.at - b.at)
        if (!jobs.length || jobs[0].at > end) break
        const job = jobs.shift(); now = job.at; job.fn()
      }
      now = end
    }
  }
}

let checks = 0
for (const next of [
  { type: 'text', data: 'B' },
  { type: 'image', data: 'data:image/png;base64,Qg==' },
  { type: 'image', data: 'data:image/gif;base64,Qg==' },
  { type: 'file', data: '[{"path":"/synthetic/B.txt"}]' }
]) {
  const h = harness()
  h.set({ type: 'text', data: 'A' }); h.listener.emit('change')
  h.advance(300); h.set(next); h.listener.emit('change')
  assert.equal(h.rows.size, 1, '500ms protection must remain active')
  h.advance(199); assert.equal(h.rows.size, 1)
  h.advance(1)
  assert.equal(h.rows.size, 2, 'copy during restore guard must be captured without another native event')
  assert.ok([...h.rows.values()].some(item => item.data === next.data))
  checks++
}
{
  const h = harness()
  h.set({ type: 'text', data: 'A' }); h.listener.emit('change')
  h.advance(300); h.listener.emit('change'); h.listener.emit('change')
  const before = h.reads()
  h.advance(200)
  assert.equal(h.rows.size, 1); assert.equal(h.updates.length, 0)
  assert.equal(h.writes(), 1, 'own restore must never cause a writeback loop')
  assert.equal(h.reads(), before + 1, 'guarded events coalesce into one read')
  h.advance(3000); assert.equal(h.reads(), before + 1, 'idle native path must not poll contents')
  // Recopying the same content after the guard is a real event, not permanently suppressed.
  h.listener.emit('change'); assert.equal(h.updates.length, 1)
  checks++
}
{
  const h = harness()
  h.set({ type: 'text', data: 'A' }); h.listener.emit('change')
  h.advance(300); h.set({ type: 'text', data: 'B' }); h.listener.emit('change')
  h.advance(200) // B starts its own 500ms guard.
  h.advance(100); h.listener.emit('change')
  h.advance(400)
  assert.equal(h.rows.size, 2); assert.equal(h.writes(), 2); assert.equal(h.updates.length, 0)
  checks++
}
{
  const h = harness()
  h.set({ type: 'text', data: 'A' }); h.api.addCommonListener()
  h.set({ type: 'text', data: 'B' }); h.advance(300)
  h.advance(300)
  assert.equal(h.rows.size, 2, 'fallback must not acknowledge a copy rejected during the guard')
  h.advance(900); assert.equal(h.rows.size, 2); assert.equal(h.writes(), 2)
  checks++
}
{
  const h = harness()
  h.context.isAliasPasting = true
  h.set({ type: 'text', data: 'alias-generated' }); h.listener.emit('change')
  h.advance(1000); assert.equal(h.rows.size, 0, 'alias suppression remains in place')
  h.context.isAliasPasting = false
  h.context.window.__ezClipboardLineJoinSuppressRecord = { data: 'joined', expiresAt: Infinity }
  h.set({ type: 'text', data: 'joined' }); h.listener.emit('change')
  assert.equal(h.rows.size, 0, 'line-join suppression remains in place')
  checks++
}
{
  const h = harness()
  h.set({ type: 'text', data: 'A' }); h.listener.emit('change')
  h.set({ type: 'text', data: 'B' })
  h.listener.emit('error', new Error('synthetic-start-failure'))
  h.listener.emit('exit'); h.listener.emit('close')
  assert.equal(h.context.pollingStarted, true)
  h.advance(300); assert.equal(h.rows.size, 1)
  h.advance(300); assert.equal(h.rows.size, 2)
  h.advance(900); assert.equal(h.writes(), 2)
  checks++
}
assert.match(fs.readFileSync('native/clipboard-event-handler-mac.m', 'utf8'), /usleep\(300000\)/)
assert.match(captureSource, /time\.sleep\(300\)/)
assert.match(captureSource, /RESTORE_GUARD_TIMEOUT = 500/)
assert.match(captureSource, /MAX_RESTORE_COUNT = 3/)
console.log(`clipboard capture/restore checks: ${checks}/${checks}`)
