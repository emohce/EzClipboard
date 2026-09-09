<template>
    <div class="main" tabindex="-1">
        <ClipFullData
            :isShow="fullDataShow"
            :fullData="fullData"
            @onDataRemove="handleDataRemove"
            @onOverlayClick="toggleFullData({ type: 'text', data: '' })"
            @openTagEdit="openTagEditModal"
        ></ClipFullData>
        <ClipSwitch ref="ClipSwitchRef">
            <template #SidePanel>
                <div class="clip-switch-btn-list" v-show="!isSearchPanelExpand">
                    <el-tooltip
                        content="已选条数"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn clip-select-count"
                            v-show="isMultiple"
                        >
                            {{ selectCount }}
                        </span>
                    </el-tooltip>
                    <el-tooltip
                        content="复制所选"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn"
                            v-show="isMultiple"
                            @click="handleMultiCopyBtnClick(false)"
                        >
                            复制
                        </span>
                    </el-tooltip>
                    <el-tooltip
                        content="复制并粘贴所选"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn"
                            v-show="isMultiple"
                            @click="handleMultiCopyBtnClick(true)"
                        >
                            粘贴
                        </span>
                    </el-tooltip>
                    <el-tooltip
                        :content="multiSelectTooltip"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn"
                            @click="isMultiple = !isMultiple"
                            >{{ isMultiple ? "退出多选" : "多选" }}</span
                        >
                    </el-tooltip>
                    <el-tooltip
                        :content="settingTooltip"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn clip-setting-btn"
                            :class="{ 'has-storage-notice': storageStatus.noticeUnread }"
                            v-show="!isMultiple"
                            @click="emit('showSetting')"
                            >设置</span
                        >
                    </el-tooltip>
                    <el-tooltip
                        :content="clearTooltip"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn"
                            v-show="!isMultiple"
                            @click="handleOpenCleanDialog"
                            >清空</span
                        >
                    </el-tooltip>
                    <el-tooltip
                        :content="searchTooltip"
                        placement="bottom"
                        :show-after="150"
                    >
                        <span
                            class="clip-switch-btn clip-search-btn is-primary"
                            v-show="!isMultiple"
                            @click="handleSearchBtnClick"
                        >
                            搜索
                        </span>
                    </el-tooltip>
                </div>
                <ClipSearch
                    v-show="isSearchPanelExpand"
                    @onPanelHide="isSearchPanelExpand = false"
                    @onEmpty="handleSearchEmpty"
                    @reveal-key-guard-used="clearSearchRevealKeyGuard"
                    v-model="filterText"
                    v-model:lockFilter="lockFilter"
                    :itemCount="currentSearchItemCount"
                    :placeholderOverride="searchPlaceholder"
                    :reveal-from-key-at="revealFromKeyAt"
                    :reveal-opening-key="revealOpeningKey"
                ></ClipSearch>
            </template>
        </ClipSwitch>
        <div
            class="clip-break"
            :class="{ 'clip-break--with-sub': activeTab === 'collect' }"
        ></div>
        <div class="clip-empty-status" v-if="currentShowList.length === 0">
            暂无记录
        </div>

        <div
            class="collect-block-header"
            v-if="collectBlockList.length > 0 && activeTab !== 'collect'"
        >
            收藏结果
        </div>
        <ClipItemList
            ref="ClipItemListRef"
            :showList="currentShowList"
            :collectedIds="collectedIds"
            :pinnedMap="pinnedMap"
            :fullData="fullData"
            :isMultiple="isMultiple"
            :currentActiveTab="activeTab"
            :lockFilter="lockFilter"
            :isSearchPanelExpand="isSearchPanelExpand"
            @onMultiCopyExecute="handleMultiCopyBtnClick"
            @toggleMultiSelect="handleToggleMultiSelect"
            @onDataChange="toggleFullData"
            @onDataRemove="handleDataRemove"
            @onItemDelete="handleItemDelete"
            @onItemsDelete="handleItemsDelete"
            @openCleanDialog="handleOpenCleanDialog"
            @openTagEdit="openTagEditModal"
            @togglePin="handleTogglePin"
            @pastePinGroupAll="pastePinGroupAll"
            @editPinGroup="openExistingPinGroupEditor"
            @clearPinGroup="handlePinGroupClear"
            @loadMore="handleListLoadMore"
        >
        </ClipItemList>

        <Transition name="clear-panel">
            <div
                class="clear-panel"
                v-if="isClearDialogVisible"
                ref="clearDialogBodyRef"
            >
                <div class="clear-panel-header">
                    <div>
                        <h3>清除记录</h3>
                        <span class="clear-panel-sub"
                            >仅清除「{{
                                activeTabLabel
                            }}」标签页内的记录。</span
                        >
                    </div>
                    <button class="clear-panel-close" @click="closeClearDialog">
                        ✕
                    </button>
                </div>
                <div class="clear-panel-body">
                    <p class="clear-panel-tip" v-if="isClearingCollectTab">
                        收藏内容将通过“取消收藏”完成清除。
                    </p>
                    <p class="clear-panel-tip" v-else>
                        操作与多选删除一致，收藏内容不会受影响。
                    </p>
                    <div class="clear-range-group" v-if="!isClearing">
                        <button
                            v-for="option in CLEAR_RANGE_OPTIONS"
                            :key="option.value"
                            :class="[
                                'range-button',
                                { active: clearRange === option.value },
                            ]"
                            :data-range="option.value"
                            @click="handleRangeClick(option.value)"
                            @keydown="handleRangeKeydown($event, option.value)"
                            tabindex="0"
                            type="button"
                        >
                            <span>{{ option.label }}</span>
                        </button>
                    </div>
                    <div class="clear-progress" v-if="isClearing">
                        <el-progress
                            :percentage="clearProgress.percentage"
                            :format="progressFormat"
                        />
                        <p class="clear-progress-text">
                            正在清除... {{ clearProgress.current }} / {{ clearProgress.total }}
                        </p>
                    </div>
                </div>
                <div class="clear-panel-footer">
                    <el-button @click="closeClearDialog">取消</el-button>
                    <el-button
                        type="primary"
                        :loading="isClearing"
                        @click="handleClearConfirm"
                        >确定</el-button
                    >
                </div>
            </div>
        </Transition>
        <div
            class="clear-panel-overlay"
            v-show="isClearDialogVisible"
            @click="closeClearDialog"
        ></div>

        <!-- 标签编辑模态框 -->
        <TagEditModal
            :visible="tagEditModalVisible"
            :item="tagEditItem"
            @close="closeTagEditModal"
            @save="handleTagEditSave"
            @uncollect="handleTagEditUncollect"
        />

        <!-- 标签搜索模态框 -->
        <TagSearchModal
            :visible="tagSearchModalVisible"
            @close="closeTagSearchModal"
            @selectTag="handleTagSelect"
        />
        <PinGroupEditor
            :visible="pinGroupEditorVisible"
            :items="pinGroupEditorItems"
            @close="closePinGroupEditor"
            @save="handlePinGroupSave"
            @clear="handlePinGroupClear"
        />
    </div>
</template>

<script setup>
import { ref, shallowRef, watch, onMounted, onUnmounted, computed, nextTick } from "vue";
import {
    ElMessage,
    ElMessageBox,
    ElButton,
    ElRadioGroup,
    ElRadioButton,
    ElTooltip,
    ElProgress,
} from "element-plus";
import { activateLayer, deactivateLayer, getCurrentLayer } from "../global/hotkeyLayers";
import { registerCommandFeaturePairs, setMainState } from "../global/hotkeyRegistry";
import { formatShortcutDisplay } from "../global/shortcutKey";
import { copyAndPasteAndExit, itemMatchesBodyKeyword } from "../utils";
import ClipItemList from "../cpns/ClipItemList.vue";
import ClipFullData from "../cpns/ClipFullData.vue";
import ClipSearch from "../cpns/ClipSearch.vue";
import ClipSwitch from "../cpns/ClipSwitch.vue";
import TagEditModal from "../cpns/TagEditModal.vue";
import TagSearchModal from "../cpns/TagSearchModal.vue";
import PinGroupEditor from "../cpns/PinGroupEditor.vue";
import notify from "../data/notify.json";
import {
    STORAGE_STATUS_EVENT,
    getStorageRuntimeStatus,
} from "../storage/storageRuntimeStatus";
import {
    getPinGroup,
    getPinnedMap,
    clearPinGroup,
    removePinGroupItems,
    removePinnedItems,
    savePinGroup,
    getPinGroupState,
    setLastActiveContext,
    sortPinnedItems,
    togglePinnedItem,
} from "../storage/pinnedItems";
import {
    composeQuickPasteTopItems,
    resolvePinGroupItemsById,
} from "../global/quickPasteSelection";
import {
    clearQuickPastePinGroupCache,
    clearQuickPasteTopCache,
    setQuickPastePinGroupCache,
    setQuickPasteTopCache,
} from "../global/quickPasteRuntime";
import { rewindLoadedCursorAfterDelete } from "../utils/listRefresh.mjs";

const CLEAR_RANGE_OPTIONS = [
    { label: "1 小时内", value: "1h" },
    { label: "5 小时内", value: "5h" },
    { label: "8 小时内", value: "8h" },
    { label: "24 小时内", value: "24h" },
    { label: "7 天内", value: "7d" },
    { label: "全部", value: "all" },
];

const RANGE_DURATION_MAP = {
    "1h": 60 * 60 * 1000,
    "5h": 5 * 60 * 60 * 1000,
    "8h": 8 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    all: null,
};

const notifyShown = ref(false); // 将在onMounted时根据此值判断是否显示通知
const storageNotify = utools.dbStorage.getItem("notify");
notifyShown.value = storageNotify
    ? storageNotify.version < notify.version
    : true;
const DEBUG_KEYS = false;

const isMultiple = ref(false);

const isSearchPanelExpand = ref(false);

/** 列表键入展开搜索时传给 ClipSearch，用于吃掉误入的拉丁首字符（IME 前先 insertText 的字母） */
const revealFromKeyAt = ref(0);
const revealOpeningKey = ref("");
const clearSearchRevealKeyGuard = () => {
    revealFromKeyAt.value = 0;
    revealOpeningKey.value = "";
};

const handleSearchEmpty = () => {
    clearSearchRevealKeyGuard();
    filterText.value = "";
    isSearchPanelExpand.value = false;
    window.focus();
};

const isClearDialogVisible = ref(false);
const CLEAR_DIALOG_LAYER = "clear-dialog";
const clearRange = ref("1h");
const isClearing = ref(false);
const clearProgress = ref({ current: 0, total: 0, percentage: 0 });
const clearDialogBodyRef = ref(null);

