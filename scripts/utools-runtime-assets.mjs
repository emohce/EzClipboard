import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildMacClipboardListener } from './build-mac-clipboard-listener.mjs'

const pluginManifest = {
  pluginName: '超级剪贴板',
  description: '强大的剪贴板管理工具',
  author: 'ZiuChen',
  homepage: 'https://github.com/ZiuChen',
  main: 'index.html',
  preload: 'preload.js',
  development: {
    main: 'http://localhost:8081/'
  },
  logo: 'logo.png',
  platform: ['win32', 'darwin', 'linux'],
  features: [
    {
      code: 'clipboard',
      explain: '剪切板历史、剪贴板快速粘贴',
      cmds: ['剪切板', '剪贴板', 'Clipboard']
    },
    {
      code: 'quick-paste-top',
      explain: '粘贴置顶项',
      mainHide: true,
      cmds: ['粘贴置顶项']
    },
    {
      code: 'quick-paste-pin-group',
      explain: '循环粘贴组合项',
      mainHide: true,
      cmds: ['循环粘贴组合项']
    }
  ]
}

const runtimeTextAssets = {
  'plugin.json': `${JSON.stringify(pluginManifest, null, 2)}\n`,
  'preload.js': `const path = require('path')
const os = require('os')
const {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  watch,
  copyFileSync,
  statSync,
  rmSync,
  unlinkSync,
  rmdirSync
} = require('fs')
const fsPromises = require('fs').promises
const crypto = require('crypto')
const listener = require('./listener')
const { clipboard, nativeImage } = require('electron')
const time = require('./time')

const sep = path.sep

async function readTextPreviewFile(fullPath, options = {}) {
  const startedAt = Date.now()
  let handle = null
  try {
    if (!fullPath || typeof fullPath !== 'string') {
      return { ok: false, error: 'invalid-path', backend: 'fs-async-text' }
    }
    const stat = await fsPromises.stat(fullPath)
    const maxBytes = Math.max(1, Number(options.maxBytes) || 1024 * 1024)
    const byteLength = Math.min(Number(stat.size) || 0, maxBytes)
    const buffer = Buffer.alloc(byteLength)
    handle = await fsPromises.open(fullPath, 'r')
    const result = await handle.read(buffer, 0, byteLength, 0)
    const text = buffer.subarray(0, result.bytesRead).toString(options.encoding || 'utf8')
    return {
      ok: true,
      text,
      size: Number(stat.size) || 0,
      bytesRead: result.bytesRead,
      truncated: Number(stat.size) > result.bytesRead,
      backend: 'fs-async-text',
      elapsedMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error || 'read-text-failed'),
      backend: 'fs-async-text',
      elapsedMs: Date.now() - startedAt
    }
  } finally {
    try {
      await handle?.close?.()
    } catch (_) {}
  }
}

async function readBinaryPreviewFile(fullPath, options = {}) {
  const startedAt = Date.now()
  try {
    if (!fullPath || typeof fullPath !== 'string') {
      return { ok: false, error: 'invalid-path', backend: 'fs-async-binary' }
    }
    const stat = await fsPromises.stat(fullPath)
    const maxBytes = Math.max(1, Number(options.maxBytes) || Number(stat.size) || 1)
    if (Number(stat.size) > maxBytes) {
      return {
        ok: false,
        error: 'file-too-large',
        size: Number(stat.size) || 0,
        limit: maxBytes,
        backend: 'fs-async-binary',
        elapsedMs: Date.now() - startedAt
      }
    }
    const data = await fsPromises.readFile(fullPath)
    return {
      ok: true,
      data,
      size: Number(stat.size) || 0,
      bytesRead: data.length,
      truncated: false,
      backend: 'fs-async-binary',
      elapsedMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error || 'read-binary-failed'),
      backend: 'fs-async-binary',
      elapsedMs: Date.now() - startedAt
    }
  }
}

async function renderPdfFirstPagePreview(fullPath, options = {}) {
  const startedAt = Date.now()
  try {
    if (!fullPath || typeof fullPath !== 'string') {
      return { ok: false, error: 'invalid-path', backend: 'utools-sharp' }
    }
    if (!utools || typeof utools.sharp !== 'function') {
      return { ok: false, error: 'sharp-unavailable', backend: 'utools-sharp' }
    }
    if (!existsSync(fullPath)) {
      return { ok: false, error: 'file-not-found', backend: 'utools-sharp' }
    }

    const density = Number.isFinite(Number(options.density)) ? Number(options.density) : 96
    const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Number(options.maxWidth) : 960
    let image = utools.sharp(fullPath, {
      density,
      page: 0,
      pages: 1,
      failOn: 'none'
    })
    if (maxWidth > 0) {
      image = image.resize({
        width: Math.max(240, Math.round(maxWidth)),
        fit: 'inside',
        withoutEnlargement: true
      })
    }
    const result = await image.png().toBuffer({ resolveWithObject: true })
    const data = result && result.data ? result.data : result
    const info = result && result.info ? result.info : {}
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || '')
    if (!buffer.length) {
      return { ok: false, error: 'empty-render-result', backend: 'utools-sharp' }
    }
    return {
      ok: true,
      src: 'data:image/png;base64,' + buffer.toString('base64'),
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      backend: 'utools-sharp',
      elapsedMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error || 'render-failed'),
      backend: 'utools-sharp',
      elapsedMs: Date.now() - startedAt
    }
  }
}

window.exports = {
  utools,
  path,
  os,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  mkdirSync,
  watch,
  rmSync,
  unlinkSync,
  rmdirSync,
  sep,
  crypto,
  listener,
  clipboard,
  nativeImage,
  time,
  readTextPreviewFile,
  readBinaryPreviewFile,
  renderPdfFirstPagePreview,
  Buffer
}
`,
  'listener.js': `const { chmodSync, existsSync, copyFileSync, mkdtempSync, rmSync } = require('fs')
const { EventEmitter } = require('events')
const path = require('path')
const { tmpdir } = require('os')
const { spawn } = require('child_process')

class ClipboardEventListener extends EventEmitter {
  constructor() {
    super()
    this.child = null
    this.listening = false
  }

  startListening(dbPath) {
    console.log('[listener.startListening] 开始启动监听, dbPath:', dbPath)
    const targetMap = {
      win32: 'clipboard-event-handler-win32.exe',
      linux: 'clipboard-event-handler-linux',
      darwin: 'clipboard-event-handler-mac'
    }
    const { platform } = process
    console.log('[listener.startListening] 平台:', platform)
    const bundledMacTarget = path.join(__dirname, 'native', 'clipboard-event-handler-mac')
    const useBundledMac = platform === 'darwin' && existsSync(bundledMacTarget)
    const target = useBundledMac ? bundledMacTarget : path.resolve(
      dbPath.split('_utools_clipboard_manager_storage')[0],
      targetMap[platform]
    )
    console.log('[listener.startListening] 监听程序路径:', target)
    if (!existsSync(target)) {
      console.error('[listener.startListening] 监听程序文件不存在')
      this.emit('error', '剪贴板监听程序不存在')
      return
    }
    console.log('[listener.startListening] 监听程序文件存在, 准备启动')
    let extractedDirectory = null
    const cleanupExecutable = () => {
      if (!extractedDirectory) return
      try {
        rmSync(extractedDirectory, { recursive: true, force: true })
        extractedDirectory = null
      } catch (error) {
        console.error('[listener] 临时程序清理失败:', error.code)
      }
    }
    try {
      let executable = target
      // spawn streams indefinitely, but Electron cannot spawn an ASAR member.
      // Copy only our bundled helper into a private temporary directory first.
      if (useBundledMac && target.includes('.asar' + path.sep)) {
        extractedDirectory = mkdtempSync(path.join(tmpdir(), 'ezclipboard-listener-'))
        executable = path.join(extractedDirectory, targetMap.darwin)
        copyFileSync(target, executable)
        chmodSync(executable, 0o755)
      } else if (platform === 'linux' || platform === 'darwin') {
        if (!useBundledMac) chmodSync(executable, 0o755)
      } else if (platform !== 'win32') {
        throw 'Not yet supported'
      }
      this.child = spawn(executable, [], { stdio: ['ignore', 'pipe', 'pipe'] })
      this.child.on('close', cleanupExecutable)
      console.log('[listener.startListening] 子进程已启动, PID:', this.child.pid)

      let pendingOutput = ''
      this.child.stdout.on('data', (data) => {
        pendingOutput += data.toString()
        const lines = pendingOutput.split('\\n')
        pendingOutput = lines.pop()
        for (const line of lines) {
          if (line.trim() === 'CLIPBOARD_CHANGE') this.emit('change')
        }
        // Preserve legacy helpers that send exactly one token without a newline.
        if (pendingOutput.trim() === 'CLIPBOARD_CHANGE') {
          pendingOutput = ''
          this.emit('change')
        }
      })

      this.child.stderr.on('data', (data) => {
        console.error('[listener.stderr] 错误输出:', data.toString())
      })

      this.child.stdout.on('close', () => {
        console.log('[listener.stdout] 子进程stdout关闭')
        this.listening = false
        this.emit('close')
      })

      this.child.on('exit', (code, signal) => {
        console.log('[listener] 子进程退出, code:', code, 'signal:', signal)
        this.listening = false
        this.emit('exit')
      })

      this.child.on('error', (error) => {
        console.error('[listener] 子进程错误:', error)
        this.listening = false
        this.emit('error', error)
      })

      this.listening = true
      console.log('[listener.startListening] 监听器启动成功, listening:', this.listening)
    } catch (error) {
      cleanupExecutable()
      console.error('[listener.startListening] 启动失败:', error)
      this.listening = false
      this.emit('error', error)
    }
  }

  stopListening() {
    console.log('[listener.stopListening] 停止监听')
    if (this.child) {
      const res = this.child.kill()
      console.log('[listener.stopListening] 子进程已终止, 结果:', res)
      this.listening = false
      return res
    }

    console.log('[listener.stopListening] 子进程不存在')
    this.listening = false
    return false
  }
}

module.exports = new ClipboardEventListener()
`,
  'time.js': `// time.js author: inu1255
const path=require("path");function newPromise(fn){let a,b;var tmp={resolve(x){if(this.pending){a(x);this.resolved=true;this.pending=false}},reject(e){if(this.pending){b(e);this.rejectd=true;this.pending=false}},pending:true,resolved:false,rejected:false};var pms=new Promise(function(resolve,reject){a=resolve;b=reject;if(fn)fn(tmp.resolve,tmp.reject)});return Object.assign(pms,tmp)}let cbIdx=1;const cbMap=new Map;function getWorker(){if(getWorker.worker)return getWorker.worker;const worker=new Worker(path.join(__dirname,"time.worker.js"));getWorker.worker=worker;worker.onmessage=e=>{if(e.data&&cbMap.has(e.data.cb)){cbMap.get(e.data.cb).apply(null,e.data.args)}};return worker}function call(method,args){const cb=cbIdx++;let pms=newPromise();cbMap.set(cb,function(err,data){if(err)pms.reject(err);else pms.resolve(data)});getWorker().postMessage({method:method,args:args,cb:cb});return pms}function sleep(ms){return call("sleep",[ms])}exports.sleep=sleep;
`,
  'time.worker.js': `// time.worker.js author: inu1255
const apis={sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}};onmessage=event=>{const data=event.data;if(!data)return;const{cb,method,args}=data;if(!apis[method]){postMessage({cb:cb,err:"no such method"});return}apis[method].apply(null,args).then(res=>postMessage({cb:cb,data:res}),err=>postMessage({cb:cb,err:err}))};
`
}

export function prepareUToolsRuntimeAssets(rootDir = process.cwd()) {
  const distDir = path.resolve(rootDir, 'dist')
  const logoSource = path.resolve(rootDir, 'src/data/logo.png')

  mkdirSync(distDir, { recursive: true })

  Object.entries(runtimeTextAssets).forEach(([name, content]) => {
    writeFileSync(path.resolve(distDir, name), content, 'utf8')
  })
  copyFileSync(logoSource, path.resolve(distDir, 'logo.png'))
  buildMacClipboardListener(rootDir, distDir)
}
