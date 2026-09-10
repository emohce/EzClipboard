<template>
  <div class="clip-full-data">
    <Transition name="fade">
      <div ref="wrapperRef" class="clip-full-wrapper" v-show="isShow">
        <div class="clip-full-operate-list">
          <ClipOperate
            :item="fullData"
            :isFullData="true"
            @onDataRemove="emit('onDataRemove')"
            @onOperateExecute="emit('onOverlayClick')"
            @openTagEdit="(item) => emit('openTagEdit', item)"
          ></ClipOperate>
        </div>
        <template v-if="fullData.type === 'text'">
          <div class="clip-full-content" v-text="fullData.data"></div>
        </template>
        <div v-else-if="fullData.type === 'image'">
          <div class="clip-full-content">
            <img :src="fullData.data" />
          </div>
        </div>
        <div v-else-if="fullData.type === 'file'">
          <div class="clip-full-content clip-full-file-content">
            <FileRichPreview ref="fullFilePreviewRef" :item="fullData" mode="full" />
            <FileList class="clip-full-file-list" :data="fullFileList"></FileList>
          </div>
        </div>
      </div>
    </Transition>
    <div class="clip-overlay" v-show="isShow" @click="onOverlayClick"></div>
  </div>
</template>

<script setup>
import FileList from './FileList.vue'
import FileRichPreview from './FileRichPreview.vue'
import ClipOperate from './ClipOperate.vue'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { activateLayer, deactivateLayer } from '../global/hotkeyLayers'
import { registerCommandFeaturePairs } from '../global/hotkeyRegistry'

const wrapperRef = ref(null)
const fullFilePreviewRef = ref(null)

const props = defineProps({
  isShow: {
    type: Boolean,
    required: true
  },
  fullData: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['onOverlayClick', 'onDataRemove', 'openTagEdit'])

const fullFileList = computed(() => {
  if (props.fullData.type !== 'file') return []
  try {
    const files = JSON.parse(props.fullData.data)
    return Array.isArray(files) ? files : []
  } catch (_) {
    return []
  }
})

const onOverlayClick = () => {
  emit('onOverlayClick')
}

const FULL_DATA_LAYER = 'full-data-overlay'
let disposeFullDataCommandHandlers = null

function handleFullDataCloseCommand() {
  if (props.fullData.data) {
    emit('onOverlayClick')
    return true
  }
  return false
}

function handleFullDataScrollUpCommand() {
  if (props.fullData.type === 'file' && fullFilePreviewRef.value?.scrollByDelta) {
    const el = fullFilePreviewRef.value.getScrollElement?.()
    const step = el ? Math.max(1, Math.round(el.clientHeight / 2)) : 0
    if (step && fullFilePreviewRef.value.scrollByDelta('up', -step)) return true
  }
  const el = wrapperRef.value
  if (!el) return false
  const half = el.clientHeight / 2
  el.scrollTop = Math.max(0, el.scrollTop - half)
  return true
}

function handleFullDataScrollDownCommand() {
  if (props.fullData.type === 'file' && fullFilePreviewRef.value?.scrollByDelta) {
    const el = fullFilePreviewRef.value.getScrollElement?.()
    const step = el ? Math.max(1, Math.round(el.clientHeight / 2)) : 0
    if (step && fullFilePreviewRef.value.scrollByDelta('down', step)) return true
  }
  const el = wrapperRef.value
  if (!el) return false
  const half = el.clientHeight / 2
  el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + half)
  return true
}

function handleFullDataBlockCommand() {
  return true
}

function registerFullDataHotkeys() {
  disposeFullDataCommandHandlers = registerCommandFeaturePairs([
    { featureId: 'full-data-close', commandId: 'preview.full.close', handler: handleFullDataCloseCommand },
    { featureId: 'full-data-scroll-up', commandId: 'preview.full.scroll.up', handler: handleFullDataScrollUpCommand },
    { featureId: 'full-data-scroll-down', commandId: 'preview.full.scroll.down', handler: handleFullDataScrollDownCommand },
    { featureId: 'full-data-block', commandId: 'preview.full.blockUnhandled', handler: handleFullDataBlockCommand }
  ])
}

onMounted(() => {
  registerFullDataHotkeys()
})

watch(
  () => props.isShow,
  (visible) => {
    if (visible) {
      activateLayer(FULL_DATA_LAYER)
    } else {
      deactivateLayer(FULL_DATA_LAYER)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  disposeFullDataCommandHandlers?.()
  disposeFullDataCommandHandlers = null
  deactivateLayer(FULL_DATA_LAYER)
})
</script>

<style lang="less" scoped>
.fade-enter-active,
.fade-leave-active {
  transition: all 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  width: 0px;
  opacity: 0;
}
</style>