// 标签编辑模态框
const tagEditModalVisible = ref(false);
const tagEditItem = ref(null);

// 标签搜索模态框
const tagSearchModalVisible = ref(false);

const handleSearchBtnClick = () => {
    // 展开搜索框
    isSearchPanelExpand.value = true;
    nextTick(() => window.focus());
};

const focusSearchInput = (initialValue = "") => {
    nextTick(() => {
        const input = document.querySelector(".clip-search-input");
        if (input) {
            input.focus();
            if (typeof initialValue === "string") {
                input.value = initialValue;
                filterText.value = initialValue;
                input.setSelectionRange(
                    initialValue.length,
                    initialValue.length,
                );
            }
        }
    });
};

const resetPluginUiState = () => {
    clearSearchRevealKeyGuard();
    filterText.value = "";
    lockFilter.value = "all";
    isSearchPanelExpand.value = false;
    nextTick(() => document.activeElement?.blur?.());
};

const ClipItemListRef = ref(null);
const selectCount = ref(0);
const handleToggleMultiSelect = (val = true) => {
    isMultiple.value = Boolean(val);
};
const handleMultiCopyBtnClick = (isPaste, options = {}) => {
    let paste = isPaste;
    let persist = false;
    let exitMulti = true;
    if (typeof isPaste === "object" && isPaste) {
        paste = Boolean(isPaste.paste);
        persist = Boolean(isPaste.persist);
        exitMulti = isPaste.exit !== false;
    } else {
        persist = Boolean(options.persist);
        exitMulti = options.exit !== false;
    }

    const itemList = ClipItemListRef.value.selectItemList;
    if (!Array.isArray(itemList) || itemList.length === 0) {
        return;
    }
    // 仅选一条且为图片时直接复制，不生成临时文件、不进入合并逻辑
    if (itemList.length === 1 && itemList[0].type === "image") {
        const ok = copyAndPasteAndExit(itemList[0], {
            paste,
            exit: true,
            respectImageCopyGuard: true,
        });
        if (ok) {
            ElMessage({ message: "复制成功", type: "success" });
        }
        if (exitMulti) {
            ClipItemListRef.value.emptySelectItemList();
            isMultiple.value = false;
        }
        return;
    }
    // 如果包含了图片/文件 则转为文件合并 否则仅合并文本
    const isMergeFile =
        itemList.filter((item) => item.type === "image" || item.type === "file")
            .length !== 0;
    const addMergedItemToDb = (item, options = {}) => {
        const { locked = false } = options;
        const crypto = window.exports?.crypto;
        if (!window.db || !crypto || !item?.data) return false;
        const id = crypto.createHash("md5").update(item.data).digest("hex");
        const dataList = window.db.dataBase?.data || [];
        const collectList = window.db.dataBase?.collectData || [];
        if (
            dataList.some((i) => i.id === id) ||
            collectList.some((i) => i.id === id)
        ) {
            return false;
        }
        const now = Date.now();
        window.db.addItem({
            ...item,
            id,
            locked,
            createTime: now,
            updateTime: now,
        });
        return true;
    };

    if (isMergeFile) {
        const filePathArray = [];
        itemList.map((item) => {
            const { type } = item;
            if (type === "text") {
                const textFile = window.createFile(item);
                filePathArray.push({
                    path: textFile,
                });
            } else if (type === "file") {
                const files = JSON.parse(item.data);
                filePathArray.push(...files);
            }
            // type === 'image' 不生成临时图片，跳过
        });
        const fileData = JSON.stringify(filePathArray.reverse());
        copyAndPasteAndExit(
            { type: "file", data: fileData },
            { paste, exit: true, respectImageCopyGuard: true },
        );
        if (persist) {
            addMergedItemToDb({
                type: "file",
                data: fileData,
                originPaths: filePathArray.map((f) => f.path).filter(Boolean),
            }, { locked: paste });
        }
    } else {
        const eol =
            (window?.exports && window.exports.os && window.exports.os.EOL) ||
            (navigator.userAgent.includes("Windows") ? "\r\n" : "\n");
        const result = itemList
            .map((item) => item.data)
            .reverse()
            .join(eol);
        copyAndPasteAndExit(
            { type: "text", data: result },
            { paste, exit: true, respectImageCopyGuard: true },
        );
        if (persist) {
            addMergedItemToDb({ type: "text", data: result }, { locked: paste });
        }
    }
    ElMessage({
        message: "复制成功",
        type: "success",
    });
    // 粘贴逻辑已经在 copyAndPasteAndExit 内按 paste 参数执行
    if (exitMulti) {
        ClipItemListRef.value.emptySelectItemList();
        isMultiple.value = false;
    }
};

const GAP = 15; // 懒加载 每次添加的条数
const offset = ref(0); // 懒加载 偏移量
const filterText = ref(""); // 搜索框绑定值
const lockFilter = ref("all"); // 锁定状态筛选
const list = shallowRef([]); // 全部数据快照
const showList = shallowRef([]); // 展示的数据
const collectBlockList = shallowRef([]); // 非收藏 tab 且 * 前缀时，上方展示的收藏匹配结果
const collectVersion = ref(0); // 收藏列表变更时自增，用于驱动星标等 UI 更新
const pinnedMap = shallowRef(getPinnedMap());
const pinGroup = shallowRef(null);
const pinGroupEditorVisible = ref(false);
const pinGroupEditorItems = shallowRef([]);
const queryCursor = ref(null);
const currentQueryTotal = ref(0);
let pendingDataRefresh = false;
let lastSyncedDbVersion = 0;
const TAB_PREFETCH_PAGES = 3;
const NEXT_PAGE_PREFETCH_THRESHOLD = 6;
const PREFETCH_TABS = ["all", "text", "image", "file", "collect"];
const tabQueryCache = new Map();
let tabPrefetchTimer = null;
let isLoadingNextPage = false;

/** 普通 tab 下收藏块仅在此条件下展示：输入第一个字符为 *。* 后紧跟着的非空格到第一个空格为标签条件；* 后紧跟空格则搜索全部收藏。 */
const parseStarFilter = (raw) => {
    const s = raw ?? "";
    if (s.length === 0 || s[0] !== "*")
        return { isStar: false, tagKeyword: "", bodyKeyword: "" };
    const afterStar = s.slice(1);
    const firstNonSpace = afterStar.search(/\S/);
    if (firstNonSpace === -1)
        return { isStar: true, tagKeyword: "", bodyKeyword: "" };
    const rest = afterStar.slice(firstNonSpace);
    const spaceIdx = rest.indexOf(" ");
    const tagKeyword = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
    const bodyKeyword = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
    return { isStar: true, tagKeyword, bodyKeyword };
};

const bodyFilterCallBack = (item, bodyKeyword) =>
    itemMatchesBodyKeyword(item, bodyKeyword);

const tagMatch = (item, tagKeyword) => {
    if (!tagKeyword) return true;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const k = tagKeyword.toLowerCase();
    return tags.some((t) => String(t).toLowerCase().indexOf(k) !== -1);
};

const matchLockFilter = (item) => {
    if (lockFilter.value === "locked") return item.locked === true;
    return true;
};

const matchLockFilterValue = (item, value = "all") => {
    if (value === "locked") return item?.locked === true;
    return true;
};

const matchSearchableItemType = (item, keyword, tabType = activeTab.value) => {
    if (tabType === "text") return item.type === "text";
    if (tabType === "image") return item.type === "image";
    if (tabType === "file") return item.type === "file";
    if (tabType === "collect") return true;
    // 全部：有关键词时图片仅在与别名/标签匹配时参与（正文为 base64 不做检索）
    if (keyword && item.type === "image") {
        return itemMatchesBodyKeyword(item, keyword);
    }
    return keyword ? item.type !== "image" : true;
};

const filterNonImageWhenSearching = (items, keyword, tabType = activeTab.value) =>
    items.filter((item) => matchSearchableItemType(item, keyword, tabType));

const matchMainTabItem = (item, bodyKeyword, tabType = activeTab.value) =>
    matchSearchableItemType(item, bodyKeyword, tabType) &&
    matchLockFilter(item) &&
    bodyFilterCallBack(item, bodyKeyword);

const isCollectedItem = (item) => Boolean(item?.id && window.db?.isCollected?.(item.id));

const itemMatchesContext = (item, context = getCurrentFilterContext()) => {
    if (!item) return false;
    const parsed = parseStarFilter(context.keyword);
    if (context.tab === "collect") {
        if (!isCollectedItem(item)) return false;
        if (context.collectTag && context.collectTag !== "*全部*" && !tagMatch(item, context.collectTag)) return false;
        if (context.lockFilter === "locked" && item.locked !== true) return false;
        if (parsed.isStar) {
            return tagMatch(item, parsed.tagKeyword) && bodyFilterCallBack(item, parsed.bodyKeyword);
        }
        return matchSearchableItemType(item, context.keyword.trim(), "collect") &&
            bodyFilterCallBack(item, context.keyword.trim());
    }
    if (isCollectedItem(item)) return false;
    if (parsed.isStar) {
        return matchSearchableItemType(item, context.keyword, context.tab) &&
            matchLockFilterValue(item, context.lockFilter) &&
            bodyFilterCallBack(item, parsed.bodyKeyword);
    }
    return matchSearchableItemType(item, context.keyword.trim(), context.tab) &&
        matchLockFilterValue(item, context.lockFilter) &&
        bodyFilterCallBack(item, context.keyword.trim());
};

const applyCollectFilters = (items, parsed) => {
    if (parsed.isStar) {
        return filterNonImageWhenSearching(items, filterText.value)
            .filter((item) => matchLockFilter(item))
            .filter((item) => tagMatch(item, parsed.tagKeyword))
            .filter((item) => bodyFilterCallBack(item, parsed.bodyKeyword));
    }
    return filterNonImageWhenSearching(items, filterText.value)
        .filter((item) => matchLockFilter(item))
        .filter((item) => textFilterCallBack(item));
};

const textFilterCallBack = (item) => {
    const parsed = parseStarFilter(filterText.value);
    const bodyPart = parsed.isStar
        ? parsed.bodyKeyword
        : filterText.value.trim();
    return bodyFilterCallBack(item, bodyPart);
};

const getClearDialogFocusables = () => {
    const container = clearDialogBodyRef.value;
    if (!container) return [];
    // 只获取时间选项和底部按钮，排除关闭按钮
    const rangeButtons = Array.from(
        container.querySelectorAll(".clear-range-group .range-button"),
    );
    const footerButtons = Array.from(
        container.querySelectorAll(".clear-panel-footer button"),
    );

    // 过滤掉不可见和禁用的元素
    const visibleRangeButtons = rangeButtons.filter(
        (el) => !el.disabled && el.offsetParent !== null,
    );
    const visibleFooterButtons = footerButtons.filter(
        (el) => !el.disabled && el.offsetParent !== null,
    );

    // 确保顺序：时间选项 -> 取消按钮 -> 清除按钮
    return [...visibleRangeButtons, ...visibleFooterButtons];
};

