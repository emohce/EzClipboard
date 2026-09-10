import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { prepareUToolsRuntimeAssets } from './scripts/utools-runtime-assets.mjs'

const resolveFromRoot = (path) => fileURLToPath(new URL(path, import.meta.url))
const chunkSizeWarningLimit = 1900

function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('/node_modules/vue/') || id.includes('/node_modules/@vue/')) {
    return 'vendor-vue'
  }
  if (
    id.includes('/node_modules/element-plus/') ||
    id.includes('/node_modules/@element-plus/') ||
    id.includes('/node_modules/@vueuse/') ||
    id.includes('/node_modules/@popperjs/') ||
    id.includes('/node_modules/@floating-ui/') ||
    id.includes('/node_modules/@ctrl/tinycolor/') ||
    id.includes('/node_modules/async-validator/') ||
    id.includes('/node_modules/lodash-unified/') ||
    id.includes('/node_modules/memoize-one/') ||
    id.includes('/node_modules/normalize-wheel-es/') ||
    id.includes('/node_modules/dayjs/')
  ) {
    return 'vendor-element-plus'
  }
  if (id.includes('/node_modules/vuedraggable/') || id.includes('/node_modules/sortablejs/')) {
    return 'vendor-drag'
  }
  if (id.includes('/node_modules/sql.js/')) {
    return 'storage-sql'
  }
  if (id.includes('/node_modules/pdfjs-dist/')) {
    return 'preview-pdf'
  }
  if (id.includes('/node_modules/@asciidoctor/core/')) {
    return 'preview-asciidoctor'
  }
  if (id.includes('/node_modules/mammoth/')) {
    return 'preview-word'
  }
  if (
    id.includes('/node_modules/read-excel-file/') ||
    id.includes('/node_modules/@xmldom/') ||
    id.includes('/node_modules/fflate/')
  ) {
    return 'preview-spreadsheet'
  }
  if (id.includes('/node_modules/jszip/')) {
    return 'preview-zip'
  }
  if (
    id.includes('/node_modules/markdown-it/') ||
    id.includes('/node_modules/entities/') ||
    id.includes('/node_modules/linkify-it/') ||
    id.includes('/node_modules/mdurl/') ||
    id.includes('/node_modules/punycode.js/') ||
    id.includes('/node_modules/uc.micro/')
  ) {
    return 'preview-markdown'
  }
  if (id.includes('/node_modules/yaml/')) {
    return 'preview-yaml'
  }
  if (id.includes('/node_modules/papaparse/')) {
    return 'preview-csv'
  }
  if (id.includes('/node_modules/dompurify/')) {
    return 'preview-sanitize'
  }
  return 'vendor'
}

function emitUToolsRuntimeAssets() {
  return {
    name: 'emit-utools-runtime-assets',
    apply: 'build',
    closeBundle() {
      prepareUToolsRuntimeAssets()
    }
  }
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [vue(), emitUToolsRuntimeAssets()],
  server: {
    port: 8081,
    strictPort: false,
    watch: {
      usePolling: false,
      interval: 100
    }
  },
  resolve: {
    alias: [
      {
        find: /^vue$/,
        replacement: resolveFromRoot('./node_modules/vue/dist/vue.runtime.esm-bundler.js')
      },
      {
        find: /^vuedraggable$/,
        replacement: resolveFromRoot('./node_modules/vuedraggable/src/vuedraggable.js')
      }
    ]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit,
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  }
})
