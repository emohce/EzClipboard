import assert from 'node:assert/strict'
import { execFileSync, execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { prepareUToolsRuntimeAssets } from './scripts/utools-runtime-assets.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ezclip-sequence-'))
let checks = 0
try {
  fs.mkdirSync(path.join(root, 'src/data'), { recursive: true })
  fs.mkdirSync(path.join(root, 'native'))
  fs.copyFileSync('src/data/logo.png', path.join(root, 'src/data/logo.png'))
  fs.copyFileSync('native/clipboard-event-handler-mac.m', path.join(root, 'native/clipboard-event-handler-mac.m'))
  prepareUToolsRuntimeAssets(root)
  const source = fs.readFileSync(path.join(root, 'dist/listener.js'), 'utf8')
  function harness(platform, exists = () => true, directory = '/plugin.asar') {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 1
    child.kill = () => true
    const calls = [], modes = [], errors = [], copies = [], removals = []
    const context = { module: { exports: {} }, process: { platform }, __dirname: directory,
      console: { log() {}, error() {} }, require(name) {
        if (name === 'fs') return { existsSync: exists, chmodSync: (...args) => modes.push(args),
          mkdtempSync: () => '/tmp/ezclip-test-native', copyFileSync: (...args) => copies.push(args),
          rmSync: (...args) => removals.push(args) }
        if (name === 'os') return os
        if (name === 'events') return { EventEmitter }
        if (name === 'path') return path
        if (name === 'child_process') return { spawn: (target, args, options) => {
          assert.deepEqual(Array.from(args), [])
          assert.deepEqual(Array.from(options.stdio), ['ignore', 'pipe', 'pipe'])
          calls.push(target); return child
        } }
        throw new Error(name)
      } }
    vm.runInNewContext(source, context)
    const listener = context.module.exports
    listener.on('error', error => errors.push(error))
    return { listener, child, calls, modes, errors, copies, removals }
  }
  const mac = harness('darwin')
  let changes = 0; mac.listener.on('change', () => changes++)
  mac.listener.startListening('/store/_utools_clipboard_manager_storage')
  assert.equal(mac.calls[0], '/tmp/ezclip-test-native/clipboard-event-handler-mac')
  assert.deepEqual(mac.copies, [['/plugin.asar/native/clipboard-event-handler-mac', mac.calls[0]]])
  assert.deepEqual(mac.modes, [[mac.calls[0], 0o755]]); checks++
  mac.child.stdout.emit('data', Buffer.from('CLIPBOARD_CH'))
  assert.equal(changes, 0)
  mac.child.stdout.emit('data', Buffer.from('ANGE\nCLIPBOARD_CHANGE\nCLIPBOARD_'))
  assert.equal(changes, 2)
  mac.child.stdout.emit('data', Buffer.from('CHANGE\n'))
  assert.equal(changes, 3); checks++
  mac.child.stdout.emit('data', Buffer.from('CLIPBOARD_CHANGE'))
  assert.equal(changes, 4); checks++
  mac.child.stdout.emit('data', Buffer.from('\nnoise\n'))
  assert.equal(changes, 4); checks++
  mac.child.emit('exit', 1, null)
  assert.equal(mac.listener.listening, false); checks++
  mac.child.emit('close', 1, null)
  assert.equal(mac.removals.length, 1)
  assert.equal(mac.removals[0][0], '/tmp/ezclip-test-native'); checks++
  const dev = harness('darwin', () => true, '/plugin')
  dev.listener.startListening('/store/_utools_clipboard_manager_storage')
  assert.equal(dev.calls[0], '/plugin/native/clipboard-event-handler-mac')
  assert.deepEqual(dev.copies, []); assert.deepEqual(dev.modes, []); checks++
  // Real temporary-file lifecycle, with an ASAR-shaped fixture rather than a live host.
  for (const scenario of ['success', 'spawn-error', 'copy-error']) {
    const archive = path.join(root, scenario + '.asar')
    fs.mkdirSync(path.join(archive, 'native'), { recursive: true })
    const target = path.join(archive, 'native/clipboard-event-handler-mac')
    fs.writeFileSync(target, scenario === 'spawn-error'
      ? '#!/nonexistent-ezclip-interpreter\n'
      : '#!/bin/sh\nprintf "CLIPBOARD_CHANGE\\n"\n', { mode: 0o600 })
    let extracted; const errors = []; let changes = 0
    const context = { module: { exports: {} }, process: { platform: 'darwin' }, __dirname: archive,
      console: { log() {}, error() {} }, require(name) {
        if (name === 'fs') return { ...fs,
          mkdtempSync: () => (extracted = fs.mkdtempSync(path.join(root, 'unpacked-'))),
          copyFileSync: (from, to) => {
            if (scenario === 'copy-error') throw Object.assign(new Error('synthetic'), { code: 'EACCES' })
            fs.copyFileSync(from, to)
          } }
        if (name === 'os') return os
        if (name === 'events') return { EventEmitter }
        if (name === 'path') return path
        if (name === 'child_process') return { spawn }
        throw new Error(name)
      } }
    vm.runInNewContext(source, context)
    const listener = context.module.exports
    listener.on('error', error => errors.push(error))
    listener.on('change', () => changes++)
    listener.on('exit', () => assert.equal(listener.listening, false))
    listener.startListening('/store/_utools_clipboard_manager_storage')
    if (listener.child) await new Promise(resolve => listener.child.on('close', resolve))
    assert.equal(fs.existsSync(extracted), false, 'extracted executable must be cleaned up')
    assert.equal(listener.listening, false)
    assert.equal(errors.length, scenario === 'success' ? 0 : 1)
    assert.equal(changes, scenario === 'success' ? 1 : 0)
    checks++
  }
  const missing = harness('darwin', () => false)
  missing.listener.startListening('/store/_utools_clipboard_manager_storage')
  assert.equal(missing.errors.length, 1)
  assert.equal(missing.listener.listening, false); checks++
  const legacy = harness('darwin', file => !file.includes('/native/'))
  legacy.listener.startListening('/store/_utools_clipboard_manager_storage')
  assert.equal(legacy.calls[0], '/store/clipboard-event-handler-mac')
  assert.equal(legacy.modes.length, 1); checks++
  for (const [platform, executable] of [['win32','clipboard-event-handler-win32.exe'],['linux','clipboard-event-handler-linux']]) {
    const other = harness(platform);other.listener.startListening('/store/_utools_clipboard_manager_storage')
    assert.equal(other.calls[0], '/store/'+executable);checks++
  }
  // Exercise the generated production launcher with real pipes beyond execFile's 1 MiB cap.
  // The synthetic finite producer never reads or modifies the OS pasteboard.
  {
    const errors = []; let changes = 0, bytes = 0, child
    const args = ['-e', 'process.stdout.write("CLIPBOARD_CHANGE\\n".repeat(80000))']
    const context = { module: { exports: {} }, process: { platform: 'linux' }, __dirname: root,
      console: { log() {}, error() {} }, require(name) {
        if (name === 'fs') return { ...fs, existsSync: () => true, chmodSync() {} }
        if (name === 'os') return os
        if (name === 'events') return { EventEmitter }
        if (name === 'path') return path
        if (name === 'child_process') return {
          execFile: () => (child = execFile(process.execPath, args)),
          spawn: (_target, _args, options) => (child = spawn(process.execPath, args, options))
        }
        throw new Error(name)
      } }
    vm.runInNewContext(source, context)
    const listener = context.module.exports
    listener.on('error', error => errors.push(error))
    listener.on('change', () => changes++)
    listener.startListening('/store/_utools_clipboard_manager_storage')
    child.stdout.on('data', chunk => bytes += chunk.length)
    await new Promise(resolve => child.on('close', resolve))
    assert.ok(bytes > 1024 * 1024)
    assert.deepEqual(errors, [], 'stream volume must not kill the listener')
    assert.equal(changes, 80000, 'all events must reach the consumer')
    checks++
  }
  if (process.platform === 'darwin') {
    const release = path.join(root, 'dist/native/clipboard-event-handler-mac')
    assert.match(execFileSync('/usr/bin/lipo', ['-archs', release], { encoding: 'utf8' }), /x86_64.*arm64|arm64.*x86_64/)
    assert.ok(fs.statSync(release).mode & 0o111); checks++
    const binary = path.join(root, 'sequence-test')
    execFileSync('/usr/bin/clang', ['-O2','-fobjc-arc','-DEZCLIPBOARD_SEQUENCE_TEST',path.join(root,'native/clipboard-event-handler-mac.m'),'-framework','AppKit','-o',binary])
    for (const [counts, expected] of [
      ['7\n7\n7\n', 1], ['7\n8\n8\n9\n', 3], ['8\n0\n0\n1\n', 3], ['0\n0\n', 1]
    ]) {
      const output = execFileSync(binary, [], { input: counts, encoding: 'utf8' })
      assert.equal(output.trim().split('\n').length, expected);checks++
    }
  }
  console.log(`clipboard sequence/listener checks: ${checks}/${checks}`)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