const handleRangeClick = (value) => {
    clearRange.value = value;
    // 点击后自动聚焦到该按钮
    nextTick(() => {
        const button = document.querySelector(`[data-range="${value}"]`);
        button?.focus();
    });
};

// 监听选中状态变化，自动更新焦点
watch(clearRange, (newValue) => {
    if (isClearDialogVisible.value) {
        nextTick(() => {
            const button = document.querySelector(`[data-range="${newValue}"]`);
            button?.focus();
        });
    }
});

const CLEAR_GRID_COLS = 2;
const handleRangeKeydown = (e, value) => {
    const { key } = e;
    if (key === "Enter" || key === " ") {
        e.preventDefault();
        clearRange.value = value;
        return;
    }
    if (key === "Tab") {
        // 让全局的Tab处理逻辑接管
        return;
    }
};

watch(
    () => isClearDialogVisible.value,
    (visible) => {
        if (visible) {
            activateLayer(CLEAR_DIALOG_LAYER);
        } else {
            deactivateLayer(CLEAR_DIALOG_LAYER);
        }
    },
);

watch(
    [isSearchPanelExpand, isMultiple],
    () => {
        setMainState(
            isSearchPanelExpand.value
                ? "search"
                : isMultiple.value
                  ? "multi-select"
                  : "normal",
        );
    },
    { immediate: true },
);

const getCollectSubTab = () => {
    const ref = ClipSwitchRef.value?.collectSubTab;
    return ref?.value ?? ref ?? "*全部*";
};

const COLLECT_BLOCK_CAP = 20;

const getQueryCacheKey = (type) =>
    JSON.stringify({
        tab: type,
        keyword: filterText.value,
        lockFilter: lockFilter.value,
        collectTag: type === "collect" ? getCollectSubTab() : "*全部*",
        version: getDbVersion(),
    });

const getQueryOptions = (type, cursor = 0, limit = GAP) => ({
    tab: type,
    keyword: filterText.value,
    lockFilter: lockFilter.value,
    collectTag: type === "collect" ? getCollectSubTab() : "*全部*",
    cursor,
    limit,
});

const setShowListFromQueryResult = (result, loadedCount = null) => {
    collectBlockList.value = [];
    showList.value = hydrateVisibleItems(result.items);
    queryCursor.value =
        result.nextCursor == null
            ? null
            : loadedCount != null
              ? Math.min(loadedCount, result.total)
              : result.nextCursor;
    currentQueryTotal.value = result.total;
    offset.value = showList.value.length;
};

const needsPayloadHydration = (item) =>
    Boolean(item?.id && item.dataPath && (item.data == null || item.data === ""));

const hydrateVisibleItem = (item) => {
    if (!needsPayloadHydration(item)) return item;
    const hydrated =
        window.db?.getById?.(item.id) ||
        window.db?.filterDataBaseViaId?.(item.id)?.[0];
    return hydrated?.id && !needsPayloadHydration(hydrated) ? hydrated : item;
};

const hydrateVisibleItems = (items = []) =>
    (Array.isArray(items) ? items : []).map((item) => hydrateVisibleItem(item));

const getAllKnownItems = () => {
    const items = [
        ...showList.value,
        ...collectBlockList.value,
        ...(window.db?.dataBase?.data || []),
        ...(window.db?.dataBase?.collectData || []),
    ];
    const seen = new Set();
    return items.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
};

const getCurrentFilterContext = () => ({
    tab: activeTab.value,
    collectTag: activeTab.value === "collect" ? getCollectSubTab() : "*全部*",
    keyword: filterText.value,
    lockFilter: lockFilter.value,
});

const persistLastActiveContext = () => {
    setLastActiveContext(getCurrentFilterContext());
};

const getPinnedItemsForContext = (context = getCurrentFilterContext()) => {
    const map = pinnedMap.value || {};
    const pinnedIds = Object.keys(map).filter(Boolean);
    if (!pinnedIds.length) return [];
    const items = resolvePinGroupItemsById(pinnedIds, {
        knownItems: getAllKnownItems(),
        getItemById: (id) => window.db?.getById?.(id) || window.db?.filterDataBaseViaId?.(id)?.[0] || null,
    });
    return sortPinnedItems(
        items.filter((item) => itemMatchesContext(item, context)),
        map,
    );
};

const getItemInlineSummary = (item) => {
    if (!item) return "";
    if (item.type === "text") return String(item.data || "").replace(/\s+/g, " ").slice(0, 32);
    if (item.type === "image") return "图片";
    if (item.type === "file") {
        try {
            const files = JSON.parse(item.data);
            const first = Array.isArray(files) ? files[0] : null;
            return first?.name || first?.path || "文件";
        } catch (_) {
            return "文件";
        }
    }
    return String(item.data || "").slice(0, 32);
};

const getFileNameFromPath = (file = {}) =>
    file.name || String(file.path || "").split(/[/\\]/).pop() || "文件";

const getFilePreviewType = (fileName = "") => {
    const ext = String(fileName).split(".").pop()?.toLowerCase() || "";
    if (ext === "txt") return "";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return "pic";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "zip";
    if (["xls", "xlsx", "xlsm", "csv"].includes(ext)) return "excel";
    if (["doc", "docx"].includes(ext)) return "word";
    if (["ppt", "pptx"].includes(ext)) return "ppt";
    if (ext === "pdf") return "pdf";
    return ext || "file";
};

const getPinGroupPreviewLines = (items = []) =>
    items.flatMap((item) => {
        if (!item) return [];
        if (item.type === "text") {
            const text = String(item.data || "").replace(/\s+/g, " ").trim();
            return [text ? text.slice(0, 60) : "文本内容"];
        }
        if (item.type === "image") return [{ type: "pic", name: "图片内容" }];
        if (item.type === "file") {
            try {
                const files = JSON.parse(item.data);
                if (!Array.isArray(files) || !files.length) return [{ type: "file", name: "文件内容" }];
                return files.map((file) => {
                    const name = getFileNameFromPath(file);
                    return { type: getFilePreviewType(name), name };
                });
            } catch (_) {
                return [{ type: "file", name: "文件内容" }];
            }
        }
        return [String(item.data || "").slice(0, 60)];
    });

const composeTopItems = (baseItems = [], context = getCurrentFilterContext()) =>
    composeQuickPasteTopItems({
        baseItems,
        pinnedItems: getPinnedItemsForContext(context),
    });

const prefetchTabPages = (type) => {
    if (!window.db?.query || parseStarFilter(filterText.value).isStar) return;
    if (filterText.value.trim() || lockFilter.value !== "all") return;
    const key = getQueryCacheKey(type);
    if (tabQueryCache.has(key)) return;
    const limit = GAP * TAB_PREFETCH_PAGES;
    const result = window.db.query(getQueryOptions(type, 0, limit));
    tabQueryCache.set(key, {
        result,
        loadedCount: result.items.length,
        version: getDbVersion(),
        createdAt: Date.now(),
    });
};

const scheduleTabPrefetch = (activeType) => {
    if (tabPrefetchTimer) clearTimeout(tabPrefetchTimer);
    if (!window.db?.query || parseStarFilter(filterText.value).isStar) return;
    if (filterText.value.trim() || lockFilter.value !== "all") return;
    tabPrefetchTimer = setTimeout(() => {
        tabPrefetchTimer = null;
        const activeIndex = PREFETCH_TABS.indexOf(activeType);
        const orderedTabs = activeIndex === -1
            ? [activeType]
            : [
                  PREFETCH_TABS[(activeIndex + 1) % PREFETCH_TABS.length],
                  PREFETCH_TABS[(activeIndex - 1 + PREFETCH_TABS.length) % PREFETCH_TABS.length],
              ];
        orderedTabs.forEach(prefetchTabPages);
    }, 180);
};

const updateShowList = (type, toTop = true) => {
    offset.value = 0;
    queryCursor.value = null;
    const parsed = parseStarFilter(filterText.value);

    if (window.db?.query && !parsed.isStar) {
        const cache = tabQueryCache.get(getQueryCacheKey(type));
        if (cache) {
            setShowListFromQueryResult(cache.result, cache.loadedCount);
        } else {
            const result = window.db.query(getQueryOptions(type, 0, GAP));
            setShowListFromQueryResult(result);
        }
        scheduleTabPrefetch(type);
    } else if (type === "collect") {
        const subTab = getCollectSubTab();
        let baseList =
            subTab === "*全部*"
                ? window.db.getCollects()
                : window.db.getCollectsByTag(subTab);
        baseList = applyCollectFilters(baseList, parsed);
        collectBlockList.value = [];
        showList.value = hydrateVisibleItems(baseList.slice(0, GAP));
        queryCursor.value = showList.value.length < baseList.length ? showList.value.length : null;
        currentQueryTotal.value = baseList.length;
    } else {
        const mainBase = getItemsByTab(type);
        if (parsed.isStar) {
            const collectMatches = window.db
                .getCollects()
                .filter((item) => matchLockFilter(item))
                .filter((item) => matchSearchableItemType(item, filterText.value, type))
                .filter((item) => tagMatch(item, parsed.tagKeyword))
                .filter((item) => bodyFilterCallBack(item, parsed.bodyKeyword));
            collectBlockList.value = hydrateVisibleItems(collectMatches.slice(0, COLLECT_BLOCK_CAP));
            const mainFiltered = mainBase
                .filter((item) => !window.db.isCollected(item.id))
                .filter((item) => matchMainTabItem(item, parsed.bodyKeyword, type));
            showList.value = hydrateVisibleItems(mainFiltered.slice(0, GAP));
            queryCursor.value = showList.value.length < mainFiltered.length ? showList.value.length : null;
            currentQueryTotal.value = mainFiltered.length + collectBlockList.value.length;
        } else {
            collectBlockList.value = [];
            const mainFiltered = mainBase
                .filter((item) => !window.db.isCollected(item.id))
                .filter((item) => matchLockFilter(item))
                .filter((item) => textFilterCallBack(item));
            showList.value = hydrateVisibleItems(mainFiltered.slice(0, GAP));
            queryCursor.value = showList.value.length < mainFiltered.length ? showList.value.length : null;
            currentQueryTotal.value = mainFiltered.length;
        }
    }
    if (toTop) {
        const shouldAutoTop = suppressAutoTopCount.value <= 0;
        if (!shouldAutoTop) suppressAutoTopCount.value -= 1;
        nextTick(() => {
            if (ClipItemListRef.value && shouldAutoTop) {
                setActiveIndex(0);
                syncActiveIndexVisibility(0, {
                    scrollMode: "edge-align",
                    edge: "start",
                    forceScroll: true,
                });
            }
        });
        if (shouldAutoTop) {
            window.toTop();
        }
    }
    persistLastActiveContext();
};

