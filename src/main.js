import { ensureDevDbStub } from './global/devDbStub'
import initPlugin from './global/initPlugin'
import { installPluginEnterMultiplexer } from './global/pluginEnterHandlers'
import { flushPendingQuickPasteActions } from './global/quickPasteRuntime'
import { createApp } from 'vue'
import App from './App.vue'
import './style/index.less'
import registerElement from './global/registerElement'
import { STORAGE_STATUS_EVENT, getStorageRuntimeStatus } from './storage/storageRuntimeStatus'
import setting, { SETTING_UPDATED_EVENT } from './global/readSetting'
import { bindThemePreference, applyThemePreference } from './global/theme'

let isBootstrapping = true

bindThemePreference(() => setting?.userConfig?.appearance?.theme)
window.addEventListener(SETTING_UPDATED_EVENT, (event) => {
  applyThemePreference(event?.detail?.userConfig?.appearance?.theme)
})

const renderStorageBootstrapStatus = (status = getStorageRuntimeStatus()) => {
  if (!isBootstrapping) return
  const root = document.getElementById('app')
  if (!root) return
  const isActive = ['checking', 'migrating'].includes(status.migrationStatus)
  if (!isActive) return
  const progress = Math.max(0, Math.min(100, Number(status.progress) || 0))
  const errorText = status.errorMessage
    ? `<div style="margin-top:8px;font-size:12px;line-height:1.6;color:var(--danger-color,#b42318);word-break:break-word;">${status.errorMessage}</div>`
    : ''
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg-color,#edf2f7);color:var(--text-color,#24324a);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="width:min(420px,calc(100vw - 48px));padding:22px 24px;border:1px solid var(--border-color,rgba(53,95,157,.16));border-radius:14px;background:var(--bg-elevated-color,#fff);box-shadow:0 18px 42px var(--shadow-color,rgba(15,23,42,.08));">
        <div style="font-weight:650;font-size:15px;">正在准备数据存储</div>
        <div style="margin-top:10px;font-size:13px;line-height:1.7;color:var(--text-color-lighter,#5f6b7a);">${status.stepText || '检查 SQLite 迁移状态'}</div>
        ${errorText}
        <div style="height:8px;margin-top:16px;border-radius:999px;background:var(--bg-soft-color,#e8eef5);overflow:hidden;">
          <div style="width:${progress}%;height:100%;background:var(--primary-color,#355f9d);"></div>
        </div>
      </div>
    </div>
  `
}

const handleBootstrapStorageStatus = (event) => renderStorageBootstrapStatus(event.detail)
window.addEventListener(STORAGE_STATUS_EVENT, handleBootstrapStorageStatus)

;(async () => {
  try {
    renderStorageBootstrapStatus()
    installPluginEnterMultiplexer()
    await initPlugin()
  } catch (err) {
    console.warn('[main] initPlugin 未完成:', err)
  }
  isBootstrapping = false
  window.removeEventListener(STORAGE_STATUS_EVENT, handleBootstrapStorageStatus)
  ensureDevDbStub()
  // 冷启动快速粘贴不依赖任何 DOM：在挂载 Vue 之前先 flush，
  // 省掉一整轮首屏 JS/CSS 解析与渲染的等待。
  flushPendingQuickPasteActions()
  const app = createApp(App)
  app.use(registerElement)
  app.mount('#app')
})()
