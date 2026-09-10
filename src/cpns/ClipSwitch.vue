<template>
  <div class="clip-switch">
    <div class="clip-switch-left">
      <div class="clip-switch-items">
        <template v-for="tab of tabs">
          <div
            :class="{ 'clip-switch-item': true, active: activeTab === tab.type }"
            :title="tab.name"
            @click="toggleNav(tab.type)"
          >
            <component :is="tab.icon"></component>
            {{ tab.name }}
          </div>
        </template>
      </div>
      <div v-show="activeTab === 'collect'" class="clip-switch-sub-items">
        <template v-for="sub of collectSubTabsList" :key="sub.type">
          <div
            :class="{ 'clip-switch-sub-item': true, active: collectSubTab === sub.type }"
            :title="sub.name"
            @click="setCollectSubTab(sub.type)"
          >
            {{ sub.name }}
          </div>
        </template>
      </div>
    </div>
    <slot name="SidePanel"></slot>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Menu, Tickets, Picture, Document, Collection } from '@element-plus/icons-vue'

// 基础标签页配置（收藏放首位）
const tabs = [
  { name: '收藏', type: 'collect', icon: Collection },
  { name: '全部', type: 'all', icon: Menu },
  { name: '文字', type: 'text', icon: Tickets },
  { name: '图片', type: 'image', icon: Picture },
  { name: '文件', type: 'file', icon: Document }
]

const activeTab = ref('all')

// 收藏子 tab：*全部* + 有使用数的标签，按使用频率排序
const COLLECT_ALL = '*全部*'
const collectSubTab = ref(COLLECT_ALL)

const COLLECT_SUB_HEAD = [{ name: '全部', type: COLLECT_ALL }]
const subTabsRefreshKey = ref(0)
const collectSubTabsList = computed(() => {
  subTabsRefreshKey.value
  if (!window.db) return COLLECT_SUB_HEAD
  try {
    const tags = window.db.getTags()
    const tagUsage = window.db.getTagUsage()
    const withUsage = tags.filter((t) => (tagUsage[t] || 0) > 0)
    const sorted = withUsage.sort((a, b) => (tagUsage[b] || 0) - (tagUsage[a] || 0))
    return COLLECT_SUB_HEAD.concat(sorted.map((tag) => ({ name: tag, type: tag })))
  } catch (error) {
    console.error('[ClipSwitch] 更新收藏子 tab 失败:', error)
    return COLLECT_SUB_HEAD
  }
})

const setCollectSubTab = (type) => {
  collectSubTab.value = type
}

const toggleNav = (type) => {
  activeTab.value = type
  if (type !== 'collect') {
    collectSubTab.value = COLLECT_ALL
  }
}

const handleDbChange = () => {
  subTabsRefreshKey.value++
  if (activeTab.value === 'collect' && collectSubTab.value !== COLLECT_ALL) {
    const types = collectSubTabsList.value.map((s) => s.type)
    if (!types.includes(collectSubTab.value)) {
      collectSubTab.value = COLLECT_ALL
    }
  }
}

onMounted(() => {
  if (window.listener) {
    window.listener.on('view-change', handleDbChange)
  }
})

defineExpose({
  tabs,
  activeTab,
  toggleNav,
  collectSubTab,
  setCollectSubTab,
  collectSubTabsList
})
</script>