const getItemsByTab = (tabType) => {
    if (tabType === "collect") {
        const subTab = getCollectSubTab();
        if (subTab === "*全部*") return window.db.getCollects();
        return window.db.getCollectsByTag(subTab);
    }
    const data = window.db.dataBase.data || [];
    if (tabType === "all") return [...data];
    return data.filter((item) => item.type === tabType);
};

const filterItemsByRange = (items, rangeValue, options = {}) => {
    const duration = RANGE_DURATION_MAP[rangeValue];
    if (!duration) return [...items];
    const { preferCollectTime = false } = options;
    const cutoff = Date.now() - duration;
    return items.filter((item) => {
        const time = preferCollectTime
            ? item.collectTime || item.updateTime || item.createTime || 0
            : item.updateTime || item.collectTime || item.createTime || 0;
        return time >= cutoff;
    });
};

const measureOperation = (name, operation) => {
    const measureName = `ezclipboard:${name}`;
    const startMark = `${measureName}:start`;
    const endMark = `${measureName}:end`;
    globalThis.performance?.mark?.(startMark);
    const result = operation();
    globalThis.performance?.mark?.(endMark);
    globalThis.performance?.measure?.(measureName, startMark, endMark);
    return result;
};

const clearRegularTabItems = async (tabType, rangeValue) => {
    const candidates = filterItemsByRange(getItemsByTab(tabType), rangeValue);
    const removable = candidates.filter((item) => item.locked !== true);
    const skippedLocked = candidates.length - removable.length;
    let removed = 0;

    // 初始化进度
    clearProgress.value = {
        current: 0,
        total: candidates.length,
        percentage: 0
    };

    const removableIds = removable.map((item) => item.id);
    clearProgress.value = {
        current: removable.length,
        total: candidates.length,
        percentage: candidates.length ? (removable.length / candidates.length) * 100 : 100
    };
    const result = measureOperation("clear-regular-items", () =>
        window.db.removeItems
            ? window.db.removeItems(removableIds, { force: false })
            : { removed: 0 },
    );
    removed = result.removed || 0;

    if (removed) {
        removeVisibleItemsByIds(removableIds);
        scheduleDataRefresh();
        // 删除恢复已由 ClipItemList 统一处理，无需此处调整
        // adjustActiveIndexAfterDelete(0);
    }
    return { removed, skippedLocked };
};

const clearCollectTabItems = async (rangeValue, collectSubTab) => {
    const subTab = collectSubTab ?? getCollectSubTab();
    const baseItems =
        subTab === "*全部*"
            ? window.db.getCollects()
            : window.db.getCollectsByTag(subTab);
    const candidates = filterItemsByRange(baseItems, rangeValue, {
        preferCollectTime: true,
    });
    let removed = 0;
    let skippedLocked = 0;
    const removable = candidates.filter((item) => item.locked !== true);
    skippedLocked = candidates.length - removable.length;

    // 初始化进度
    clearProgress.value = {
        current: 0,
        total: candidates.length,
        percentage: 0
    };

    const removableIds = removable.map((item) => item.id);
    clearProgress.value = {
        current: removable.length,
        total: candidates.length,
        percentage: candidates.length ? (removable.length / candidates.length) * 100 : 100
    };
    const result = measureOperation("clear-collect-items", () =>
        window.db.removeCollects
            ? window.db.removeCollects(removableIds, false)
            : { removed: 0 },
    );
    removed = result.removed || 0;

    if (removed) {
        scheduleDataRefresh();
    }
    return { removed, skippedLocked };
};

const focusRangeButton = (rangeValue) => {
    nextTick(() => {
        const container = clearDialogBodyRef.value;
        const target = container?.querySelector(`[data-range="${rangeValue}"]`);
        target?.focus();
    });
};

const closeClearDialog = () => {
    isClearDialogVisible.value = false;
    clearRange.value = "1h";
    clearProgress.value = { current: 0, total: 0, percentage: 0 };
};

const progressFormat = () => {
    if (clearProgress.value.total === 0) return '0%';
    return `${Math.round((clearProgress.value.current / clearProgress.value.total) * 100)}%`;
};

const handleOpenCleanDialog = () => {
    clearRange.value = "1h";
    isClearDialogVisible.value = true;
    focusRangeButton(clearRange.value);
};

const handleClearConfirm = async () => {
    if (isClearing.value) return;
    isClearing.value = true;
    const tabType = activeTab.value;
    try {
        const { removed: removedCount, skippedLocked } =
            tabType === "collect"
                ? await clearCollectTabItems(clearRange.value, getCollectSubTab())
                : await clearRegularTabItems(tabType, clearRange.value);

        if (removedCount > 0) {
            ElMessage({
                type: "success",
                message:
                    skippedLocked > 0
                        ? `已清除 ${removedCount} 条记录，跳过锁定 ${skippedLocked} 条`
                        : `已清除 ${removedCount} 条记录`,
            });
            closeClearDialog();
        } else {
            ElMessage({
                type: "info",
                message:
                    skippedLocked > 0
                        ? `没有符合条件的记录（跳过锁定 ${skippedLocked} 条）`
                        : "没有符合条件的记录",
            });
        }
    } catch (error) {
        console.error("[handleClearConfirm] 清除失败:", error);
        ElMessage({
            type: "error",
            message: "清除失败，请稍后再试",
        });
    } finally {
        isClearing.value = false;
    }
};

// 标签编辑模态框函数
const openTagEditModal = (item) => {
    let target = item;
    // 优先使用收藏数据中的最新记录，保证包含 tags/remark
    if (window.db && item?.id) {
        const found =
            window.db.getById?.(item.id) ||
            window.db.filterDataBaseViaId?.(item.id)?.[0] ||
            window.db.dataBase?.collectData?.find((c) => c.id === item.id);
        if (found) {
            target = { ...found };
        }
    }
    if (!Array.isArray(target?.tags)) target.tags = [];
    if (typeof target?.remark !== "string") target.remark = "";

    tagEditItem.value = target;
    tagEditModalVisible.value = true;
};

const closeTagEditModal = () => {
    tagEditModalVisible.value = false;
    tagEditItem.value = null;
};

const handleTagEditSave = () => {
    handleDataRemove();
    updateShowList(activeTab.value, false);
};

const handleTagEditUncollect = () => {
    handleDataRemove();
};

// 标签搜索模态框函数
const openTagSearchModal = () => {
    tagSearchModalVisible.value = true;
};

const closeTagSearchModal = () => {
    tagSearchModalVisible.value = false;
};

const handleTagSelect = (tagName) => {
    if (!ClipSwitchRef.value) return;
    ClipSwitchRef.value.toggleNav("collect");
    ClipSwitchRef.value.setCollectSubTab(tagName);
    updateShowList("collect");
};

const fullData = ref({ type: "text", data: "" });
const fullDataShow = ref(false);
const toggleFullData = (item) => {
    // 是否显示全部数据 (查看全部)
    fullData.value = item;
    fullDataShow.value = !fullDataShow.value;
};

const ClipSwitchRef = ref();

const displayList = computed(() => {
    if (collectBlockList.value.length === 0) return showList.value;
    return [...collectBlockList.value, ...showList.value];
});

const currentShowList = computed(() => {
    const base =
        collectBlockList.value.length > 0 && activeTab.value !== "collect"
            ? displayList.value
            : showList.value;
    const composed = composeTopItems(base);
    return pinGroupListItem.value ? [pinGroupListItem.value, ...composed] : composed;
});

const getCurrentPinGroupType = () => activeTab.value || "all";

const resolvePinGroupItems = (group) => {
    list.value;
    collectVersion.value;
    const ids = group?.itemIds || [];
    if (!ids.length) return [];
    return resolvePinGroupItemsById(ids, {
        knownItems: getAllKnownItems(),
        getItemById: (id) => window.db?.getById?.(id) || window.db?.filterDataBaseViaId?.(id)?.[0] || null,
    });
};

const pinGroupItems = computed(() => {
    return resolvePinGroupItems(pinGroup.value);
});

const pinGroupListItem = computed(() => {
    const items = pinGroupItems.value;
    if (!items.length) return null;
    const previewLines = getPinGroupPreviewLines(items);
    return {
        id: "__ez_pin_group__",
        type: "text",
        data: `置顶组合 · ${items.length} 项 · Enter 一次性粘贴\n${previewLines
            .map((line) => (typeof line === "string" ? line : `${line.type ? `${line.type} ` : ""}${line.name}`))
            .join("\n")}`,
        updateTime: pinGroup.value?.updatedAt || Date.now(),
        createTime: pinGroup.value?.updatedAt || Date.now(),
        __pinGroup: true,
        __pinGroupPreviewLines: previewLines,
    };
});

const syncQuickPasteTopCache = () => {
    const context = getCurrentFilterContext();
    const items = getPinnedItemsForContext(context);
    if (!items.length) {
        clearQuickPasteTopCache();
        return;
    }
    setQuickPasteTopCache(items, { context });
};

const syncQuickPastePinGroupCache = (type = getCurrentPinGroupType(), options = {}) => {
    const state = getPinGroupState();
    const currentType = getCurrentPinGroupType();
    const targetTypes = options.all
        ? Object.keys(state.groups || {})
        : [type || currentType];

    targetTypes.forEach((targetType) => {
        const group = state.groups?.[targetType] || getPinGroup(targetType);
        if (!group?.itemIds?.length) {
            clearQuickPastePinGroupCache(targetType, { currentType });
            return;
        }
        setQuickPastePinGroupCache(resolvePinGroupItems(group), {
            type: targetType,
            currentType,
            operation: group.operation,
            itemIds: group.itemIds,
            cursor: group.cursor,
            updatedAt: group.updatedAt,
        });
    });
    syncQuickPasteTopCache();
};

const getDbVersion = () =>
    typeof window.db?.getVersion === "function" ? window.db.getVersion() : Date.now();

const removeVisibleItemsByIds = (ids = []) => {
    const idSet = new Set(ids.filter(Boolean));
    if (!idSet.size) return 0;
    pinnedMap.value = removePinnedItems([...idSet]);
    pinGroup.value = removePinGroupItems([...idSet], { type: getCurrentPinGroupType() });
    const beforeShowListLength = showList.value.length;
    showList.value = showList.value.filter((item) => !idSet.has(item.id));
    collectBlockList.value = collectBlockList.value.filter((item) => !idSet.has(item.id));
    syncQuickPastePinGroupCache(getCurrentPinGroupType(), { all: true });
    return beforeShowListLength - showList.value.length;
};

