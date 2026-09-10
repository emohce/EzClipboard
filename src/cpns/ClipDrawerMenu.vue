<template>
  <Transition :name="placement === 'right' ? 'drawer-right' : 'fade'">
    <div
      v-if="show"
      class="clip-drawer-menu"
      :class="{ 'clip-drawer-menu--right': placement === 'right' }"
      :style="drawerStyle"
      @click.stop
    >
      <div
        v-for="(op, idx) in localItems"
        :key="op.id"
        class="drawer-item"
        :class="{ active: idx === activeIndex }"
        :title="op.title"
        @click.stop="handleSelect(op, { sub: false })"
      >
        <span class="drawer-index">{{ idx + 1 }}</span>
        <span class="drawer-icon">{{ op.icon }}</span>
        <span class="drawer-title">{{ op.title }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { activateLayer, deactivateLayer } from '../global/hotkeyLayers'
import { registerCommandFeaturePairs } from '../global/hotkeyRegistry'

const props = defineProps({
  show: { type: Boolean, required: true },
  items: { type: Array, required: true },
  position: { type: Object, required: true },
  defaultActive: { type: Number, default: 0 },
  /** 'popup' 浮层定位 | 'right' 右侧抽屉，保留主列表可见 */
  placement: { type: String, default: 'right' }
})

const emit = defineEmits(['select', 'close'])

const drawerStyle = computed(() => {
  if (props.placement === 'right') {
    return { right: 0, top: 0, bottom: 0, width: '260px', left: 'auto' }
  }
  return { top: props.position.top + 'px', left: props.position.left + 'px' }
})

const localItems = ref([])
const activeIndex = ref(0)

watch(
  () => props.items,
  (val) => {
    localItems.value = [...val]
    activeIndex.value = Math.min(props.defaultActive, Math.max(val.length - 1, 0))
  },
  { immediate: true }
)

watch(
  () => props.show,
  (val) => {
    if (val) {
      activeIndex.value = Math.min(props.defaultActive, Math.max(localItems.value.length - 1, 0))
    }
  }
)

const handleSelect = (op, meta = {}) => {
  emit('select', op, meta)
}

const handleOutsideClick = (event) => {
  if (!props.show) return
  const target = event?.target
  if (!(target instanceof Element)) return
  if (target.closest('.clip-drawer-menu')) return
  emit('close')
}

const addOutsideListeners = () => {
  document.addEventListener('mousedown', handleOutsideClick, true)
  document.addEventListener('contextmenu', handleOutsideClick, true)
}

const removeOutsideListeners = () => {
  document.removeEventListener('mousedown', handleOutsideClick, true)
  document.removeEventListener('contextmenu', handleOutsideClick, true)
}

const layerName = 'clip-drawer'
let disposeDrawerCommandHandlers = null

function handleDrawerCloseCommand() {
  emit('close')
  return true
}

function handleDrawerNavDownCommand() {
  if (!localItems.value.length) return false
  activeIndex.value = (activeIndex.value + 1) % localItems.value.length
  return true
}

function handleDrawerNavUpCommand() {
  if (!localItems.value.length) return false
  activeIndex.value = (activeIndex.value - 1 + localItems.value.length) % localItems.value.length
  return true
}

function handleDrawerSelectCommand() {
  const target = localItems.value[activeIndex.value]
  if (!target) return false
  handleSelect(target, { sub: false })
  return true
}

function createDrawerSelectNumberHandler(num) {
  return (e) => {
    if (num >= 1 && num <= localItems.value.length) {
      const target = localItems.value[num - 1]
      handleSelect(target, { sub: e.shiftKey })
      return true
    }
    return false
  }
}

function handleDrawerBlockCommand() {
  return true
}

function registerDrawerHotkeys() {
  const pairs = [
    { featureId: 'drawer-close', commandId: 'drawer.close', handler: handleDrawerCloseCommand },
    { featureId: 'drawer-nav-down', commandId: 'drawer.navigate.down', handler: handleDrawerNavDownCommand },
    { featureId: 'drawer-nav-up', commandId: 'drawer.navigate.up', handler: handleDrawerNavUpCommand },
    { featureId: 'drawer-select', commandId: 'drawer.select', handler: handleDrawerSelectCommand }
  ]
  for (let n = 1; n <= 9; n++) {
    const num = n
    pairs.push({
      featureId: `drawer-select-${num}`,
      commandId: `drawer.select.${num}`,
      handler: createDrawerSelectNumberHandler(num)
    })
  }
  pairs.push({ featureId: 'drawer-block', commandId: 'drawer.blockUnhandled', handler: handleDrawerBlockCommand })
  disposeDrawerCommandHandlers = registerCommandFeaturePairs(pairs)
}

onMounted(() => {
  registerDrawerHotkeys()
})

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      activateLayer(layerName)
      addOutsideListeners()
    } else {
      deactivateLayer(layerName)
      removeOutsideListeners()
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  deactivateLayer(layerName)
  removeOutsideListeners()
  disposeDrawerCommandHandlers?.()
  disposeDrawerCommandHandlers = null
})
</script>

<style lang="less" scoped>
.clip-drawer-menu {
  position: fixed;
  z-index: 300;
  background: color-mix(in srgb, var(--bg-elevated-color) 92%, transparent);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--shadow-color);
  min-width: 180px;
  padding: 6px 0;
  backdrop-filter: blur(8px);
}
.clip-drawer-menu--right {
  border-radius: 8px 0 0 8px;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.2);
}
.drawer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
}
.drawer-item.active,
.drawer-item:hover {
  background: var(--nav-hover-bg-color);
}
.drawer-index {
  font-weight: 600;
  opacity: 0.7;
  width: 16px;
  text-align: right;
}
.drawer-icon {
  width: 20px;
  text-align: center;
}
.drawer-title {
  flex: 1;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.drawer-right-enter-active,
.drawer-right-leave-active {
  transition: transform 0.2s ease;
}
.drawer-right-enter-from,
.drawer-right-leave-to {
  transform: translateX(100%);
}
</style>
