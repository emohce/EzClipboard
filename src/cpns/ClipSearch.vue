<template>
  <div class="clip-search">
    <div class="clip-search-input-wrap">
      <input
        class="clip-search-input"
        @focusout="handleFocusOut"
        @keydown="handleKeyDown"
        @beforeinput="onBeforeInput"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        v-model="filterText"
        type="text"
        :placeholder="placeholderOverride || (itemCount ? `在 ${itemCount} 条历史中检索` : '检索剪贴板历史')"
      />
      <span v-show="filterText" @click="clear" class="clip-search-suffix" title="清空搜索">×</span>
    </div>
    <div class="clip-search-lock-filter" role="tablist" aria-label="锁定状态筛选">
      <button
        v-for="option in lockOptions"
        :key="option.value"
        class="clip-search-filter-chip"
        :class="{ 'is-active': lockFilterValue === option.value }"
        type="button"
        @mousedown.prevent
        @click="setLockFilter(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { registerPluginEnterHandler } from '../global/pluginEnterHandlers'
const props = defineProps({
  modelValue: {
    type: String,
    required: true
  },
  itemCount: {
    type: Number
  },
  placeholderOverride: {
    type: String,
    default: ''
  },
  lockFilter: {
    type: String,
    default: 'all'
  },
  /** 由主界面「键入展开搜索」时的时间戳；与 revealOpeningKey 配合去掉误入的拉丁首字符 */
  revealFromKeyAt: {
    type: Number,
    default: 0
  },
  /** 展开搜索那一次 keydown 的 key（仅 a–z/A–Z 时才会拦截首击 insertText） */
  revealOpeningKey: {
    type: String,
    default: ''
  }
})

const lockOptions = [
  { label: '全部', value: 'all' },
  { label: '有锁', value: 'locked' }
]

const filterText = ref('')
const lockFilterValue = ref('all')
let suppressNextEmptyPanel = false
let skipEmptyExitAfterRevealGuard = false
const imeComposing = ref(false)
const emit = defineEmits(['update:modelValue', 'update:lockFilter', 'onPanelHide', 'onEmpty', 'revealKeyGuardUsed'])
// filterText变了 通知父组件修改 modelValue的值
watch(filterText, (val, prev) => {
  emit('update:modelValue', val)
  if (suppressNextEmptyPanel) {
    suppressNextEmptyPanel = false
    return
  }
  if (prev && !val && lockFilterValue.value === 'all') {
    if (imeComposing.value) return
    // 删除到空字符串时，通知父组件退出搜索
    emit('onEmpty')
  }
})

const handleFocusOut = () => {
  // 失去焦点时 如果没有输入内容 则隐藏输入框
  if (!filterText.value && lockFilterValue.value === 'all') {
    emit('onPanelHide')
  }
}

// modelValue变了 更新 filterText的值
watch(
  () => props.modelValue,
  (val) => (filterText.value = val)
)

watch(
  () => props.lockFilter,
  (val) => (lockFilterValue.value = val || 'all'),
  { immediate: true }
)

const clear = () => {
  emit('update:modelValue', '')
  nextTick(() => window.focus())
}

const setLockFilter = (value) => {
  lockFilterValue.value = value
  emit('update:lockFilter', value)
  nextTick(() => window.focus())
}

const revealGuardActive = () => {
  const t = props.revealFromKeyAt
  const k = props.revealOpeningKey
  return t > 0 && k && /^[a-zA-Z]$/.test(k) && Date.now() - t < 800
}

const onBeforeInput = (e) => {
  if (!revealGuardActive()) return
  if (e.isComposing) return
  if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return
  if (!/^[a-zA-Z]$/.test(e.data)) return
  if (e.data.toLowerCase() !== props.revealOpeningKey.toLowerCase()) return
  e.preventDefault()
  emit('revealKeyGuardUsed')
}

const onCompositionStart = (e) => {
  imeComposing.value = true
  if (!revealGuardActive()) return
  const k = props.revealOpeningKey
  const input = e.target
  if (!input || input.value.length !== 1) return
  if (input.value.toLowerCase() !== k.toLowerCase()) return
  if (!/^[a-zA-Z]$/.test(input.value)) return
  suppressNextEmptyPanel = true
  filterText.value = ''
  skipEmptyExitAfterRevealGuard = true
  emit('revealKeyGuardUsed')
}

const onCompositionEnd = () => {
  imeComposing.value = false
  nextTick(() => {
    if (skipEmptyExitAfterRevealGuard) {
      skipEmptyExitAfterRevealGuard = false
      return
    }
    if (!filterText.value && lockFilterValue.value === 'all') {
      emit('onEmpty')
    }
  })
}

const handleKeyDown = (e) => {
  // keep minimal work in keydown to avoid UI stalls
  // 当光标在末尾且没有选中文本时，Delete 键应该删除条目而不是删除文本
  if (e.key === 'Delete') {
    const input = e.target
    const isAtEnd = input.selectionStart === input.selectionEnd &&
                    input.selectionStart === input.value.length
    if (isAtEnd) {
      // 阻止默认的删除文本行为，但让事件继续冒泡以便父组件处理删除条目
      e.preventDefault()
      // 在事件对象上添加标记，表示应该删除条目
      e.shouldDeleteItem = true
      // 不阻止冒泡，让事件继续传播到 document 级别的事件处理器
    }
  }
  // Backspace 保持默认行为，用于删除搜索框中的文本
}

registerPluginEnterHandler((action) => {
  if (action?.code === 'quick-paste-top' || action?.code === 'quick-paste-pin-group') return
  // 如果输入框有内容 则清空 并且移除焦点
  if (filterText.value) {
    clear()
    nextTick(() => document.activeElement.blur())
  }
})
</script>