const handleTogglePin = (item) => {
    const result = togglePinnedItem(item);
    pinnedMap.value = result.map;
    syncQuickPasteTopCache();
    ElMessage({
        type: "success",
        message: result.pinned ? "已置顶选中项" : "已取消置顶",
    });
};

const openPinGroupEditor = (items = []) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) {
        ElMessage({ type: "info", message: "请先多选要组合的条目" });
        return;
    }
    pinGroupEditorItems.value = list;
    pinGroupEditorVisible.value = true;
};

const openExistingPinGroupEditor = () => {
    const items = pinGroupItems.value;
    if (!items.length) {
        ElMessage({ type: "info", message: "当前没有可编辑的置顶组合" });
        return;
    }
    openPinGroupEditor(items);
};

const closePinGroupEditor = () => {
    pinGroupEditorVisible.value = false;
};

const handlePinGroupSave = (items = []) => {
    const ids = items.map((item) => item?.id).filter((id) => id && id !== "__ez_pin_group__");
    const type = getCurrentPinGroupType();
    pinGroup.value = savePinGroup(ids, {
        type,
        cursor: 0,
        activeContext: getCurrentFilterContext(),
    });
    setQuickPastePinGroupCache(items, {
        type,
        currentType: type,
        itemIds: ids,
        cursor: pinGroup.value.cursor,
        updatedAt: pinGroup.value.updatedAt,
    });
    pinGroupEditorVisible.value = false;
    isMultiple.value = false;
    ClipItemListRef.value?.emptySelectItemList?.();
    ElMessage({ type: "success", message: `已保存 ${ids.length} 条置顶组合` });
};

const handlePinGroupClear = () => {
    const type = getCurrentPinGroupType();
    pinGroup.value = clearPinGroup(type);
    clearQuickPastePinGroupCache(type, { currentType: type });
    pinGroupEditorVisible.value = false;
    ElMessage({ type: "success", message: "已取消置顶组合" });
};

const pastePinGroupItem = (index) => {
    const item = pinGroupItems.value[index];
    if (!item) return false;
    const type = getCurrentPinGroupType();
    pinGroup.value = savePinGroup(pinGroup.value.itemIds, { type, cursor: index });
    syncQuickPastePinGroupCache(type);
    return copyAndPasteAndExit(item, { respectImageCopyGuard: true });
};

const pastePinGroupAll = () => {
    const items = pinGroupItems.value;
    if (!items.length) return false;
    if (items.length === 1) {
        return copyAndPasteAndExit(items[0], { respectImageCopyGuard: true });
    }
    const nonImageItems = items.filter((item) => item.type !== "image");
    if (!nonImageItems.length) {
        ElMessage({ type: "info", message: "多张图片无法合并粘贴，已粘贴组合首项" });
        return copyAndPasteAndExit(items[0], { respectImageCopyGuard: true });
    }
    const hasFile = nonImageItems.some((item) => item.type === "file");
    if (hasFile) {
        const filePathArray = [];
        nonImageItems.forEach((item) => {
            if (item.type === "text") {
                const textFile = window.createFile(item);
                filePathArray.push({ path: textFile });
            } else if (item.type === "file") {
                try {
                    const files = JSON.parse(item.data);
                    if (Array.isArray(files)) filePathArray.push(...files);
                } catch (_) {}
            }
        });
        if (!filePathArray.length) return false;
        return copyAndPasteAndExit(
            { type: "file", data: JSON.stringify(filePathArray) },
            { respectImageCopyGuard: true },
        );
    }
    const eol =
        (window?.exports && window.exports.os && window.exports.os.EOL) ||
        (navigator.userAgent.includes("Windows") ? "\r\n" : "\n");
    return copyAndPasteAndExit(
        { type: "text", data: nonImageItems.map((item) => item.data).join(eol) },
        { respectImageCopyGuard: true },
    );
};

const collectedIds = computed(() => {
    collectVersion.value;
    const list = window.db?.getCollects?.() ?? [];
    return new Set(list.map((i) => i.id));
});

const searchPlaceholder = computed(() => {
    if (activeTab.value === "collect") {
        const n = window.db?.getCollects?.()?.length ?? 0;
        return `在 ${n} 条收藏中检索正文、别名与分组标签，按 * 标签筛选`;
    }
    if (parseStarFilter(filterText.value).isStar)
        return "按 * 标签与正文筛选";
    return "";
});

const currentSearchItemCount = computed(() => {
    if (window.db?.query && !parseStarFilter(filterText.value).isStar) {
        return currentQueryTotal.value;
    }
    if (activeTab.value === "collect") {
        return getItemsByTab("collect").length;
    }
    return getItemsByTab(activeTab.value)
        .filter((item) => !window.db.isCollected(item.id))
        .length;
});

const loadMoreData = () => {
    if (isLoadingNextPage) return;
    if (window.db?.query && queryCursor.value != null && !parseStarFilter(filterText.value).isStar) {
        isLoadingNextPage = true;
        try {
            const result = window.db.query(getQueryOptions(activeTab.value, queryCursor.value, GAP));
            if (!result.items.length) {
                queryCursor.value = null;
                return;
            }
            showList.value = [...showList.value, ...hydrateVisibleItems(result.items)];
            queryCursor.value = result.nextCursor;
            currentQueryTotal.value = result.total;
            offset.value = showList.value.length;
            return;
        } finally {
            isLoadingNextPage = false;
        }
    }
    const parsed = parseStarFilter(filterText.value);
    const start = offset.value + GAP;
    let addition = [];
    if (activeTab.value === "collect") {
        const subTab = getCollectSubTab();
        let collectItems =
            subTab === "*全部*"
                ? window.db.getCollects()
                : window.db.getCollectsByTag(subTab);
        collectItems = applyCollectFilters(collectItems, parsed);
        addition = collectItems.slice(start, start + GAP);
    } else {
        const mainBase = getItemsByTab(activeTab.value);
        const mainFiltered = parsed.isStar
            ? mainBase.filter(
                  (item) =>
                      !window.db.isCollected(item.id) &&
                      matchMainTabItem(item, parsed.bodyKeyword),
              )
            : mainBase
                  .filter((item) => !window.db.isCollected(item.id))
                  .filter((item) => matchLockFilter(item))
                  .filter((item) => textFilterCallBack(item));
        addition = mainFiltered.slice(start, start + GAP);
    }
    if (!addition.length) {
        return;
    }
    offset.value += GAP;
    showList.value.push(...hydrateVisibleItems(addition));
};

const maybePrefetchNextPage = (visibleIndex = currentShowList.value.length - 1) => {
    if (queryCursor.value == null || isLoadingNextPage) return;
    const remaining = currentShowList.value.length - 1 - visibleIndex;
    if (remaining <= NEXT_PAGE_PREFETCH_THRESHOLD) {
        loadMoreData();
    }
};

const handleListLoadMore = (payload = {}) => {
    if (typeof payload?.index === "number") {
        maybePrefetchNextPage(payload.index);
        return;
    }
    loadMoreData();
};

const handleDataRemove = () => {
    tabQueryCache.clear();
    list.value = window.db.dataBase.data;
    offset.value = 0;
    collectVersion.value++;
    lastSyncedDbVersion = getDbVersion();
    const tab = ClipSwitchRef.value?.activeTab;
    const type = tab?.value ?? tab ?? activeTab.value;
    updateShowList(type, false);
};

const syncAfterVisibleDelete = (options = {}) => {
    const removedVisibleCount = Math.max(0, Number(options.removedVisibleCount) || 0);
    list.value = window.db.dataBase.data;
    collectVersion.value++;
    lastSyncedDbVersion = getDbVersion();
    const tab = ClipSwitchRef.value?.activeTab;
    const type = tab?.value ?? tab ?? activeTab.value;
    tabQueryCache.delete(getQueryCacheKey(type));
    if (removedVisibleCount > 0) {
        if (queryCursor.value != null) {
            queryCursor.value = rewindLoadedCursorAfterDelete(queryCursor.value, removedVisibleCount);
        }
        offset.value = rewindLoadedCursorAfterDelete(offset.value, removedVisibleCount);
    }
    loadMoreData();
};

const scheduleDataRefresh = () => {
    if (pendingDataRefresh) return;
    pendingDataRefresh = true;
    const run = () => {
        pendingDataRefresh = false;
        const version = getDbVersion();
        if (version === lastSyncedDbVersion) return;
        tabQueryCache.clear();
        handleDataRemove();
    };
    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(run);
    } else {
        setTimeout(run, 0);
    }
};

const suppressAutoTopCount = ref(0);

const getActiveIndex = () => {
    const ai = ClipItemListRef.value?.activeIndex;
    if (typeof ai === "number") return ai;
    return ai?.value ?? 0;
};

const setActiveIndex = (val) => {
    const ai = ClipItemListRef.value?.activeIndex;
    if (typeof ai === "number") {
        ClipItemListRef.value.activeIndex = val;
    } else if (ai && typeof ai === "object" && "value" in ai) {
        ai.value = val;
    }
};

const syncActiveIndexVisibility = (val, options = {}) => {
    ClipItemListRef.value?.syncActiveIndexVisibility?.(val, options);
};

const adjustActiveIndexAfterDelete = (baseIndex) => {
    nextTick(() => {
        if (!ClipItemListRef.value) return;
        const newListLength = currentShowList.value.length;
        if (newListLength === 0) return;
        const normalizedIndex = Math.min(
            Math.max(
                typeof baseIndex === "number" ? baseIndex : getActiveIndex(),
                0,
            ),
            newListLength - 1,
        );
        if (ClipItemListRef.value?.setKeyboardActiveIndex) {
            ClipItemListRef.value.setKeyboardActiveIndex(normalizedIndex, {
                block: "nearest",
            });
            return;
        }
        setActiveIndex(normalizedIndex);
    });
};

const resolveDeleteRecoveryPreferId = (list = [], anchorIndex = 0, removedIds = []) => {
    const ids = new Set(removedIds.filter(Boolean));
    const items = Array.isArray(list) ? list : [];
    const start = Math.min(Math.max(Number(anchorIndex) || 0, 0), Math.max(0, items.length - 1));
    for (let i = start; i < items.length; i++) {
        const id = items[i]?.id;
        if (id && !ids.has(id)) return id;
    }
    for (let i = start - 1; i >= 0; i--) {
        const id = items[i]?.id;
        if (id && !ids.has(id)) return id;
    }
    return null;
};

