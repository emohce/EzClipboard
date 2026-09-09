/**
 * 浏览器 dev / initPlugin 未就绪时挂到 window，避免 Main 等访问 uTools runtime 报错。
 * 不与真实 runtime/db 冲突：仅当缺失时补最小 stub。
 */
export function ensureDevRuntimeStub() {
  if (typeof window === 'undefined') return
  if (!window.exports) {
    const memoryStorage = new Map()
    const utoolsStub = {
      dbStorage: {
        getItem: (key) => memoryStorage.get(key),
        setItem: (key, value) => memoryStorage.set(key, value),
        removeItem: (key) => memoryStorage.delete(key)
      },
      db: {
        get: () => null,
        put: () => true,
        remove: () => true,
        allDocs: () => []
      },
      getNativeId: () => 'dev-browser',
      getPath: () => '/tmp',
      isDarkColors: () => false,
      isMacOs: () => true,
      getCopyedFiles: () => null,
      showNotification: () => {},
      onPluginEnter: () => {},
      onPluginOut: () => {},
      hideMainWindow: () => {},
      hideMainWindowPasteText: () => true,
      hideMainWindowPasteImage: () => true,
      hideMainWindowPasteFile: () => true,
      hideMainWindowTypeString: () => true,
      getCurrentWindow: () => ({ setSize: () => {}, getSize: () => [0, 0] }),
      shellExec: () => ({ stdout: '', stderr: '' })
    }
    window.exports = {
      utools: utoolsStub,
      listener: {
        on() {
          return this
        },
        emit: () => {},
        listening: false,
        startListening: () => {}
      },
      time: {
        sleep: (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
      },
      clipboard: {
        availableFormats: () => [],
        readText: () => '',
        readBuffer: () => null,
        readImage: () => ({ isEmpty: () => true }),
        writeText: () => {},
        writeImage: () => {}
      },
      nativeImage: {
        createFromBuffer: () => ({ isEmpty: () => true, toPNG: () => null })
      },
      existsSync: () => false,
      writeFileSync: () => {},
      readFileSync: () => '',
      mkdirSync: () => {},
      rmSync: () => {},
      unlinkSync: () => {},
      rmdirSync: () => {},
      copyFileSync: () => {},
      sep: '/',
      Buffer: window.Buffer || { from: (value) => value },
      crypto: null,
      path: {
        join: (...parts) => parts.filter(Boolean).join('/'),
        dirname: (value) => String(value || '').split('/').slice(0, -1).join('/') || '/'
      }
    }
  }
  if (typeof window.utools === 'undefined') {
    window.utools = window.exports.utools
  }
  if (!window.listener) {
    window.listener = window.exports.listener
  }
}

ensureDevRuntimeStub()

export function ensureDevDbStub() {
  if (typeof window === 'undefined' || window.db) {
    return
  }
  const empty = {
    data: [],
    collects: [],
    collectData: [],
    tags: [],
    tagUsage: {},
    createTime: Date.now(),
    updateTime: Date.now()
  }
  window.db = {
    dataBase: empty,
    getCollects: () => [],
    getCollectsByTag: () => [],
    isCollected: () => false,
    addCollect: () => {},
    removeCollect: () => false,
    getTags: () => [],
    getTagUsage: () => ({}),
    getTagSuggestions: () => [],
    addItem: () => {},
    removeItemViaId: () => false,
    updateItemViaId: () => false,
    updateDataBaseLocal: () => {},
    queuePersist: () => {},
    emptyDataBase: () => {}
  }
  if (!window.remove) {
    window.remove = () => false
  }
  // 与 initPlugin 保持同一滚动容器口径：真实滚动容器是 .clip-item-scroll，document 仅兜底。
  const getListScrollElement = () =>
    document.querySelector('.clip-item-scroll') || document.scrollingElement
  if (!window.toTop) {
    window.toTop = () => {
      const el = getListScrollElement()
      if (el) el.scrollTop = 0
    }
  }
  if (!window.toBottom) {
    window.toBottom = () => {
      const el = getListScrollElement()
      if (el) el.scrollTop = el.scrollHeight
    }
  }
}
