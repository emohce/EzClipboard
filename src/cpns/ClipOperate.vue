<template>
  <div class="clip-operate">
    <template v-for="o of operation" :key="o.id">
      <div
        v-if="filterOperate(o, item, isFullData)"
        :class="o.id"
        :title="o.title"
        @click.stop="handleOperateClick(o, item)"
      >
        {{ o.icon }}
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import defaultOperation from '../data/operation.json'
import setting from '../global/readSetting'
import useClipOperate from '../hooks/useClipOperate'

const emit = defineEmits(['onDataChange', 'onDataRemove', 'onOperateExecute', 'openTagEdit'])
const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  isFullData: {
    type: Boolean,
    default: false
  },
  currentActiveTab: {
    type: String,
    default: 'all'
  }
})

const operation = computed(() => [...defaultOperation, ...setting.operation.custom])

const { handleOperateClick, filterOperate } = useClipOperate({ emit, currentActiveTab: () => props.currentActiveTab })
</script>