const handleItemDelete = (item, metadata = {}) => {
    const {
        anchorIndex,
        preferItemId,
        isBatch = false,
        isLast = true,
        force = false,
    } = metadata;
    const currentActiveIndex =
        typeof anchorIndex === "number" ? anchorIndex : getActiveIndex();
    
    // 处理删除操作，复用 useClipOperate 的逻辑
    const activeTabValue =
        typeof ClipSwitchRef.value?.activeTab === "object"
            ? ClipSwitchRef.value.activeTab.value
            : ClipSwitchRef.value?.activeTab || activeTab.value;
    const isCollected = window.db.isCollected(item.id);

    if (activeTabValue === "collect") {
        if (force) {
            window.db.removeCollect(item.id, false);
            if (isLast) {
                const ai = currentActiveIndex;
                const preferId = preferItemId ?? resolveDeleteRecoveryPreferId(
                    currentShowList.value,
                    ai,
                    [item.id],
                );
                ClipItemListRef.value?.prepareDeleteRecovery?.({
                    anchorIndex: ai,
                    preferItemId: preferId,
                });
                const removedVisibleCount = removeVisibleItemsByIds([item.id]);
                syncAfterVisibleDelete({ removedVisibleCount });
            }
            return;
        }
        // 在"收藏"标签页：不允许删除，只能取消收藏
        ElMessage({
            message: "收藏内容不允许删除，请先取消收藏",
            type: "warning",
        });
        return;
    } else if (isCollected) {
        // 在其他标签页删除已收藏项目：不允许删除（收藏数据单独存储）
        ElMessage({
            message: "已收藏项目不允许删除，请先取消收藏",
            type: "warning",
        });
        return;
    } else {
        // 在其他标签页删除未收藏项目：完全删除
        // 记录删除前的高亮索引，用于删除后调整位置
        suppressAutoTopCount.value = 2;
        window.remove(item, { force });
        if (isLast) {
            const removedVisibleCount = removeVisibleItemsByIds([item.id]);
            syncAfterVisibleDelete({ removedVisibleCount });
            // 删除恢复已由 ClipItemList 统一处理，无需此处调整
            // adjustActiveIndexAfterDelete(currentActiveIndex);
        }

        return;
    }
};

const handleItemsDelete = (items = [], metadata = {}) => {
    const { anchorIndex, preferItemId, force = false } = metadata;
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return;
    const activeTabValue =
        typeof ClipSwitchRef.value?.activeTab === "object"
            ? ClipSwitchRef.value.activeTab.value
            : ClipSwitchRef.value?.activeTab || activeTab.value;
    const ai = typeof anchorIndex === "number" ? anchorIndex : getActiveIndex();

    if (activeTabValue === "collect") {
        if (!force) {
            ElMessage({
                message: "收藏内容不允许删除，请先取消收藏",
                type: "warning",
            });
            return;
        }
        const result = window.db.removeCollects
            ? window.db.removeCollects(list.map((item) => item.id), false)
            : { removed: 0 };
        const removed = result.removed || 0;
        if (removed) {
            const removedIds = list.map((item) => item.id);
            const preferId = preferItemId ?? resolveDeleteRecoveryPreferId(
                currentShowList.value,
                ai,
                removedIds,
            );
            ClipItemListRef.value?.prepareDeleteRecovery?.({
                anchorIndex: ai,
                preferItemId: preferId,
            });
            const removedVisibleCount = removeVisibleItemsByIds(removedIds);
            syncAfterVisibleDelete({ removedVisibleCount });
        }
        return;
    }

    const candidates = force
        ? list
        : list.filter((item) => !window.db.isCollected(item.id));
    const skippedCollected = force ? 0 : list.length - candidates.length;
    suppressAutoTopCount.value = 2;
    const result = window.db.removeItems
        ? window.db.removeItems(candidates.map((item) => item.id), { force })
        : { removed: 0, skippedLocked: 0, skippedCollected: 0 };
    if (result.removed > 0) {
        const removedIds = candidates
            .filter((item) => force || !item.locked)
            .map((item) => item.id);
        const preferId = preferItemId ?? resolveDeleteRecoveryPreferId(
            currentShowList.value,
            ai,
            removedIds,
        );
        ClipItemListRef.value?.prepareDeleteRecovery?.({
            anchorIndex: ai,
            preferItemId: preferId,
        });
        const removedVisibleCount = removeVisibleItemsByIds(removedIds);
        syncAfterVisibleDelete({ removedVisibleCount });
    }
    const skipped = skippedCollected + (result.skippedLocked || 0) + (result.skippedCollected || 0);
    if (skipped > 0) {
        ElMessage({
            type: "info",
            message: `已跳过 ${skipped} 条不可删除记录`,
        });
    }
};

const emit = defineEmits(["showSetting"]);
const multiSelectTooltip = computed(() =>
    isMultiple.value ? formatShortcutDisplay("esc") : formatShortcutDisplay("space"),
);
const settingTooltip = computed(() => formatShortcutDisplay("c-a-s"));
const storageStatus = ref(getStorageRuntimeStatus());
const refreshStorageStatus = (event) => {
    storageStatus.value = event?.detail || getStorageRuntimeStatus();
};
const clearTooltip = computed(
    () =>
        [
            formatShortcutDisplay("s-del"),
            formatShortcutDisplay("s-backspace"),
        ].join(" / "),
);
const searchTooltip = computed(() => formatShortcutDisplay("c-f"));

const MAIN_TAB_STATE_KEY = "ui.main.activeTab";
const MAIN_COLLECT_SUB_TAB_STATE_KEY = "ui.main.collectSubTab";
const MAIN_TAB_TYPES = ["collect", "all", "text", "image", "file"];
const COLLECT_ALL_TAB = "*全部*";

const getUToolsRuntime = () => {
    if (typeof utools !== "undefined") return utools;
    return window?.utools || window?.exports?.utools || null;
};

const getPersistedUiState = (key, fallback) => {
    try {
        return getUToolsRuntime()?.dbStorage?.getItem?.(key) || fallback;
    } catch (_) {
        return fallback;
    }
};

const setPersistedUiState = (key, value) => {
    try {
        getUToolsRuntime()?.dbStorage?.setItem?.(key, value);
    } catch (_) {}
};

const getInitialMainTab = () => {
    const saved = getPersistedUiState(MAIN_TAB_STATE_KEY, "all");
    return MAIN_TAB_TYPES.includes(saved) ? saved : "all";
};

const activeTab = ref(getInitialMainTab());
pinGroup.value = getPinGroup(activeTab.value);
// 保存每个 tab 的状态（activeIndex）
const tabStateMap = ref(new Map());
const activeTabLabel = computed(() => {
    const tabs = ClipSwitchRef.value?.tabs || [];
    const baseName =
        tabs.find((tab) => tab.type === activeTab.value)?.name || "全部";
    if (activeTab.value === "collect") {
        const subTab = getCollectSubTab();
        return subTab === "*全部*" ? baseName : `${baseName} · ${subTab}`;
    }
    return baseName;
});
const isClearingCollectTab = computed(() => activeTab.value === "collect");

onMounted(() => {
    window.addEventListener(STORAGE_STATUS_EVENT, refreshStorageStatus);
    refreshStorageStatus();
    window.resetPluginUiState = resetPluginUiState;
    // 获取挂载的导航组件 Ref
    const toggleNav = ClipSwitchRef.value.toggleNav;
    const initialCollectSubTab = getPersistedUiState(MAIN_COLLECT_SUB_TAB_STATE_KEY, COLLECT_ALL_TAB);
    if (activeTab.value !== "all") {
        toggleNav(activeTab.value);
    }
    if (activeTab.value === "collect" && ClipSwitchRef.value?.setCollectSubTab) {
        const collectSubTabs = ClipSwitchRef.value.collectSubTabsList?.value ?? ClipSwitchRef.value.collectSubTabsList ?? [];
        const collectSubTypes = collectSubTabs.map((sub) => sub.type);
        ClipSwitchRef.value.setCollectSubTab(
            collectSubTypes.includes(initialCollectSubTab) ? initialCollectSubTab : COLLECT_ALL_TAB,
        );
    }

    watch(
        () => {
            const switchRef = ClipSwitchRef.value;
            if (!switchRef || !switchRef.activeTab) return "all";
            return switchRef.activeTab.value || switchRef.activeTab;
        },
        (newVal, oldVal) => {
            // 保存旧 tab 的状态
            if (oldVal && ClipItemListRef.value?.activeIndex !== undefined) {
                tabStateMap.value.set(oldVal, ClipItemListRef.value.activeIndex);
            }
            activeTab.value = newVal;
            if (MAIN_TAB_TYPES.includes(newVal)) {
                setPersistedUiState(MAIN_TAB_STATE_KEY, newVal);
            }
            pinGroup.value = getPinGroup(newVal);
            updateShowList(newVal);
            // 恢复新 tab 的状态
            nextTick(() => {
                const savedIndex = tabStateMap.value.get(newVal);
                if (savedIndex !== undefined && ClipItemListRef.value?.setKeyboardActiveIndex) {
                    // 检查 savedIndex 是否在有效范围内
                    const maxIndex = (ClipItemListRef.value?.activeIndex !== undefined) 
                        ? Math.max(0, Math.min(savedIndex, currentShowList.value.length - 1))
                        : 0;
                    if (currentShowList.value.length > 0 && maxIndex >= 0) {
                        ClipItemListRef.value.setKeyboardActiveIndex(maxIndex, { block: "center" });
                    }
                }
            });
        },
        { immediate: true },
    );
    watch(
        () => {
            const switchRef = ClipSwitchRef.value;
            if (!switchRef || activeTab.value !== "collect") return null;
            const sub = switchRef.collectSubTab;
            return sub?.value ?? sub;
        },
        (newVal, oldVal) => {
            if (activeTab.value === "collect") {
                tabQueryCache.clear();
                setPersistedUiState(MAIN_COLLECT_SUB_TAB_STATE_KEY, newVal || COLLECT_ALL_TAB);
                // 保存旧收藏子 tab 的状态
                if (oldVal && ClipItemListRef.value?.activeIndex !== undefined) {
                    const key = `collect-${oldVal}`;
                    tabStateMap.value.set(key, ClipItemListRef.value.activeIndex);
                }
                updateShowList("collect", false);
                // 恢复新收藏子 tab 的状态
                nextTick(() => {
                    const key = `collect-${newVal}`;
                    const savedIndex = tabStateMap.value.get(key);
                    if (savedIndex !== undefined && ClipItemListRef.value?.setKeyboardActiveIndex) {
                        // 检查 savedIndex 是否在有效范围内
                        const maxIndex = Math.max(0, Math.min(savedIndex, currentShowList.value.length - 1));
                        if (currentShowList.value.length > 0 && maxIndex >= 0) {
                            ClipItemListRef.value.setKeyboardActiveIndex(maxIndex, { block: "center" });
                        }
                    }
                });
            }
        },
    );

    // 多选已选择的条数（用 watch 更新，避免 computed 赋给 ref 导致运行时 null 引用）
    watch(
        () => ClipItemListRef.value?.selectItemList?.length ?? 0,
        (len) => {
            selectCount.value = len;
        },
        { immediate: true },
    );

    // 初始化数据
    list.value = window.db.dataBase.data;
    showList.value = list.value.slice(0, GAP); // 最初展示 10条
    updateShowList(activeTab.value);
    syncQuickPastePinGroupCache(activeTab.value, { all: true });

    // 定期检查更新
    if (window.listener.listening) {
        // 监听器开启时
        window.listener.on("change", () => {
            list.value = window.db.dataBase.data;
            updateShowList(activeTab.value);
        });
    } else {
        // 监听器启动失败时
        let prev = {};
        setInterval(() => {
            const now = window.db.dataBase.data[0];
            if (prev?.id === now?.id) {
            } else {
                // 有更新
                list.value = window.db.dataBase.data;
                updateShowList(activeTab.value);
                prev = now;
            }
        }, 800);
    }

    // 接收来自外部的触发视图更新事件
    // 进程虽然没有启动 但是可以接收emit
    window.listener.on("view-change", () => {
        // 检查到change事件 更新展示数据
        list.value = window.db.dataBase.data;
        updateShowList(activeTab.value, false);
    });

    // 监听搜索与筛选
    watch([filterText, lockFilter], () => {
        tabQueryCache.clear();
        updateShowList(activeTab.value);
    });

    // 展示通知
    if (notifyShown.value) {
        ElMessageBox.alert(notify.content, notify.title, {
            confirmButtonText: "确定",
            dangerouslyUseHTMLString: true,
            callback: () => {
                utools.dbStorage.setItem("notify", {
                    title: notify.title,
                    content: notify.content,
                    version: notify.version,
                });
            },
        });
    }

    // 列表懒加载已由 ClipItemList 的 .clip-item-scroll @scroll 触底后 emit loadMore 承担；
    // document 不再滚动，原 document 级 scroll 监听恒不触发，已移除。

    const isOtherEditableTarget = (target) => {
        if (!target || typeof target.closest !== "function") return false;
        if (target.isContentEditable) return true;
        const el = target.closest(
            'input, textarea, [contenteditable="true"]',
        );
        if (!el) return false;
        return !el.classList?.contains("clip-search-input");
    };

    // 捕获阶段：在到达原 target 之前把焦点交给搜索框，浏览器才能把本次按键的 beforeinput/IME 落到输入框上（document 冒泡里再 focus 会来不及）。
    // 勿 preventDefault。热键仍由后续 HotkeyProvider 捕获链处理。
    const keyDownCallBack = (e) => {
        if (e.__hotkeyHandled) return;
        const { key, ctrlKey, metaKey, altKey } = e;
        const isPlainTextInput =
            key.length === 1 && !ctrlKey && !metaKey && !altKey && key !== " ";
        if (isPlainTextInput) {
            if (e.isComposing || e.key === "Process") return;
            if (!isSearchPanelExpand.value && !isMultiple.value) {
                if (getCurrentLayer()) return;
                if (isOtherEditableTarget(e.target)) return;
                const wrap = document.querySelector(".clip-search");
                if (wrap) wrap.style.display = "";
                isSearchPanelExpand.value = true;
                revealFromKeyAt.value = Date.now();
                revealOpeningKey.value = key;
                window.focus?.();
                const input = document.querySelector(".clip-search-input");
                if (input) input.focus();
                return;
            }
            if (isSearchPanelExpand.value) {
                const t = e.target;
                if (
                    t &&
                    (t.classList?.contains("clip-search-input") ||
                        t.closest?.(".clip-search"))
                )
                    return;
            }
            window.focus();
        }
    };

    document.addEventListener("keydown", keyDownCallBack, true);

    // Register hotkey features (main, clear-dialog, search)
    const registerMainHotkeyFeatures = () => {
        const switchRef = ClipSwitchRef.value;
        if (!switchRef) return;
        const toggleNav = switchRef.toggleNav;
        const tabs = switchRef.tabs || [];
        const tabTypes = tabs.map((t) => t.type);

        const handleClearDialogCloseCommand = () => {
            closeClearDialog();
            return true;
        };
        const handleClearDialogConfirmCommand = () => {
            handleClearConfirm();
            return true;
        };
        const createClearDialogRangeCommand = (range) => () => {
            clearRange.value = range;
            focusRangeButton(range);
            return true;
        };
        const handleClearDialogArrowNavCommand = (e) => {
            const arrowMap = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -CLEAR_GRID_COLS, ArrowDown: CLEAR_GRID_COLS };
            const delta = arrowMap[e.key];
            if (delta === undefined) return false;
            const idx = CLEAR_RANGE_OPTIONS.findIndex((o) => o.value === clearRange.value);
            const next = idx + delta;
            if (next >= 0 && next < CLEAR_RANGE_OPTIONS.length) {
                clearRange.value = CLEAR_RANGE_OPTIONS[next].value;
                focusRangeButton(CLEAR_RANGE_OPTIONS[next].value);
            }
            return true;
        };
        const handleClearDialogTabCommand = (e) => {
            const focusable = getClearDialogFocusables();
            if (!focusable.length) return false;
            const active = document.activeElement;
            let idx = focusable.indexOf(active);
            if (idx === -1) idx = 0;
            idx =
                (idx + (e.shiftKey ? -1 : 1) + focusable.length) %
                focusable.length;
            focusable[idx].focus();
            const focused = focusable[idx];
            if (focused.classList.contains("range-button")) {
                const r = focused.getAttribute("data-range");
                if (r) {
                    clearRange.value = r;
                }
            }
            return true;
        };
        const handleClearDialogBlockCommand = () => true;
        registerCommandFeaturePairs([
            { featureId: "clear-dialog-close", commandId: "dialog.clear.close", handler: handleClearDialogCloseCommand },
            { featureId: "clear-dialog-range-1h", commandId: "dialog.clear.range.1h", handler: createClearDialogRangeCommand("1h") },
            { featureId: "clear-dialog-range-5h", commandId: "dialog.clear.range.5h", handler: createClearDialogRangeCommand("5h") },
            { featureId: "clear-dialog-range-8h", commandId: "dialog.clear.range.8h", handler: createClearDialogRangeCommand("8h") },
            { featureId: "clear-dialog-range-24h", commandId: "dialog.clear.range.24h", handler: createClearDialogRangeCommand("24h") },
            { featureId: "clear-dialog-range-7d", commandId: "dialog.clear.range.7d", handler: createClearDialogRangeCommand("7d") },
            { featureId: "clear-dialog-range-all", commandId: "dialog.clear.range.all", handler: createClearDialogRangeCommand("all") },
            { featureId: "clear-dialog-arrow-nav", commandId: "dialog.clear.range.navigate", handler: handleClearDialogArrowNavCommand },
            { featureId: "clear-dialog-tab", commandId: "dialog.clear.focus.next", handler: handleClearDialogTabCommand },
            { featureId: "clear-dialog-confirm", commandId: "dialog.clear.confirm", handler: handleClearDialogConfirmCommand },
            { featureId: "clear-dialog-block", commandId: "dialog.clear.blockUnhandled", handler: handleClearDialogBlockCommand }
        ]);

        const handleMainTabCommand = (e) => {
            const index = tabTypes.indexOf(activeTab.value);
            const target = e.shiftKey
                ? index <= 0
                    ? tabTypes[tabTypes.length - 1]
                    : tabTypes[index - 1]
                : index >= tabTypes.length - 1
                  ? tabTypes[0]
                  : tabTypes[index + 1];
            toggleNav(target);
            return true;
        };
        const switchMainTabByOffset = (delta) => {
            if (isSearchPanelExpand.value) return false;
            const index = tabTypes.indexOf(activeTab.value);
            if (index === -1 || tabTypes.length === 0) return false;
            const nextIndex = (index + delta + tabTypes.length) % tabTypes.length;
            const target = tabTypes[nextIndex];
            toggleNav(target);
            return true;
        };
        const handleMainTabPrevCommand = () => switchMainTabByOffset(-1);
        const handleMainTabNextCommand = () => switchMainTabByOffset(1);
        const handleCollectSubTabNextCommand = () => {
            if (activeTab.value !== "collect") return false;
            const list =
                switchRef.collectSubTabsList?.value ??
                switchRef.collectSubTabsList ??
                [];
            if (list.length === 0) return false;
            const current =
                switchRef.collectSubTab?.value ??
                switchRef.collectSubTab ??
                "*全部*";
            const idx = list.findIndex((s) => s.type === current);
            const nextIdx = idx < 0 ? 0 : (idx + 1) % list.length;
            switchRef.setCollectSubTab(list[nextIdx].type);
            return true;
        };
        const handleCollectSubTabPrevCommand = () => {
            if (activeTab.value !== "collect") return false;
            const list =
                switchRef.collectSubTabsList?.value ??
                switchRef.collectSubTabsList ??
                [];
            if (list.length === 0) return false;
            const current =
                switchRef.collectSubTab?.value ??
                switchRef.collectSubTab ??
                "*全部*";
            const idx = list.findIndex((s) => s.type === current);
            const prevIdx = idx <= 0 ? list.length - 1 : idx - 1;
            switchRef.setCollectSubTab(list[prevIdx].type);
            return true;
        };
        const handleMainFocusSearchCommand = () => {
            if (!isSearchPanelExpand.value) isSearchPanelExpand.value = true;
            focusSearchInput();
            return true;
        };
        const handleMainOpenSettingCommand = () => {
            emit("showSetting");
            return true;
        };
        const handleMainToggleLockedSearchCommand = () => {
            lockFilter.value =
                lockFilter.value === "locked" ? "all" : "locked";
            if (!isSearchPanelExpand.value) {
                isSearchPanelExpand.value = true;
            }
            focusSearchInput(filterText.value);
            return true;
        };
        const mainCommandPairs = [
            { featureId: "main-tab", commandId: "main.tab.next", handler: handleMainTabCommand },
            { featureId: "main-tab-prev", commandId: "main.tab.prev", handler: handleMainTabPrevCommand },
            { featureId: "main-tab-next", commandId: "main.tab.nextExplicit", handler: handleMainTabNextCommand },
            { featureId: "collect-sub-tab-next", commandId: "main.collectSubTab.next", handler: handleCollectSubTabNextCommand },
            { featureId: "collect-sub-tab-prev", commandId: "main.collectSubTab.prev", handler: handleCollectSubTabPrevCommand },
            { featureId: "main-focus-search", commandId: "search.focus", handler: handleMainFocusSearchCommand },
            { featureId: "main-open-setting", commandId: "main.setting.open", handler: handleMainOpenSettingCommand },
            { featureId: "main-toggle-locked-search", commandId: "search.locked.toggle", handler: handleMainToggleLockedSearchCommand }
        ];
        for (let i = 1; i <= 9; i++) {
            const n = i;
            mainCommandPairs.push({
                featureId: `main-alt-tab-${n}`,
                commandId: `main.tab.${n}`,
                handler: () => {
                    const target = tabTypes[Math.min(n - 1, tabTypes.length - 1)];
                    if (target) {
                        toggleNav(target);
                        return true;
                    }
                    return false;
                }
            });
        }
        mainCommandPairs.push({
            featureId: "open-clear-dialog",
            commandId: "dialog.clear.open",
            handler: () => {
                handleOpenCleanDialog();
                return true;
            }
        });
        mainCommandPairs.push({
            featureId: "tag-search",
            commandId: "tag.search.open",
            handler: () => {
                openTagSearchModal();
                return true;
            }
        });
        mainCommandPairs.push({
            featureId: "pin-group-open",
            commandId: "pin.group.open",
            handler: () => {
                const current = ClipItemListRef.value?.activeIndex !== undefined
                    ? currentShowList.value[ClipItemListRef.value.activeIndex]
                    : null;
                if (current?.__pinGroup) {
                    handlePinGroupClear();
                    return true;
                }
                if (!isMultiple.value) {
                    ElMessage({ type: "info", message: "请先进入多选并选择组合条目" });
                    return true;
                }
                openPinGroupEditor(ClipItemListRef.value?.selectItemList || []);
                return true;
            }
        });
        mainCommandPairs.push({
            featureId: "main-escape",
            commandId: "main.escape",
            handler: (e) => {
                const aliasDialogCancelButton = document.querySelector(
                    ".el-overlay .el-message-box .el-message-box__btns .el-button:not(.el-button--primary)",
                );
                if (aliasDialogCancelButton) {
                    aliasDialogCancelButton.click();
                    return true;
                }
                if (filterText.value) {
                    filterText.value = "";
                    window.focus();
                    return true;
                }
                if (lockFilter.value !== "all") {
                    lockFilter.value = "all";
                    window.focus();
                    return true;
                }
                if (isSearchPanelExpand.value) {
                    window.focus(true);
                    return true;
                }
                if (isMultiple.value) {
                    isMultiple.value = false;
                    return true;
                }
                return false;
            }
        });
        mainCommandPairs.push({
            featureId: "search-delete-normal",
            commandId: "search.results.delete",
            handler: () => {
                if (!filterText.value.trim()) return false;
                const candidates = displayList.value.filter((item) =>
                    textFilterCallBack(item),
                );
                if (!candidates.length) {
                    ElMessage({ message: "没有符合条件的搜索结果", type: "info" });
                    return true;
                }
                const removable = candidates.filter((item) => item.locked !== true);
                const skippedLocked = candidates.length - removable.length;
                const result = window.db.removeItems
                    ? window.db.removeItems(removable.map((item) => item.id), { force: false })
                    : { removed: 0 };
                const removed = result.removed || 0;
                if (removed > 0) {
                    const ai = getActiveIndex();
                    const preferId = currentShowList.value[ai]?.id;
                    ClipItemListRef.value?.prepareDeleteRecovery?.({
                        anchorIndex: ai,
                        preferItemId: preferId,
                    });
                    const removedVisibleCount = removeVisibleItemsByIds(removable.map((item) => item.id));
                    syncAfterVisibleDelete({ removedVisibleCount });
                    ElMessage({
                        type: "success",
                        message:
                            skippedLocked > 0
                                ? `已删除 ${removed} 条搜索结果，跳过锁定 ${skippedLocked} 条`
                                : `已删除 ${removed} 条搜索结果`,
                    });
                } else {
                    ElMessage({
                        message:
                            skippedLocked > 0
                                ? `没有可删除的条目（跳过锁定 ${skippedLocked} 条）`
                                : "没有可删除的条目",
                        type: "info",
                    });
                }
                return true;
            }
        });
        mainCommandPairs.push({
            featureId: "search-delete-force",
            commandId: "search.results.forceDelete",
            handler: () => {
                if (!filterText.value.trim()) return false;
                const candidates = displayList.value.filter((item) =>
                    textFilterCallBack(item),
                );
                if (!candidates.length) {
                    ElMessage({ message: "没有符合条件的搜索结果", type: "info" });
                    return true;
                }
                const result = window.db.removeItems
                    ? window.db.removeItems(candidates.map((item) => item.id), { force: true })
                    : { removed: 0 };
                const removed = result.removed || 0;
                if (removed > 0) {
                    const ai = getActiveIndex();
                    const preferId = currentShowList.value[ai]?.id;
                    ClipItemListRef.value?.prepareDeleteRecovery?.({
                        anchorIndex: ai,
                        preferItemId: preferId,
                    });
                    const removedVisibleCount = removeVisibleItemsByIds(candidates.map((item) => item.id));
                    syncAfterVisibleDelete({ removedVisibleCount });
                    ElMessage({
                        type: "success",
                        message: `已强制删除 ${removed} 条搜索结果`,
                    });
                }
                return true;
            }
        });
        registerCommandFeaturePairs(mainCommandPairs);
    };
    nextTick(() => registerMainHotkeyFeatures());

onUnmounted(() => {
    persistLastActiveContext();
    window.removeEventListener(STORAGE_STATUS_EVENT, refreshStorageStatus);
    if (tabPrefetchTimer) {
        clearTimeout(tabPrefetchTimer);
        tabPrefetchTimer = null;
    }
    delete window.resetPluginUiState;
        document.removeEventListener("keydown", keyDownCallBack, true);
    });
});
</script>

<style lang="less" scoped>
@import "../style";
/* 主视图撑满视口并作为纵向 flex 容器：列表区因此拿到确定高度，滚动发生在 .clip-item-scroll 内而非 document。 */
.main {
    height: 100%;
    display: flex;
    flex-direction: column;
}
/* 为 fixed 顶栏预留纵向空间；须盖住单行·双行布局，避免过小重叠或过大空隙 */
/* flex: none 必须保留：.main 变为纵向 flex 后，空占位块默认可收缩到 0，顶栏会压住首行 */
.clip-break {
    flex: none;
    height: 52px;
}
.clip-setting-btn {
    position: relative;
}
.clip-setting-btn.has-storage-notice::after {
    content: "";
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e5484d;
    box-shadow: 0 0 0 2px #fff;
}
/* 收藏 Tab + 子标签第二行：在单行基础上约 +30px，与无子栏收窄风格一致 */
.clip-break--with-sub {
    height: 82px;
}
.clip-empty-status {
    width: calc(100% - 24px);
    min-height: calc(100vh - 104px);
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 8px 12px 0;
    border: 1px dashed var(--border-color-strong);
    border-radius: 20px;
    background: var(--bg-elevated-color);
    color: var(--text-color-lighter);
    opacity: 0.84;
    letter-spacing: 0.08em;
}

.clear-panel-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay-color);
    backdrop-filter: blur(4px);
    z-index: 180;
}

.clear-panel {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 360px;
    background: var(--bg-elevated-color);
    border-right: 1px solid var(--border-color);
    box-shadow: 18px 0 36px var(--shadow-color);
    z-index: 190;
    display: flex;
    flex-direction: column;
    padding: 22px 20px 18px;
    border-top-right-radius: 16px;
    border-bottom-right-radius: 16px;
    backdrop-filter: blur(18px);
}

.clear-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text-color);
    }
    .clear-panel-sub {
        display: block;
        margin-top: 2px;
        font-size: 13px;
        color: var(--text-color-lighter);
    }
}

.clear-panel-close {
    border: none;
    background: var(--bg-soft-color);
    border-radius: 999px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    color: var(--text-color-lighter);
    transition: all 0.18s ease;
    &:hover {
        color: var(--text-color);
        background: var(--nav-hover-bg-color);
    }
}

.clear-panel-body {
    margin-top: 18px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    .clear-panel-tip {
        margin-bottom: 12px;
        color: var(--text-color-lighter);
        font-size: 13px;
        line-height: 1.5;
    }
}

.clear-range-group {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(120px, 1fr));
    gap: 10px;
}

.clear-progress {
    width: 100%;
    padding: 16px;
    background: var(--bg-soft-color);
    border-radius: 12px;
    
    .clear-progress-text {
        margin-top: 12px;
        text-align: center;
        color: var(--text-color-lighter);
        font-size: 13px;
    }
}

.range-button {
    width: 100%;
    text-align: center;
    border: 1px solid var(--border-color);
    border-radius: 12px !important;
    background: var(--bg-soft-color);
    color: var(--text-color-lighter);
    box-shadow: 0 8px 18px var(--shadow-color);
    transition: all 0.2s ease;
    cursor: pointer;
    outline: none;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 500;
    position: relative;

    span {
        position: relative;
        z-index: 1;
    }

    &:hover {
        background: var(--nav-hover-bg-color);
        color: var(--text-color);
        transform: translateY(-1px);
        border-color: var(--border-color-strong);
        box-shadow: 0 12px 20px var(--shadow-color);
    }

    &:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(53, 95, 157, 0.12);
    }

    &.active {
        background: rgba(53, 95, 157, 0.14);
        color: var(--primary-color);
        font-weight: 600;
        transform: translateY(-1px);
        border-color: rgba(53, 95, 157, 0.34);
        box-shadow: 0 12px 24px rgba(53, 95, 157, 0.16);

        &:hover {
            background: rgba(53, 95, 157, 0.18);
            transform: translateY(-1px);
            box-shadow: 0 14px 26px rgba(53, 95, 157, 0.18);
        }
    }

    &:active {
        transform: translateY(0) scale(0.98);
        transition: transform 0.1s ease;
    }
}

.clear-panel-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
}

.clear-panel :focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
    border-radius: 8px;
}

.clear-panel-enter-active,
.clear-panel-leave-active {
    transition:
        transform 0.2s ease,
        opacity 0.2s ease;
}
.clear-panel-enter-from,
.clear-panel-leave-to {
    transform: translateX(-40px);
    opacity: 0;
}

@media (max-width: 900px) {
    .clip-break {
        height: 60px;
    }
    .clip-break--with-sub {
        height: 90px;
    }
}

@media (max-width: 720px) {
    .clip-break {
        height: 96px;
    }
    .clip-break--with-sub {
        height: 128px;
    }
    .clip-empty-status {
        min-height: calc(100vh - 180px);
    }
    .clear-panel {
        width: min(360px, calc(100vw - 16px));
    }
}
</style>
