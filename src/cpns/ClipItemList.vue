<template>
    <div
        class="clip-item-list"
        ref="listRootRef"
        @mousemove.passive="handleListMouseMove"
        :class="{ 'few-items': showList.length <= 3 }"
        role="listbox"
    >
        <div
            ref="scrollParentRef"
            class="scroller clip-item-scroll"
            @scroll.passive="handleVirtualScroll"
        >
            <div class="clip-item-list-body">
                <div
                    v-for="(item, index) in showList"
                        :key="`${item?.id ?? index}-${lockedRenderVersion}`"
                    class="clip-item-list-row"
                    :class="{
                        'clip-item-list-row--compact': showList.length <= 3,
                    }"
                    :data-index="index"
                >
                    <ClipItemRow
                        v-if="item"
                        :item="item"
                        :index="index"
                        :is-multiple="isMultiple"
                        :is-active="activeIndex === index"
                        :is-selected="selectedItemIdSet.has(item.id)"
                        :is-collected="isItemCollected(item)"
                        :is-pinned="isItemPinned(item)"
                        :show-operate="!isMultiple && activeIndex === index"
                        :current-active-tab="currentActiveTab"
                        :is-over-sized-content="isOverSizedContent"
                        :is-previewable-text="isPreviewableTextItem(item)"
                        :item-alias="getItemAlias(item)"
                        :get-item-image-src="getItemImageSrc"
                        :has-image-files="hasImageFiles"
                        :get-image-files="getImageFiles"
                        :to-file-url="toFileUrl"
                        :show-image-file-preview="showImageFilePreview"
                        @row-click-left="handleItemClick($event, item)"
                        @row-click-right="handleItemClick($event, item)"
                        @row-mouseenter="handleMouseOver($event, index, item)"
                        @row-mouseleave="handleRowMouseLeave(index)"
                        @row-data-change="emit('onDataChange', item)"
                        @row-data-remove="emit('onDataRemove')"
                        @row-open-tag-edit="openTagEditModal"
                        @row-image-click="handleImageClick($event, item)"
                    />
                </div>
            </div>
        </div>
        <div v-if="showList.length === 0" class="empty-placeholder">暂无数据</div>
    </div>

    <!-- Custom Image Preview -->
    <Teleport to="body">
        <div
            v-if="imagePreview.show"
            class="image-preview-modal"
            :style="imagePreview.style"
            @mouseenter="keepImagePreview"
            @mouseleave="hideImagePreview"
            @keydown="handleImagePreviewKeydown"
            tabindex="0"
        >
            <div 
                class="image-preview-content"
                ref="imagePreviewContentRef"
                :style="imagePreview.scrollStyle"
                @scroll="handleImagePreviewScroll"
            >
                <div
                    v-if="isPreviewableImageSrc(imagePreview.src) && !imagePreview.loadFailed"
                    class="image-preview-inner"
                    :class="{
                        'is-centered': imagePreview.layoutMode === 'centered',
                        'is-scroll': imagePreview.layoutMode !== 'centered',
                        'is-fit-width-scroll': imagePreview.layoutMode === 'fit-width-scroll',
                        'is-fit-height-scroll': imagePreview.layoutMode === 'fit-height-scroll',
                        'is-small-image': imagePreview.isSmallImage,
                    }"
                    :style="imagePreview.contentStyle"
                >
                    <img
                        :src="imagePreview.src"
                        :style="imagePreview.imageStyle"
                        @error="handleImageError"
                        @load="handleImageLoad"
                    />
                </div>
                <div v-else class="preview-error">
                    <span>图片加载失败</span>
                </div>
            </div>
            <div
                v-if="imagePreview.footer"
                class="image-preview-footer"
            >
                <div class="image-preview-footer-main">
                    {{ imagePreview.footer }}
                </div>
            </div>
        </div>
        <div
            v-if="imagePreview.show && imagePreview.hint"
            class="image-preview-toolbar-hint"
        >
            {{ imagePreview.hint }}
        </div>
    </Teleport>

    <!-- Rich File Preview (Shift hold) -->
    <Teleport to="body">
        <div
            v-if="filePreview.show"
            class="file-preview-modal"
            :style="filePreview.style"
            @mouseenter="keepFilePreview"
            @mouseleave="hideFilePreview"
            tabindex="0"
        >
            <FileRichPreview
                ref="fileRichPreviewRef"
                :file="filePreview.file"
                mode="hover"
            />
        </div>
        <div
            v-if="filePreview.show && filePreview.hint"
            class="image-preview-toolbar-hint"
        >
            {{ filePreview.hint }}
        </div>
    </Teleport>

    <!-- Long Text Preview (Shift hold) -->
    <div
        v-if="textPreview.show"
        class="text-preview-modal"
        @mouseenter="keepTextPreview"
        @mouseleave="hideTextPreview"
    >
        <div
            class="text-preview-panel"
            :class="{ 'is-wrap-text': textPreview.wrapText }"
            :style="textPreview.panelStyle"
        >
            <div
                class="text-preview-content"
                :class="{
                    'is-wrap-text': textPreview.wrapText,
                    'is-table': textPreview.preview.kind === 'csv',
                    'is-structured': textPreview.preview.kind === 'structured',
                    'is-html': textPreview.preview.kind === 'html',
                }"
                :style="textPreview.contentStyle"
                ref="textPreviewContentRef"
            >
                <template v-if="textPreview.preview.kind === 'csv'">
                    <div class="text-preview-sheet">CSV · {{ textPreview.preview.table.totalRows }} rows</div>
                    <table class="text-preview-table">
                        <tbody>
                            <tr v-for="(row, rowIndex) in textPreview.preview.table.rows" :key="rowIndex">
                                <td v-for="(cell, cellIndex) in row" :key="`${rowIndex}-${cellIndex}`">
                                    {{ cell }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div
                        v-if="textPreview.preview.table.truncatedRows || textPreview.preview.table.truncatedCols"
                        class="text-preview-note"
                    >
                        已截取预览
                    </div>
                </template>
                <template v-else-if="textPreview.preview.kind === 'structured'">
                    <div class="text-preview-sheet">
                        {{ textPreview.preview.format }}
                        <span v-if="textPreview.preview.structured.nodeCount">
                            · {{ textPreview.preview.structured.nodeCount }} nodes
                        </span>
                    </div>
                    <div class="text-preview-structured-tree">
                        <div
                            v-for="node in textPreview.preview.structured.nodes"
                            :key="node.id"
                            class="text-preview-structured-row"
                            :class="[`is-${node.type}`, { 'is-container': node.isContainer }]"
                            :style="{ '--depth': node.depth }"
                        >
                            <span v-if="node.key" class="text-preview-structured-key">{{ node.key }}</span>
                            <span v-if="node.key" class="text-preview-structured-colon">:</span>
                            <span class="text-preview-structured-value">{{ node.value }}</span>
                        </div>
                    </div>
                    <div
                        v-if="textPreview.preview.structured.truncated"
                        class="text-preview-note"
                    >
                        已截取预览
                    </div>
                </template>
                <div
                    v-else-if="textPreview.preview.kind === 'html'"
                    class="text-preview-html"
                    v-html="textPreview.preview.html"
                ></div>
                <template v-else>{{ textPreview.text }}</template>
            </div>
        </div>
    </div>

    <ClipDrawerMenu
        :show="drawerShow"
        :items="drawerItems"
        :position="drawerPosition"
        :defaultActive="drawerDefaultActive"
        :placement="drawerPlacement"
        @select="handleDrawerSelect"
        @close="closeDrawer"
    />
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ClipItemRow from "./ClipItemRow.vue";
import ClipDrawerMenu from "./ClipDrawerMenu.vue";
import FileRichPreview from "./FileRichPreview.vue";
import {
    isUToolsPlugin,
    copyOnly,
    copyAndPasteAndExit,
    copySingleFileWithAliasAndPaste,
    copyImageWithAliasAndPaste,
    removeAliasMaterialForItem,
    ITEM_ALIAS_STORAGE_KEY as ITEM_ALIAS_DB_KEY,
} from "../utils";
import defaultOperation from "../data/operation.json";
import setting, {
    getHoverPreviewConfig,
    SETTING_UPDATED_EVENT,
} from "../global/readSetting";
import useClipOperate from "../hooks/useClipOperate";
import { useListNavigation } from "../hooks/useListNavigation";
import { useVirtualListScroll } from "../hooks/useVirtualListScroll";
import {
    buildDeleteEventMeta,
    computeDeleteAnchorMeta,
} from "../utils/deleteAnchor.mjs";
import { desktopPreviewManager } from "../global/desktopPreview";
import { registerCommandFeaturePairs } from "../global/hotkeyRegistry";
import { formatShortcutDisplay } from "../global/shortcutKey";
import {
    ALIAS_CONTEXT_MENU_ACTION_ID,
    buildDrawerMenuItems,
    getContextMenuActionByIndex,
} from "../global/contextMenuActions";
import {
    computeImagePreviewLayout,
    getTextPreviewMode,
} from "../utils/previewLayout.mjs";
import {
    getPreviewableFile,
    parseFileItemData,
} from "../utils/filePreview.mjs";
import {
    buildDetectedTextDocumentPreview,
    createEmptyTextDocumentPreview,
} from "../utils/textDocumentPreview.mjs";
import {
    getPreviewScrollAxis,
    getPreviewScrollDelta,
} from "../utils/previewScroll.mjs";
const props = defineProps({
    showList: {
        type: Array,
        required: true,
    },
    fullData: {
        type: Object,
        required: true,
    },
    isMultiple: {
        type: Boolean,
        required: true,
    },
    currentActiveTab: {
        type: String,
        required: true,
    },
    lockFilter: {
        type: String,
        default: "all",
    },
    isSearchPanelExpand: {
        type: Boolean,
        required: true,
    },
    collectedIds: {
        type: Set,
        default: undefined,
    },
    pinnedMap: {
        type: Object,
        default: () => ({}),
    },
});
let disposeListCommandHandlers = null;
const emit = defineEmits([
    "onDataChange",
    "onDataRemove",
    "onMultiCopyExecute",
    "toggleMultiSelect",
    "onItemDelete",
    "onItemsDelete",
    "openCleanDialog",
    "openTagEdit",
    "togglePin",
    "pastePinGroupAll",
    "editPinGroup",
    "clearPinGroup",
    "loadMore",
]);
const isItemCollected = (item) => {
    // 优先检查 item 对象的 collected 属性（用于即时更新）
    if (typeof item.collected === 'boolean') {
        return item.collected;
    }
    return props.collectedIds
        ? props.collectedIds.has(item.id)
        : Boolean(window?.db?.isCollected?.(item.id));
};
const isItemPinned = (item) => Boolean(item?.id && props.pinnedMap?.[item.id]);
const isOverSizedContent = (item) => {
    const { type, data } = item;
    if (type === "text") {
        // 没有换行的长文本也应当被纳入考虑
        return data.split(`\n`).length - 1 > 6 || data.length > 255;
    } else if (type === "file") {
        return JSON.parse(item.data).length >= 6;
    }
};

const getAliasMap = () => {
    const map = utools?.dbStorage?.getItem?.(ITEM_ALIAS_DB_KEY);
    return map && typeof map === "object" ? map : {};
};
const aliasMapRef = ref(getAliasMap());
const refreshAliasMap = () => {
    aliasMapRef.value = getAliasMap();
};
const normalizeAliasMapEntry = (entry) => {
    if (typeof entry === "string") {
        return { value: entry.trim(), cleared: false, exists: true };
    }
    if (entry && typeof entry === "object") {
        const value = typeof entry.value === "string" ? entry.value.trim() : "";
        return { value, cleared: entry.cleared === true, exists: true };
    }
    return { value: "", cleared: false, exists: false };
};
const setItemAlias = (itemId, alias) => {
    if (!itemId) return;
    const map = { ...aliasMapRef.value };
    const prev = normalizeAliasMapEntry(map[itemId]);
    const next = typeof alias === "string" && alias.trim() ? alias.trim() : "";
    if (prev.value !== next) {
        removeAliasMaterialForItem(itemId);
    }
    if (next) {
        map[itemId] = next;
    } else {
        map[itemId] = { value: "", cleared: true };
    }
    aliasMapRef.value = map;
    utools.dbStorage.setItem(ITEM_ALIAS_DB_KEY, map);
};
const getItemAlias = (item) => {
    if (!item) return "";
    const map = aliasMapRef.value;
    const fromStore = normalizeAliasMapEntry(map[item.id]);
    if (fromStore.value) return fromStore.value;
    if (fromStore.cleared) return "";
    // 再检查 item 对象的 alias 属性（用于即时更新和历史数据）
    if (typeof item.alias === "string" && item.alias.trim()) return item.alias.trim();
    if (typeof item.remark === "string" && item.remark.trim()) return item.remark.trim();
    if (Array.isArray(item.tags) && typeof item.tags[0] === "string" && item.tags[0].trim()) {
        return item.tags[0].trim();
    }
    return "";
};
const parseSingleFilePath = (item) => {
    if (!item || item.type !== "file") return "";
    try {
        const files = JSON.parse(item.data);
        if (!Array.isArray(files) || files.length !== 1) return "";
        return files[0]?.path || "";
    } catch (e) {
        return "";
    }
};

const saveAliasForItem = (item) => {
    if (!item) return false;
    const currentAlias = getItemAlias(item);
    ElMessageBox.prompt("请输入别名（留空可清空）", "别名编辑", {
        inputValue: currentAlias,
        confirmButtonText: "保存",
        cancelButtonText: "取消",
        inputPlaceholder: "输入别名",
        distinguishCancelAndClose: true,
    })
        .then(({ value }) => {
            setItemAlias(item.id, value);
            // 直接在 showList 中查找并修改对应的 item 对象
            const showListItem = props.showList.find((i) => i.id === item.id);
            if (showListItem) {
                showListItem.alias = typeof value === "string" ? value.trim() : "";
            }
            ElMessage({
                message: typeof value === "string" && value.trim() ? "别名已保存" : "别名已清空",
                type: "success",
            });
        })
        .catch(() => {});
    return true;
};
const isAliasDialogOpen = () =>
    Boolean(document.querySelector(".el-overlay .el-message-box"));
// 图片数据验证
const isValidImageData = (data) => {
    if (!data || typeof data !== "string") return false;
    return data.startsWith("data:image/") && data.includes("base64,");
};

// 图片点击处理（能展示就能复制，与悬浮一致）
const handleImageClick = (ev, item) => {
    if (ev) ev.stopPropagation();
    if (getItemImageSrc(item)) {
        copyAndPasteAndExit(item, { respectImageCopyGuard: true });
    }
};

// 图片加载错误处理
const handleImageError = (event) => {
    console.warn("[ClipItemList] 图片加载失败:", event.target.src);
    imagePreview.value.loadFailed = true;
};

const IMAGE_PREVIEW_HINT_TEXT = {
    both: "s-\u2195\u2194",
    vertical: "s-\u2195",
    horizontal: "s-\u2194",
};

const getImagePreviewArea = () => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const mainListWidth = Math.min(520, viewportWidth * 0.15);
    const gap = 0;
    const availableWidth = Math.max(viewportWidth - mainListWidth - gap, 0);
    const availableHeight = Math.max(viewportHeight, 0);
    return {
        viewportWidth,
        viewportHeight,
        mainListWidth,
        gap,
        availableWidth,
        availableHeight,
    };
};

const getImagePreviewHint = (canScrollX, canScrollY) => {
    if (canScrollX && canScrollY) return IMAGE_PREVIEW_HINT_TEXT.both;
    if (canScrollY) return IMAGE_PREVIEW_HINT_TEXT.vertical;
    if (canScrollX) return IMAGE_PREVIEW_HINT_TEXT.horizontal;
    return "";
};

const buildImagePreviewFooter = (footerText = "", canScrollX = false, canScrollY = false) => ({
    footer: footerText ? String(footerText) : "",
    hint: getImagePreviewHint(canScrollX, canScrollY),
});

const applyImagePreviewLayout = (naturalWidth, naturalHeight) => {
    if (!naturalWidth || !naturalHeight) return;

    const { availableWidth, availableHeight } = getImagePreviewArea();
    const layout = computeImagePreviewLayout({
        naturalWidth,
        naturalHeight,
        availableWidth,
        availableHeight,
    });
    if (!layout) return;

    imagePreview.value.layoutMode = layout.layoutMode;
    imagePreview.value.canScrollX = layout.canScrollX;
    imagePreview.value.canScrollY = layout.canScrollY;
    imagePreview.value.isSmallImage = layout.isSmallImage;
    imagePreview.value.hint = getImagePreviewHint(layout.canScrollX, layout.canScrollY);
    imagePreview.value.contentStyle = {
        minHeight: `${availableHeight}px`,
        minWidth: layout.canScrollX ? `${layout.displayWidth}px` : "100%",
    };
    imagePreview.value.scrollStyle = {
        overflowX: layout.canScrollX ? "auto" : "hidden",
        overflowY: layout.canScrollY ? "auto" : "hidden",
    };
    imagePreview.value.imageStyle = {
        width: `${layout.displayWidth}px`,
        height: `${layout.displayHeight}px`,
        maxWidth: "none",
        maxHeight: "none",
        display: "block",
        imageRendering: "auto",
    };

    nextTick(() => {
        setImagePreviewInitialScroll();
    });
};

const setImagePreviewInitialScroll = () => {
    const container = imagePreviewContentRef.value;
    if (!container) return;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    // 预览容器使用 rotate(180deg) 把滚动条放到左侧/上侧；视觉顶部对应 DOM 滚动末端。
    container.scrollTop = imagePreview.value.canScrollY ? maxScrollTop : 0;
    container.scrollLeft = imagePreview.value.canScrollX ? maxScrollLeft : 0;
    imagePreview.value.scrollTop = container.scrollTop;
};

const scrollPreviewContainer = (container, axis, delta) => {
    if (!container || !delta) return false;
    const key = axis === "x" ? "scrollLeft" : "scrollTop";
    const maxKey = axis === "x"
        ? container.scrollWidth - container.clientWidth
        : container.scrollHeight - container.clientHeight;
    if (maxKey <= 0) return false;
    const nextValue = Math.min(Math.max(0, container[key] + delta), maxKey);
    if (nextValue === container[key]) return false;
    container[key] = nextValue;
    if (axis === "y" && container === imagePreviewContentRef.value) {
        imagePreview.value.scrollTop = container.scrollTop;
    }
    return true;
};

const resetPreviewScrollHold = () => {
    previewScrollHold.value = {
        direction: "",
        startedAt: 0,
        lastAt: 0,
    };
};

const getPreviewScrollHeldMs = (direction, event) => {
    const now = Date.now();
    const previous = previewScrollHold.value;
    const isContinuous =
        previous.direction === direction &&
        (event?.repeat === true || now - previous.lastAt <= PREVIEW_SCROLL_CONTINUITY_MS);
    const startedAt = isContinuous ? previous.startedAt : now;
    previewScrollHold.value = {
        direction,
        startedAt,
        lastAt: now,
    };
    return now - startedAt;
};

const getActiveFilePreviewHint = (kind = "") => {
    if (kind === "csv" || kind === "spreadsheet") return IMAGE_PREVIEW_HINT_TEXT.both;
    return IMAGE_PREVIEW_HINT_TEXT.vertical;
};

const getPreviewScrollTarget = (direction) => {
    const axis = getPreviewScrollAxis(direction);
    if (!axis) return null;
    if (imagePreview.value.show && imagePreviewContentRef.value) {
        return {
            type: "image",
            element: imagePreviewContentRef.value,
            axis,
            invertDelta: true,
        };
    }

    if (filePreview.value.show && fileRichPreviewRef.value?.getScrollElement?.()) {
        return {
            type: "file",
            element: fileRichPreviewRef.value.getScrollElement(),
            axis,
            invertDelta: false,
        };
    }

    if (textPreview.value.show && textPreviewContentRef.value) {
        return {
            type: "text",
            element: textPreviewContentRef.value,
            axis,
            invertDelta: false,
        };
    }

    return null;
};

const handlePreviewScrollShortcut = (direction, event = null) => {
    const target = getPreviewScrollTarget(direction);
    if (!target?.element) return false;
    const axisSize = target.axis === "x"
        ? target.element.clientWidth
        : target.element.clientHeight;
    const heldMs = getPreviewScrollHeldMs(direction, event);
    let delta = getPreviewScrollDelta({
        direction,
        axisSize,
        heldMs,
    });
    if (target.invertDelta) delta *= -1;
    const handled =
        target.type === "file" && fileRichPreviewRef.value?.scrollByDelta
            ? fileRichPreviewRef.value.scrollByDelta(direction, delta)
            : scrollPreviewContainer(target.element, target.axis, delta);
    if (!handled) resetPreviewScrollHold();
    return handled;
};

const hasActiveShiftPreview = () =>
    imagePreview.value.show || textPreview.value.show || filePreview.value.show;

const isPureShiftPreviewEvent = (event) =>
    Boolean(event?.shiftKey) && !event?.ctrlKey && !event?.metaKey && !event?.altKey;

const isShiftPreviewCancelModifier = (event) =>
    Boolean(event?.shiftKey) && ["Control", "Meta", "Alt"].includes(event?.key);

const clearFilePreviewImmediately = () => {
    if (filePreviewHideTimer) {
        clearTimeout(filePreviewHideTimer);
        filePreviewHideTimer = null;
    }
    filePreview.value.show = false;
    filePreview.value.file = null;
    filePreview.value.hint = "";
    resetPreviewScrollHold();
};

const hideFilePreview = () => {
    if (filePreviewHideTimer) {
        clearTimeout(filePreviewHideTimer);
        filePreviewHideTimer = null;
    }
    filePreviewHideTimer = setTimeout(() => {
        filePreview.value.show = false;
        filePreview.value.file = null;
        filePreview.value.hint = "";
        resetPreviewScrollHold();
        filePreviewHideTimer = null;
    }, 200);
};

const keepFilePreview = () => {
    if (filePreviewHideTimer) {
        clearTimeout(filePreviewHideTimer);
        filePreviewHideTimer = null;
    }
};

const showFileRichPreview = (file) => {
    if (!file?.path) return;
    stopImagePreview(true);
    clearTextPreviewImmediately();
    keepFilePreview();
    const { mainListWidth, gap } = getImagePreviewArea();
    filePreview.value.file = file;
    filePreview.value.hint = getActiveFilePreviewHint(file.kind);
    filePreview.value.style = {
        position: "fixed",
        top: "0",
        right: "0",
        left: `${mainListWidth + gap}px`,
        bottom: "0",
        zIndex: 9999,
        backgroundColor: "rgba(15, 19, 27, 0.96)",
        borderRadius: "0",
        padding: "0",
        boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.32)",
        outline: "1px solid rgba(96, 165, 250, 0.72)",
        outlineOffset: "-1px",
        boxSizing: "border-box",
        display: "flex",
        overflow: "hidden",
    };
    filePreview.value.show = true;
    resetPreviewScrollHold();
    nextTick(() => {
        document.querySelector(".file-preview-modal")?.focus?.();
    });
};

// 图片加载成功处理
const handleImageLoad = (event) => {
    // console.log("[ClipItemList] 图片加载成功:", event.target.src);
    applyImagePreviewLayout(
        event.target.naturalWidth,
        event.target.naturalHeight,
    );
};

const isPreviewableImageSrc = (src) => {
    if (!src) return false;
    return isValidImageData(src) || /^file:\/\//i.test(src);
};

const resolvePreviewImageSrc = (value) => {
    if (!value || typeof value !== "string") return "";
    if (isValidImageData(value)) return value;
    if (/^file:\/\//i.test(value)) return value;
    return toFileUrl(value);
};

const getItemImageSrc = (item) => {
    if (!item || item.type !== "image") return "";
    // 悬浮预览优先使用原图以提升清晰度
    return resolvePreviewImageSrc(item.data) || item.thumbnail;
};

// 显示图片预览（统一使用插件内弹层，不调用 window.open 桌面预览）
const showImagePreview = (event, item, footerText = "") => {
    const src = getItemImageSrc(item);
    if (!src) return;

    imagePreviewSource.value = event ? "hover" : "keyboard";
    textPreview.value.show = false;
    clearFilePreviewImmediately();
    if (textPreviewHideTimer) {
        clearTimeout(textPreviewHideTimer);
        textPreviewHideTimer = null;
    }
    if (imagePreviewHideTimer) {
        clearTimeout(imagePreviewHideTimer);
        imagePreviewHideTimer = null;
    }

    // 计算预览窗口尺寸：右侧区域，预留主列表滚动条空间
    const { mainListWidth, gap } = getImagePreviewArea();

    imagePreview.value.src = src;
    const footerMeta = buildImagePreviewFooter(footerText);
    imagePreview.value.footer = footerMeta.footer;
    imagePreview.value.hint = footerMeta.hint;
    imagePreview.value.scrollTop = 0; // 重置滚动位置
    imagePreview.value.loadFailed = false;
    imagePreview.value.layoutMode = "centered";
    imagePreview.value.canScrollX = false;
    imagePreview.value.canScrollY = false;
    imagePreview.value.contentStyle = {};
    imagePreview.value.scrollStyle = {};
    imagePreview.value.isSmallImage = false;

    // 右侧预览窗口样式（始终填满右侧）
    imagePreview.value.style = {
        position: "fixed",
        top: "0",
        right: "0",
        left: `${mainListWidth + gap}px`,
        bottom: "0",
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderRadius: "0",
        padding: "0px",
        boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.4)",
        outline: "1px solid rgba(96, 165, 250, 0.9)",
        outlineOffset: "-1px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    };

    imagePreview.value.imageStyle = {
        width: "auto",
        height: "auto",
        maxWidth: "none",
        maxHeight: "none",
        display: "block",
        imageRendering: "auto",
    };
    imagePreview.value.show = true;

    // 悬浮预览优先使用原图以提升清晰度
    nextTick(() => {
        const modal = document.querySelector('.image-preview-modal');
        if (modal) {
            modal.focus();
        }
    });
};

// 隐藏图片预览
const stopImagePreview = (immediate = false) => {
    if (imagePreviewHideTimer) {
        clearTimeout(imagePreviewHideTimer);
        imagePreviewHideTimer = null;
    }
    if (immediate) {
        imagePreview.value.show = false;
        imagePreviewSource.value = "";
        imagePreview.value.footer = "";
        imagePreview.value.hint = "";
        imagePreview.value.loadFailed = false;
        resetPreviewScrollHold();
        // 不调用 restorePreviewWindow，保持插件窗口大小不变
        closeExternalPreview();
        return;
    }
    imagePreviewHideTimer = setTimeout(() => {
        imagePreview.value.show = false;
        imagePreviewSource.value = "";
        imagePreview.value.footer = "";
        imagePreview.value.hint = "";
        imagePreview.value.loadFailed = false;
        resetPreviewScrollHold();
        // 不调用 restorePreviewWindow，保持插件窗口大小不变
        closeExternalPreview();
        imagePreviewHideTimer = null;
    }, 200);
};

// 图片数据验证
onUnmounted(() => {
    desktopPreviewManager.closeAllPreviews();
});

const hideImagePreview = () => {
    // 延迟隐藏，允许鼠标移动到预览区域
    stopImagePreview(false);
};

// 保持图片预览显示
const keepImagePreview = () => {
    if (imagePreviewSource.value === "hover") return;
    if (imagePreviewHideTimer) {
        clearTimeout(imagePreviewHideTimer);
        imagePreviewHideTimer = null;
    }
};

// 图片预览滚动处理
const handleImagePreviewScroll = (event) => {
    imagePreview.value.scrollTop = event.target.scrollTop;
};

// 图片预览键盘处理兜底；主入口仍走 hotkey feature
const handleImagePreviewKeydown = (event) => {
    if (!imagePreview.value.show || !isPureShiftPreviewEvent(event)) return;
    const directionMap = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
    };
    const direction = directionMap[event.key];
    if (!direction) return;
    if (handlePreviewScrollShortcut(direction)) {
        event.preventDefault();
        event.stopPropagation();
    }
};

let externalPreviewWindow = null;

const escapePreviewText = (value = "") =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const openExternalPreview = (src, footer = "", ratio = 0.9) => {
    if (!src) return false;

    // 获取桌面屏幕尺寸
    const screenWidth =
        window.screen?.availWidth || window.screen?.width || 1920;
    const screenHeight =
        window.screen?.availHeight || window.screen?.height || 1080;

    // 自动聚焦以接收键盘事件
    const width = Math.floor(screenWidth * ratio);
    const height = Math.floor(screenHeight * ratio);
    const left = Math.max(0, Math.floor((screenWidth - width) / 2));
    const top = Math.max(0, Math.floor((screenHeight - height) / 2));

    let win = externalPreviewWindow;
    if (!win || win.closed) {
        // 创建新的预览窗口，添加更多特性
        win = window.open(
            "",
            "clip-image-preview",
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes,toolbar=no,menubar=no`,
        );
        externalPreviewWindow = win;
    } else {
        try {
            win.resizeTo(width, height);
            win.moveTo(left, top);
        } catch (e) {}
    }

    if (!win) return false;

    const footerHtml = footer
        ? '<div class="footer">' +
          escapePreviewText(footer).replace(/\n/g, "<br>") +
          "</div>"
        : "";

    const html = [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        '  <meta charset="utf-8" />',
        '  <title>图片预览 - 超级剪贴板</title>',
        "  <style>",
        "    html, body { ",
        "      margin: 0; ",
        "      padding: 0; ",
        "      width: 100%; ",
        "      height: 100%; ",
        "      background: #0f1115; ",
        "      color: #e5e7eb; ",
        "      overflow: hidden;",
        "    }",
        "    body { ",
        "      display: flex; ",
        "      flex-direction: column; ",
        "      align-items: center; ",
        "      justify-content: center; ",
        "    }",
        "    .wrap { ",
        "      display: flex; ",
        "      flex-direction: column; ",
        "      align-items: center; ",
        "      justify-content: center; ",
        "      width: 100%; ",
        "      height: 100%; ",
        "      padding: 20px; ",
        "      box-sizing: border-box; ",
        "      position: relative;",
        "    }",
        "    img { ",
        "      width: auto; ",
        "      height: auto; ",
        "      max-width: 100%; ",
        "      max-height: calc(100% - 40px); ",
        "      object-fit: contain; ",
        "      border-radius: 8px; ",
        "      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);",
        "      transition: transform 0.2s ease;",
        "    }",
        "    img:hover {",
        "      transform: scale(1.02);",
        "    }",
        "    .footer { ",
        "      margin-top: 15px; ",
        "      font-size: 13px; ",
        "      color: #9ca3af; ",
        "      text-align: center; ",
        "      white-space: pre-wrap; ",
        "      word-break: break-all; ",
        "      max-width: 100%;",
        "      opacity: 0.8;",
        "    }",
        "    .controls {",
        "      position: absolute;",
        "      top: 10px;",
        "      right: 10px;",
        "      display: flex;",
        "      gap: 8px;",
        "    }",
        "    .control-btn {",
        "      background: rgba(255, 255, 255, 0.1);",
        "      border: 1px solid rgba(255, 255, 255, 0.2);",
        "      color: #e5e7eb;",
        "      padding: 6px 12px;",
        "      border-radius: 4px;",
        "      cursor: pointer;",
        "      font-size: 12px;",
        "      transition: all 0.2s ease;",
        "    }",
        "    .control-btn:hover {",
        "      background: rgba(255, 255, 255, 0.2);",
        "      border-color: rgba(255, 255, 255, 0.3);",
        "    }",
        "    .shortcuts {",
        "      position: absolute;",
        "      bottom: 10px;",
        "      left: 10px;",
        "      font-size: 11px;",
        "      color: #6b7280;",
        "      opacity: 0.6;",
        "    }",
        "  </style>",
        "</head>",
        "<body>",
        '  <div class="wrap">',
        '    <div class="controls">',
        '      <button class="control-btn" onclick="window.close()">鍏抽棴 (ESC)</button>',
        "    </div>",
        '    <img src="' + src + '" alt="preview" />',
        footerHtml,
        '    <div class="shortcuts">ESC: 鍏抽棴绐楀彛</div>',
        "  </div>",
        "  <script>",
        "    // ESC键关闭窗口",
        '    document.addEventListener("keydown", function(e) {',
        '      if (e.key === "Escape") {',
        "        window.close();",
        "      }",
        "    });",
        "    ",
        "    // 绐楀彛澶辩劍鏃朵篃鍙互閫氳繃ESC鍏抽棴",
        '    window.addEventListener("blur", function() {',
        "      setTimeout(function() {",
        "        window.focus();",
        "      }, 100);",
        "    });",
        "    ",
        "    // 自动调整窗口大小以适应图片",
        '    const img = document.querySelector("img");',
        "    if (img.complete) {",
        "      adjustWindowSize();",
        "    } else {",
        "      img.onload = adjustWindowSize;",
        "    }",
        "    ",
        "    function adjustWindowSize() {",
        "      const imgWidth = img.naturalWidth;",
        "      const imgHeight = img.naturalHeight;",
        "      const screenWidth = screen.availWidth;",
        "      const screenHeight = screen.availHeight;",
        "      ",
        "      // 如果图片比屏幕小，调整窗口大小以适应图片",
        "      if (imgWidth < screenWidth * 0.8 && imgHeight < screenHeight * 0.8) {",
        "        const newWidth = Math.min(imgWidth + 100, screenWidth * 0.8);",
        "        const newHeight = Math.min(imgHeight + 150, screenHeight * 0.8);",
        "        const left = Math.floor((screenWidth - newWidth) / 2);",
        "        const top = Math.floor((screenHeight - newHeight) / 2);",
        "        ",
        "        try {",
        "          window.resizeTo(newWidth, newHeight);",
        "          window.moveTo(left, top);",
        "        } catch(e) {}",
        "      }",
        "    }",
        "  <\/script>",
        "</body>",
        "</html>",
    ].join("\n");

    win.document.open();
    win.document.write(html);
    win.document.close();

    // 鑱氱劍鍒伴瑙堢獥鍙?
    try {
        win.focus();
    } catch (e) {}

    return true;
};

const focusUtoolsMainWindow = () => {
    if (window.__isExitingPlugin) return;
    if (typeof utools?.showMainWindow === "function") {
        utools.showMainWindow();
        return;
    }
    if (typeof utools?.showWindow === "function") {
        utools.showWindow();
        return;
    }
    if (typeof window.focus === "function") {
        window.focus();
    }
};

const closeExternalPreview = () => {
    if (externalPreviewWindow && !externalPreviewWindow.closed) {
        try {
            externalPreviewWindow.close();
        } catch (e) {}
        externalPreviewWindow = null;
        focusUtoolsMainWindow();
    } else {
        externalPreviewWindow = null;
    }
};

const expandPreviewWindow = (maxWidth, maxHeight) => {
    const canExpandWidth = typeof utools?.setExpendWidth === "function";
    const canExpandHeight = typeof utools?.setExpendHeight === "function";
    if (!canExpandWidth && !canExpandHeight) return;
    if (!previewWindowSize.value) {
        previewWindowSize.value = {
            width: window.innerWidth,
            height: window.innerHeight,
        };
    }
    if (canExpandWidth) {
        const nextWidth = Math.max(window.innerWidth, Math.ceil(maxWidth + 80));
        utools.setExpendWidth(nextWidth);
    }
    if (canExpandHeight) {
        const nextHeight = Math.max(
            window.innerHeight,
            Math.ceil(maxHeight + 80),
        );
        utools.setExpendHeight(nextHeight);
    }
};

const restorePreviewWindow = () => {
    if (!previewWindowSize.value) return;
    const { width, height } = previewWindowSize.value;
    if (typeof utools?.setExpendWidth === "function") {
        utools.setExpendWidth(width);
    }
    if (typeof utools?.setExpendHeight === "function") {
        utools.setExpendHeight(height);
    }
    previewWindowSize.value = null;
};

const toFileUrl = (path) => {
    if (!path) return "";
    if (path.startsWith("file://")) return path;
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    return `file:///${normalized}`;
};

const showImageFilePreview = (path) => {
    if (!path) return;
    const src = toFileUrl(path);
    if (!src) return;
    const name = path.split(/[\\/]/).pop() || path;
    const footerText = `${name}\n${path}`;

    // 延迟隐藏，允许鼠标移动到预览区域
    showImagePreview(null, { type: "image", data: src }, footerText);
};

// Shift 持续按下预览：按 item 类型封装的预览入口
const SHIFT_PREVIEW_HOLD_MS = 100;
const LONG_TEXT_THRESHOLD = 80;
const hoverPreviewConfig = ref(getHoverPreviewConfig(setting));

const isLongText = (item) => {
    if (!item || item.type !== "text" || typeof item.data !== "string")
        return false;
    return item.data.length > LONG_TEXT_THRESHOLD || item.data.includes("\n");
};

const isPreviewableTextItem = (item) => isLongText(item);

/** 根据当前 item 类型执行预览（图片 / 长文本 / 文件富预览） */
const runPreviewForItem = (item) => {
    if (!item) {
        stopImagePreview(true);
        clearTextPreviewImmediately();
        clearFilePreviewImmediately();
        return;
    }
    if (item.type === "image" && getItemImageSrc(item)) {
        clearTextPreviewImmediately();
        clearFilePreviewImmediately();
        showImagePreview(null, item);
        return;
    }
    if (item.type === "text" && isLongText(item)) {
        stopImagePreview(true);
        clearFilePreviewImmediately();
        showTextPreview(item);
        return;
    }
    if (item.type === "file") {
        clearTextPreviewImmediately();
        const previewFile = getPreviewableFile(parseFileItemData(item.data));
        if (previewFile?.kind === "image") {
            showImageFilePreview(previewFile.path);
            return;
        }
        if (previewFile?.path) {
            showFileRichPreview(previewFile);
            return;
        }
    }
    stopImagePreview(true);
    clearTextPreviewImmediately();
    clearFilePreviewImmediately();
};

// Shift键长按处理（普通层 100ms 持续即对所在 item 进行预览）
const handleShiftKeyDown = () => {
    if (isAliasDialogOpen()) return;
    if (shiftKeyTimer) return;

    shiftKeyDownTime = Date.now();
    shiftKeyTimer = setTimeout(() => {
        keyboardTriggeredPreview.value = true;
        const currentItem = props.showList[activeIndex.value];
        runPreviewForItem(currentItem);
    }, SHIFT_PREVIEW_HOLD_MS);
};

const handleShiftKeyUp = () => {
    if (shiftKeyTimer) {
        clearTimeout(shiftKeyTimer);
        shiftKeyTimer = null;
    }
    isShiftDown.value = false;

    if (keyboardTriggeredPreview.value) {
        keyboardTriggeredPreview.value = false;
        hoverTriggeredPreview.value = false;
        stopImagePreview(true);
        hideTextPreview();
        clearFilePreviewImmediately();
    }
};

// 图片点击处理（能展示就能复制，与悬浮一致）
const triggerKeyboardPreview = () => {
    if (!keyboardTriggeredPreview.value) return;
    const currentItem = props.showList[activeIndex.value];
    runPreviewForItem(currentItem);
};

const clearTextPreviewImmediately = () => {
    textPreviewLoadToken += 1;
    if (textPreviewHideTimer) {
        clearTimeout(textPreviewHideTimer);
        textPreviewHideTimer = null;
    }
    textPreview.value.show = false;
    textPreview.value.text = "";
    textPreview.value.preview = createEmptyTextDocumentPreview();
    textPreview.value.wrapText = true;
    textPreview.value.panelStyle = {};
    textPreview.value.contentStyle = {};
    resetPreviewScrollHold();
};

const getTextPreviewContentStyle = (preview, wrapText) => {
    const kind = preview?.kind || "text";
    const isTable = kind === "csv";
    const isRich = kind === "structured" || kind === "html";
    return {
        width: "100%",
        overflowX: isTable || isRich ? "auto" : "hidden",
        overflowY: "auto",
        whiteSpace: isTable || isRich ? "normal" : "pre-wrap",
        wordBreak: isTable || isRich ? "normal" : "break-word",
        color: "var(--text-color)",
        fontSize: isTable ? "12px" : wrapText ? "15px" : "14px",
    };
};

const applyTextPreviewResult = (text, preview) => {
    const nextPreview = preview || createEmptyTextDocumentPreview(text);
    const { wrapText } = nextPreview.kind === "text" ? getTextPreviewMode(text) : { wrapText: false };
    textPreview.value.text = text;
    textPreview.value.preview = nextPreview;
    textPreview.value.wrapText = wrapText;
    textPreview.value.contentStyle = getTextPreviewContentStyle(nextPreview, wrapText);
};

const showTextPreview = async (item) => {
    const token = ++textPreviewLoadToken;
    imagePreview.value.show = false;
    clearFilePreviewImmediately();
    if (imagePreviewHideTimer) {
        clearTimeout(imagePreviewHideTimer);
        imagePreviewHideTimer = null;
    }
    if (textPreviewHideTimer) {
        clearTimeout(textPreviewHideTimer);
        textPreviewHideTimer = null;
    }
    const maxW = window.innerWidth;
    const text = item.data || "";
    textPreview.value.show = true;
    textPreview.value.panelStyle = {
        width: `${maxW * 0.9}px`,
        maxWidth: `${maxW * 0.9}px`,
    };
    applyTextPreviewResult(text, createEmptyTextDocumentPreview(text));

    const richPreview = await buildDetectedTextDocumentPreview(text);
    if (token !== textPreviewLoadToken || !textPreview.value.show) return;
    applyTextPreviewResult(text, richPreview);

    nextTick(() => {
        if (textPreviewContentRef.value) {
            textPreviewContentRef.value.scrollTop = 0;
        }
    });
};

const hideTextPreview = () => {
    textPreviewLoadToken += 1;
    // 移除延时隐藏，文字预览只在Shift键释放时隐藏
    textPreview.value.show = false;
    textPreview.value.text = "";
    textPreview.value.preview = createEmptyTextDocumentPreview();
    textPreview.value.wrapText = true;
    textPreview.value.panelStyle = {};
    textPreview.value.contentStyle = {};
    resetPreviewScrollHold();
};

const keepTextPreview = () => {
    if (textPreviewHideTimer) {
        clearTimeout(textPreviewHideTimer);
        textPreviewHideTimer = null;
    }
};

const resetTransientPreviewState = () => {
    if (shiftKeyTimer) {
        clearTimeout(shiftKeyTimer);
        shiftKeyTimer = null;
    }
    if (hoverPreviewTimer) {
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = null;
    }
    keyboardTriggeredPreview.value = false;
    hoverTriggeredPreview.value = false;
    hoverRowIndex.value = null;
    stopImagePreview(true);
    clearTextPreviewImmediately();
    clearFilePreviewImmediately();
};

// 检测文件中是否包含图片
const hasImageFiles = (item) => {
    if (item.type !== "file") return false;
    try {
        const files = JSON.parse(item.data);
        return files.some((file) => {
            const extension = file.path?.split(".").pop()?.toLowerCase();
            return [
                "jpg",
                "jpeg",
                "png",
                "gif",
                "bmp",
                "webp",
                "svg",
                "ico",
            ].includes(extension);
        });
    } catch (e) {
        return false;
    }
};

// 获取文件中的图片文件
const getImageFiles = (item) => {
    if (item.type !== "file") return [];
    try {
        const files = JSON.parse(item.data);
        return files.filter((file) => {
            const extension = file.path?.split(".").pop()?.toLowerCase();
            return [
                "jpg",
                "jpeg",
                "png",
                "gif",
                "bmp",
                "webp",
                "svg",
                "ico",
            ].includes(extension);
        });
    } catch (e) {
        return [];
    }
};

const formatFileNames = (item) => {
    try {
        const paths = JSON.parse(item.data)
            .map((f) => f.path)
            .filter(Boolean);
        const origin = Array.isArray(item.originPaths)
            ? item.originPaths.filter(Boolean)
            : [];
        if (origin.length) {
            return [...paths, "---", ...origin].join("\n");
        }
        return paths.join("\n");
    } catch (e) {
        return "";
    }
};

const closeDrawer = () => {
    drawerShow.value = false;
};

const handleDrawerSelect = (op, meta = {}) => {
    const currentItem = props.showList[activeIndex.value];
    if (!currentItem) return;
    if (op?.id === ALIAS_CONTEXT_MENU_ACTION_ID) {
        saveAliasForItem(currentItem);
        if (!meta.sub) {
            drawerShow.value = false;
        }
        return;
    }
    handleOperateClick(op, currentItem, meta);
    if (!meta.sub) {
        drawerShow.value = false;
    }
};

const handleDrawerReorder = (list) => {
    drawerItems.value = list;
    drawerOrder.value = list.map((op) => op.id);
    utools.dbStorage.setItem("drawer.order", drawerOrder.value);
};

// 全部信息内的菜单：与主层 ClipOperate 一致，filterOperate + applyDrawerOrder，用于右侧抽屉
// 防漂移约束：抽屉渲染与序号快捷执行必须共用该菜单数据源。
const getDrawerFullMenuItems = (currentItem) => {
    return buildDrawerMenuItems({
        item: currentItem,
        operations: operations.value,
        filterOperate,
        drawerOrder: drawerOrder.value,
    });
};

// 打开当前 item 的快捷菜单抽屉（右侧抽屉，展示全部菜单；右方向键/鼠标右键/c-s-序号 调用）
const openDrawerForCurrentItem = (ev, defaultActiveIndex = 0) => {
    const currentItem = props.showList[activeIndex.value];
    if (!currentItem) return;
    const fullMenu = getDrawerFullMenuItems(currentItem);
    if (!fullMenu.length) return;
    nextTick(() => {
        const el =
            ev?.target?.closest?.(".clip-item") ||
            document.querySelector(".clip-item.active");
        const rect = el?.getBoundingClientRect();
        drawerPosition.value = rect
            ? { top: rect.bottom + 4, left: rect.left }
            : { top: 100, left: 100 };
        drawerItems.value = fullMenu;
        drawerDefaultActive.value = Math.min(
            defaultActiveIndex,
            Math.max(0, fullMenu.length - 1),
        );
        drawerPlacement.value = "right";
        drawerShow.value = true;
    });
};
const isShiftDown = ref(false);
const selectItemList = ref([]);
const {
    activeIndex,
    pendingNavAfterLoad,
    deleteAnchor,
    clampActiveIndex,
    setActiveIndex,
    setPendingNavAfterLoad,
    setDeleteAnchor,
    clearPendingStates,
} = useListNavigation(() => props.showList);
const allSelectedLocked = ref(false); // 临时标志：记录所有选中项是否都已锁定
const lockedRenderVersion = ref(0);

// 图片预览相关
const imagePreview = ref({
    show: false,
    src: "",
    footer: "",
    hint: "",
    style: {},
    imageStyle: {},
    contentStyle: {},
    scrollStyle: {},
    layoutMode: "centered",
    canScrollX: false,
    canScrollY: false,
    loadFailed: false,
    scrollTop: 0, // 添加滚动位置跟踪
    isSmallImage: false, // 标记是否为小图片
});
const imagePreviewSource = ref("");
const hoverRowIndex = ref(null);
const previewWindowSize = ref(null);
const listRootRef = ref(null);
const scrollParentRef = ref(null);
const imagePreviewContentRef = ref(null); // 图片预览内容容器引用
const textPreviewContentRef = ref(null);
const fileRichPreviewRef = ref(null);
const lastPointerPosition = ref({ x: null, y: null });

// 列表在 TanStack 虚拟滚动容器内滚动；触底时由本组件 emit loadMore（不再依赖 document 级 scroll 冒泡）
let scrollEndLoadMoreTs = 0;
const SCROLL_END_LOAD_MORE_COOLDOWN_MS = 120;
const estimateItemSize = (index = activeIndex.value) => {
    const item = props.showList[index];
    if (!item) return 52;
    if (item.type === "image") return 76;
    return props.isMultiple && activeIndex.value === index ? 72 : 52;
};
const getListVisibleInsets = () => ({
    top: 8,
    bottom: 8,
});
const {
    applyScrollToItemIndex,
    getPageStep: virtualPageStep,
    getPageTargetIndex,
    scrollByPage,
    scrollHalfPage,
} = useVirtualListScroll({
    listRootRef,
    scrollParentRef,
    virtualizer: null,
    getEstimateSize: () => estimateItemSize(),
    getCount: () => props.showList.length,
    getVisibleInsets: getListVisibleInsets,
});
const handleVirtualScroll = () => {
    const container = scrollParentRef.value;
    if (!container) return;
    const now = Date.now();
    const isNearBottom =
        container.scrollTop + container.clientHeight + 12 >=
        container.scrollHeight;
    if (!isNearBottom) return;
    if (now - scrollEndLoadMoreTs < SCROLL_END_LOAD_MORE_COOLDOWN_MS) return;
    scrollEndLoadMoreTs = now;
    emit("loadMore");
};

// 长文本预览（Shift 按住）状态
const textPreview = ref({
    show: false,
    text: "",
    preview: createEmptyTextDocumentPreview(),
    panelStyle: {},
    contentStyle: {},
    wrapText: true,
});
const filePreview = ref({
    show: false,
    file: null,
    style: {},
    hint: "",
});

// 图片预览延迟隐藏定时器
let imagePreviewHideTimer = null;
// 长文本预览延迟隐藏定时器
let textPreviewHideTimer = null;
let textPreviewLoadToken = 0;
let filePreviewHideTimer = null;
const previewScrollHold = ref({
    direction: "",
    startedAt: 0,
    lastAt: 0,
});
const PREVIEW_SCROLL_CONTINUITY_MS = 700;

// Shift 键按下时间（区分短按与长按预览）
let shiftKeyDownTime = 0;
let shiftKeyTimer = null;
const keyboardTriggeredPreview = ref(false);
// 行级悬浮预览 debounce 定时器
let hoverPreviewTimer = null;
const hoverTriggeredPreview = ref(false);
// 方向键生效后暂停悬浮预览，直到鼠标再次移动才重新启用
const hoverPreviewSuspendedByKeyboard = ref(false);
// 点击（如打开文件 popover）后暂停悬浮预览，鼠标移动则解除
const hoverPreviewSuspendedByClick = ref(false);
// 自动滚动（长按方向键）定时器
const autoScrollTimer = ref(null);
const autoScrollSpeed = ref(100); // 初始滚动间隔(ms)
const autoScrollDirection = ref(null); // 'up' or 'down'
const autoScrollAcceleration = ref(1.2); // 加速因子
const AUTO_SCROLL_INITIAL_DELAY = 260;
const drawerShow = ref(false);
const drawerPosition = ref({ top: 0, left: 0 });
const drawerItems = ref([]);
const drawerDefaultActive = ref(0);
const drawerPlacement = ref("right");
const drawerOrder = ref(
    Array.isArray(utools.dbStorage.getItem("drawer.order"))
        ? utools.dbStorage.getItem("drawer.order")
        : [],
);
const operations = computed(() => [
    ...defaultOperation,
    ...setting.operation.custom,
]);
const { handleOperateClick, filterOperate } = useClipOperate({
    emit,
    currentActiveTab: () => props.currentActiveTab,
});
const selectedItemIds = ref([]);
const selectedItemIdSet = ref(new Set());
const syncSelectedItemIdSet = () => {
    selectedItemIdSet.value = new Set(
        selectItemList.value.map((item) => item?.id).filter(Boolean),
    );
};
const replaceSelectedItems = (items) => {
    selectItemList.value = Array.isArray(items) ? items : [];
    syncSelectedItemIdSet();
};
const appendSelectedItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const next = [...selectItemList.value];
    const ids = new Set(selectedItemIdSet.value);
    items.forEach((item) => {
        if (!item?.id || ids.has(item.id)) return;
        ids.add(item.id);
        next.push(item);
    });
    selectItemList.value = next;
    selectedItemIdSet.value = ids;
};
const removeSelectedItemById = (itemId) => {
    if (!itemId || !selectedItemIdSet.value.has(itemId)) return;
    replaceSelectedItems(
        selectItemList.value.filter((item) => item?.id !== itemId),
    );
};
const emptySelectItemList = () => {
    replaceSelectedItems([]);
    selectedItemIds.value = [];
};
const showItemIndexMap = computed(() => {
    const map = new Map();
    props.showList.forEach((item, index) => {
        if (item?.id) map.set(item.id, index);
    });
    return map;
});
const getShowItemIndex = (item) => {
    if (!item?.id) return -1;
    return showItemIndexMap.value.get(item.id) ?? -1;
};
const applyHoverPreviewConfig = (nextSetting = setting) => {
    hoverPreviewConfig.value = getHoverPreviewConfig(nextSetting);

    if (hoverPreviewConfig.value.enabled) return;

    resetTransientPreviewState();
};

const handleSettingUpdated = (event) => {
    refreshAliasMap();
    applyHoverPreviewConfig(event?.detail || setting);
};

// 图片预览滚动处理
const openTagEditModal = (item) => {
    emit("openTagEdit", item);
};

watch(
    () => props.isMultiple,
    (val) => {
        if (!val) {
            emptySelectItemList(); // 退出多选状态 清空列表
            allSelectedLocked.value = false; // 重置锁定状态标志
        } else if (val && selectItemList.value.length > 0) {
            // 进入多选模式且已有选中项时，初始化锁定状态标志
            updateAllSelectedLockedFlag();
        }
    },
);
// 图片预览键盘处理兜底；主入口仍走 hotkey feature
const updateAllSelectedLockedFlag = () => {
    if (selectItemList.value.length === 0) {
        allSelectedLocked.value = false;
        return;
    }
    allSelectedLocked.value = selectItemList.value.every(
        (item) => item.locked === true,
    );
};

// 多选普通删除后：用于在 showList 更新时恢复高亮（若高亮项被删则下移，最后一个则上移）
const preserveSelection = () => {
    selectedItemIds.value = selectItemList.value.map((item) => item.id);
};

// 鎭㈠閫夋嫨鐘舵€?
const restoreSelection = () => {
    if (!props.isMultiple || selectedItemIds.value.length === 0) return;

    const selectedIds = new Set(selectedItemIds.value);
    const newSelection = props.showList.filter((item) =>
        selectedIds.has(item.id),
    );
    replaceSelectedItems(newSelection);
    selectedItemIds.value = [];
    updateAllSelectedLockedFlag();
};

// Shift 持续按下预览：按 item 类型封装的预览入口
watch(
    () => selectItemList.value.length,
    (len) => {
        if (props.isMultiple && len === 0) {
            emit("toggleMultiSelect", false);
            allSelectedLocked.value = false; // 重置锁定状态标志
        } else if (props.isMultiple && len > 0) {
            // 选中项发生变化时更新锁定状态标志
            updateAllSelectedLockedFlag();
        }
    },
);
const handleItemClick = (ev, item) => {
    if (props.isMultiple === true) {
        const isSelected = selectedItemIdSet.value.has(item.id);
        const index = getShowItemIndex(item);
        activeIndex.value = index;
        if (selectItemList.value.length !== 0 && isShiftDown.value) {
            const selectedIndices = selectItemList.value
                .filter((item) =>
                    props.currentActiveTab === "all"
                        ? true
                        : item.type === props.currentActiveTab,
                )
                .map((item) => getShowItemIndex(item))
                .filter((idx) => idx !== -1)
                .sort((a, b) => a - b);
            const h = selectedIndices[0];
            const l = selectedIndices[selectedIndices.length - 1];
            if (h == null || l == null) {
                if (isSelected) removeSelectedItemById(item.id);
                else appendSelectedItems([item]);
                return;
            }
            if (index < h) {
                appendSelectedItems(props.showList.slice(index, h + 1));
            } else if (index > l) {
                appendSelectedItems(props.showList.slice(h, index + 1));
            } else if (index <= l && index >= h) {
                if (isSelected) removeSelectedItemById(item.id);
                else appendSelectedItems([item]);
            }
        } else {
            if (isSelected) removeSelectedItemById(item.id);
            else appendSelectedItems([item]);
        }
    } else {
        const { button } = ev;
        const currentIndex = getShowItemIndex(item);
        activeIndex.value = currentIndex;
        
        if (button === 0) {
            // 左键 复制并移动到下一个item
            // 文件类型点击会打开 popover 做预览，此时禁用行级悬浮预览，鼠标移动后解除
            if (item.type === "file") {
                hoverPreviewSuspendedByClick.value = true;
            }
            // 图片类型：能展示就能复制（与悬浮预览一致，base64 或路径/file:// 均可）
            if (item.type === "image" && !getItemImageSrc(item)) {
                return;
            }
            copyAndPasteAndExit(item, { respectImageCopyGuard: true });
            
            // 复制后移动到下一个item
            nextTick(() => {
                moveToNextItemFromIndex(currentIndex);
            });
        } else if (button === 2) {
            // 右键 打开抽屉并移动到下一个item
            openDrawerForCurrentItem(ev);
            ev.preventDefault();
            
            // 打开抽屉后移动到下一个item
            nextTick(() => {
                moveToNextItemFromIndex(currentIndex);
            });
        }
    }
};
const handleMouseOver = (event, index, item) => {
    if (keyboardTriggeredPreview.value) {
        if (hoverPreviewTimer) {
            clearTimeout(hoverPreviewTimer);
            hoverPreviewTimer = null;
        }
        hoverRowIndex.value = index;
        return;
    }

    // 方向键或点击后挂起悬浮高亮与悬浮预览，必须等真实鼠标移动后再恢复
    const wasSuspended =
        hoverPreviewSuspendedByKeyboard.value ||
        hoverPreviewSuspendedByClick.value;
    let hoverNavigationAccepted = false;

    if (!props.isMultiple && !wasSuspended) {
        hoverNavigationAccepted = syncHoverActiveIndex(index);
    }
    // 从不同行移入时停止上一行的 hover 预览，避免同一行内移动造成闪烁
    if (
        imagePreviewSource.value === "hover" &&
        hoverRowIndex.value !== null &&
        hoverRowIndex.value !== index
    ) {
        stopImagePreview(true);
    }
    hoverRowIndex.value = index;

    // 行级悬浮预览；方向键生效后的第一次移入也不启动
    if (hoverPreviewTimer) {
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = null;
    }
    if (
        hoverPreviewConfig.value.enabled &&
        !keyboardTriggeredPreview.value &&
        !wasSuspended &&
        hoverNavigationAccepted
    ) {
        hoverPreviewTimer = setTimeout(() => {
            hoverTriggeredPreview.value = true;
            runPreviewForItem(item);
            hoverPreviewTimer = null;
        }, hoverPreviewConfig.value.delay);
    }
};

const handleListMouseMove = (event) => {
    const { clientX, clientY } = event;
    const last = lastPointerPosition.value;
    const moved = last.x !== clientX || last.y !== clientY;
    lastPointerPosition.value = { x: clientX, y: clientY };
    if (!moved) return;
    hoverPreviewSuspendedByKeyboard.value = false;
    hoverPreviewSuspendedByClick.value = false;
};

const NAVIGATION_PRIORITIES = Object.freeze({
    "delete-recovery": 6,
    "load-recovery": 5,
    "hold-scroll": 4,
    "page-nav": 3,
    "step-nav": 2,
    "hover-sync": 1,
});
const currentNavigationAction = ref(null);
let navigationActionSeq = 0;

const clearNavigationAction = (actionId) => {
    if (currentNavigationAction.value?.id === actionId) {
        currentNavigationAction.value = null;
    }
};
const scheduleNavigationFrame = (cb) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
        window.requestAnimationFrame(cb);
        return;
    }
    setTimeout(cb, 16);
};

const buildNavigationAction = (type, payload = {}) => ({
    id: `${type}-${Date.now()}-${++navigationActionSeq}`,
    type,
    priority: NAVIGATION_PRIORITIES[type] ?? 0,
    timestamp: navigationActionSeq,
    ...payload,
});

const canRunNavigationAction = (action) => {
    const current = currentNavigationAction.value;
    if (!current) return true;
    // hold-scroll 只作为长按期间的瞬时动作，不应阻塞后续普通导航
    if (current.type === "hold-scroll" && action.type !== "hold-scroll") {
        return true;
    }
    if (action.priority !== current.priority) {
        return action.priority > current.priority;
    }
    return action.timestamp >= current.timestamp;
};

const normalizeNavigationScrollOptions = (options = {}) => {
    const scrollMode = options.scrollMode ||
        (options.block === "center"
            ? "center-preferred"
            : options.block === "start" || options.block === "end"
              ? "edge-align"
              : "nearest");
    const edge =
        options.edge ||
        (options.block === "start" || options.block === "end"
            ? options.block
            : undefined);
    return {
        source: options.source || "keyboard",
        forceScroll: options.forceScroll === true,
        scrollMode,
        edge,
        block: options.block,
        revealRows: Math.max(0, Number(options.revealRows) || 0),
    };
};

const scrollActiveNodeIntoView = (index = activeIndex.value, options = {}) => {
    applyScrollToItemIndex(index, options);
};

const syncActiveIndexVisibility = (index = activeIndex.value, options = {}) => {
    nextTick(() => {
        if (!Array.isArray(props.showList) || props.showList.length === 0) return;
        const targetIndex = clampActiveIndex(index);
        applyScrollToItemIndex(targetIndex, {
            scrollMode: "nearest",
            ...options,
        });
    });
};

const syncShowListItemPatch = (itemId, patch = {}) => {
    if (!itemId || !patch || typeof patch !== "object") return;
    const showListItem = props.showList.find((item) => item.id === itemId);
    if (showListItem) {
        Object.assign(showListItem, patch);
    }
};

const syncShowListLockedState = (itemIds = [], locked) => {
    const idSet = new Set(Array.isArray(itemIds) ? itemIds.filter(Boolean) : []);
    if (!idSet.size) return;
    let changed = false;
    props.showList.forEach((item) => {
        if (idSet.has(item.id) && item.locked !== locked) {
            item.locked = locked;
            changed = true;
        }
    });
    if (changed) lockedRenderVersion.value++;
};

const shouldRefreshListAfterLockChange = () => props.lockFilter === "locked";

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

const setItemLockedState = (itemId, locked, skipFileWrite = false) => {
    if (!itemId || typeof window.setLock !== "function") return false;
    syncShowListLockedState([itemId], locked);
    const updated = measureOperation("set-item-lock", () =>
        window.setLock(itemId, locked, skipFileWrite),
    );
    if (!updated) {
        syncShowListLockedState([itemId], !locked);
    }
    return updated;
};

const setItemsLockedState = (itemIds = [], locked, skipFileWrite = false) => {
    const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
    if (!ids.length) return false;
    syncShowListLockedState(ids, locked);
    if (typeof window.setLocks === "function") {
        const updated = measureOperation("set-items-lock", () =>
            window.setLocks(ids, locked, skipFileWrite),
        );
        if (!updated) {
            syncShowListLockedState(ids, !locked);
        }
        return updated;
    }
    let changed = false;
    ids.forEach((itemId) => {
        changed = setItemLockedState(itemId, locked, skipFileWrite) || changed;
    });
    return changed;
};

const runNavigationScroll = (action, attempt = 0) => {
    if (currentNavigationAction.value?.id !== action.id) return;
    scrollActiveNodeIntoView(action.targetIndex, {
        scrollMode: action.scrollMode,
        edge: action.edge,
        block: action.block,
        forceScroll: action.forceScroll,
        revealRows: action.revealRows,
    });
    if (attempt >= 2 || action.type === "hold-scroll") {
        clearNavigationAction(action.id);
        return;
    }
    scheduleNavigationFrame(() => runNavigationScroll(action, attempt + 1));
};

const submitNavigationAction = (type, nextIndex, options = {}) => {
    if (!Array.isArray(props.showList) || props.showList.length === 0) {
        return false;
    }
    const targetIndex = clampActiveIndex(nextIndex);
    const action = buildNavigationAction(type, {
        targetIndex,
        ...normalizeNavigationScrollOptions(options),
    });
    if (!canRunNavigationAction(action)) {
        return false;
    }
    if (type !== "hover-sync") {
        hoverPreviewSuspendedByKeyboard.value = true;
    }
    currentNavigationAction.value = action;
    setActiveIndex(targetIndex);
    nextTick(() => {
        if (currentNavigationAction.value?.id !== action.id) return;
        runNavigationScroll(action, 0);
    });
    return true;
};

const setKeyboardActiveIndex = (nextIndex, options = {}) =>
    submitNavigationAction(
        options.actionType || "step-nav",
        nextIndex,
        options,
    );

const syncHoverActiveIndex = (nextIndex) =>
    submitNavigationAction("hover-sync", nextIndex, {
        source: "hover",
        scrollMode: "nearest",
    });

defineExpose({
    selectItemList, // 暴露给 Main/Switch中的操作按钮以执行复制
    emptySelectItemList,
    activeIndex, // 暴露当前高亮的索引
    setKeyboardActiveIndex, // 暴露设置高亮索引的方法
    syncActiveIndexVisibility,
    prepareDeleteRecovery: (anchor) => setDeleteAnchor(anchor),
    clearPendingStates, // 暴露清除待处理状态的方法
    // scrollToBottom, // 暴露滚动到底部的方法
    // scrollToTop, // 暴露滚动到顶部的方法
});

const getPageStep = () => {
    return virtualPageStep.value;
};

// 边界检测：是否在列表顶部
const isAtTopBoundary = () => {
    return activeIndex.value <= 0;
};

// 边界检测：是否在列表底部
const isAtBottomBoundary = () => {
    return activeIndex.value >= props.showList.length - 1;
};

const STEP_NAV_CENTER_OPTIONS = Object.freeze({
    actionType: "step-nav",
    scrollMode: "center-preferred",
});
const STEP_NAV_EDGE_START_OPTIONS = Object.freeze({
    actionType: "step-nav",
    scrollMode: "edge-align",
    edge: "start",
    forceScroll: true,
});
const STEP_NAV_EDGE_END_OPTIONS = Object.freeze({
    actionType: "step-nav",
    scrollMode: "edge-align",
    edge: "end",
    forceScroll: true,
});
// 上移：完全可见则不滚；确需滚动时做最小位移，并在上方留出 STEP_NAV_UP_REVEAL_ROWS 行上下文。
// 把该常量置 0 即回到“严格完全可见才不滚、不留余量”的语义。
const STEP_NAV_UP_REVEAL_ROWS = 1;
const STEP_NAV_UP_REVEAL_OPTIONS = Object.freeze({
    actionType: "step-nav",
    scrollMode: "nearest",
    forceScroll: false,
    revealRows: STEP_NAV_UP_REVEAL_ROWS,
});
const LOAD_RECOVERY_OPTIONS = Object.freeze({
    source: "load-more",
    scrollMode: "center-preferred",
    forceScroll: false,
});
const DELETE_RECOVERY_OPTIONS = Object.freeze({
    source: "delete",
    scrollMode: "center-preferred",
    forceScroll: false,
});
const getDeleteAnchorMeta = (itemsToDelete, options = {}) => {
    const force = options.force === true;
    const anchorItems = Array.isArray(options.anchorItems)
        ? options.anchorItems
        : itemsToDelete;
    const meta = computeDeleteAnchorMeta({
        showList: props.showList,
        activeIndex: activeIndex.value,
        isMultiple: props.isMultiple,
        selectedItems: selectItemList.value,
        itemsToDelete,
        anchorItems,
    });
    if (!force) {
        selectedItemIds.value = meta.toKeep?.map((item) => item.id) ?? [];
    }
    return meta;
};
const applyDeleteRecovery = (newList, anchor) => {
    if (!anchor || !Array.isArray(newList) || newList.length === 0) return;
    let nextIdx = Math.min(Math.max(0, anchor.anchorIndex), newList.length - 1);
    if (anchor.preferItemId) {
        const idx = newList.findIndex((item) => item.id === anchor.preferItemId);
        if (idx !== -1) nextIdx = idx;
    }
    submitNavigationAction("delete-recovery", nextIdx, DELETE_RECOVERY_OPTIONS);
};
const runLoadMoreRecovery = (oldLen, onNoMore, onLoaded) => {
    nextTick(() => {
        if (pendingNavAfterLoad.value === null) return;
        if (props.showList.length <= oldLen) {
            pendingNavAfterLoad.value = null;
            onNoMore?.();
            return;
        }
        const targetIndex = oldLen;
        pendingNavAfterLoad.value = null;
        onLoaded?.(targetIndex);
    });
};
const moveToNextItemFromIndex = (currentIndex) => {
    const nextIndex = Math.min(currentIndex + 1, props.showList.length - 1);
    if (nextIndex !== currentIndex) {
        setKeyboardActiveIndex(nextIndex, { ...STEP_NAV_CENTER_OPTIONS });
    }
};

const handleRowMouseLeave = (index) => {
    if (hoverPreviewTimer) {
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = null;
    }
    if (hoverRowIndex.value === index) {
        hoverRowIndex.value = null;
        if (hoverTriggeredPreview.value) {
            desktopPreviewManager.closeAllPreviews();
            stopImagePreview(true);
            clearFilePreviewImmediately();
            if (textPreviewHideTimer) {
                clearTimeout(textPreviewHideTimer);
                textPreviewHideTimer = null;
            }
            textPreview.value.show = false;
            hoverTriggeredPreview.value = false;
        } else if (imagePreviewSource.value === "hover") {
            stopImagePreview(true);
            clearFilePreviewImmediately();
        }
    }
};
// 监听activeIndex变化，在Shift长按状态下触发预览
watch(
    () => activeIndex.value,
    () => {
        if (keyboardTriggeredPreview.value) {
            triggerKeyboardPreview();
        }
        // 接近列表末尾时触发懒加载
        const LOAD_MORE_THRESHOLD = 5;
        if (activeIndex.value >= props.showList.length - LOAD_MORE_THRESHOLD) {
            emit("loadMore");
        }
    },
);

watch(
    () => props.showList.length,
    (newLen, oldLen) => {
        if (pendingNavAfterLoad.value == null || oldLen === undefined) return;
        const target = pendingNavAfterLoad.value;
        if (newLen > oldLen && target < newLen) {
            pendingNavAfterLoad.value = null;
            submitNavigationAction("load-recovery", target, {
                ...LOAD_RECOVERY_OPTIONS,
            });
        }
    },
);

// 监听 showList 变化：恢复多选/删除后的高亮（deleteAnchor 为唯一删除恢复入口）
watch(
    () => props.showList,
    (newList, oldList) => {
        if (!newList || !oldList || newList === oldList) return;
        restoreSelection();
        const anchor = deleteAnchor.value;
        deleteAnchor.value = null;
        if (anchor) {
            applyDeleteRecovery(newList, anchor);
            return;
        }
        setActiveIndex(activeIndex.value);
        syncActiveIndexVisibility(activeIndex.value);
    },
);

function registerListHotkeyFeatures() {
    const getCanDeleteItem = (e, forceDelete) => {
        const searchInput = document.querySelector(".clip-search-input");
        const isSearchInputFocused = document.activeElement === searchInput;
        const isDeleteKey = e.key === "Delete";
        const isBackspaceKey = e.key === "Backspace";
        if (forceDelete) return true;
        if (
            isDeleteKey &&
            (e.shouldDeleteItem ||
                !isSearchInputFocused ||
                (isSearchInputFocused &&
                    searchInput &&
                    searchInput.selectionStart === searchInput.selectionEnd &&
                    searchInput.selectionStart === searchInput.value.length))
        )
            return true;
        if (isBackspaceKey && !isSearchInputFocused) return true;
        return false;
    };

    const handleListNavUpCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (e?.repeat) {
            startAutoScroll("up");
            return true;
        }

        // 边界检测：如果在顶部，停止移动并确保可见
        if (activeIndex.value <= 0) {
            setKeyboardActiveIndex(0, { ...STEP_NAV_EDGE_START_OPTIONS });
            return true;
        }

        // 正常向上移动：完全可见则不滚（底部锚点不动，只移光标）；确需滚动时最小位移并在上方留出一行。
        const nextIdx = activeIndex.value - 1;
        if (nextIdx <= 0) {
            return setKeyboardActiveIndex(nextIdx, {
                ...STEP_NAV_EDGE_START_OPTIONS,
            });
        }
        return setKeyboardActiveIndex(nextIdx, { ...STEP_NAV_UP_REVEAL_OPTIONS });
    };
    const handleListNavDownCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (e?.repeat) {
            startAutoScroll("down");
            return true;
        }
        if (props.showList.length === 0) {
            return true;
        }

        // 边界检测：如果在底部，先尝试加载更多数据
        if (isAtBottomBoundary()) {
            // 尝试加载更多数据
            const oldLen = props.showList.length;
            setPendingNavAfterLoad(oldLen);
            emit("loadMore");
            runLoadMoreRecovery(
                oldLen,
                () => {
                    const lastIndex = props.showList.length - 1;
                    setKeyboardActiveIndex(lastIndex, { ...STEP_NAV_EDGE_END_OPTIONS });
                },
                (targetIndex) => {
                    submitNavigationAction("load-recovery", targetIndex, {
                        ...LOAD_RECOVERY_OPTIONS,
                    });
                },
            );
            return true;
        }

        // 正常移动一个item；目标为末项时用底对齐，避免 center 裁切
        const nextIdx = activeIndex.value + 1;
        const lastI = props.showList.length - 1;
        if (nextIdx >= lastI) {
            return setKeyboardActiveIndex(nextIdx, { ...STEP_NAV_EDGE_END_OPTIONS });
        }
        return setKeyboardActiveIndex(nextIdx, { ...STEP_NAV_CENTER_OPTIONS });
    };
    const handleListPageUpCommand = () => {
        return runPageNavigation("up");
    };
    const handleListPageDownCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (isFocusInSearch()) return false;
        if (props.showList.length === 0) return false;

        return runPageNavigation("down");
    };
    const handleListNavLeftCommand = () => {
        if (isAliasDialogOpen()) return false;
        return setKeyboardActiveIndex(activeIndex.value - 1);
    };
    const handleListScrollToBottomCommand = () => {
        if (isAliasDialogOpen()) return false;
        return setKeyboardActiveIndex(props.showList.length - 1, {
            actionType: "page-nav",
            scrollMode: "edge-align",
            edge: "end",
            forceScroll: true,
        });
    };
    const handleListScrollToTopCommand = () => {
        if (isAliasDialogOpen()) return false;
        return setKeyboardActiveIndex(0, {
            actionType: "page-nav",
            scrollMode: "edge-align",
            edge: "start",
            forceScroll: true,
        });
    };
    const handleTextPreviewScrollUpCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        return handlePreviewScrollShortcut("up", e);
    };
    const handleTextPreviewScrollDownCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        return handlePreviewScrollShortcut("down", e);
    };
    const handleImagePreviewScrollLeftCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        return handlePreviewScrollShortcut("left", e);
    };
    const handleImagePreviewScrollRightCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        return handlePreviewScrollShortcut("right", e);
    };
    const isFocusInSearch = () => {
        const el = document.activeElement;
        return el && (el.classList?.contains("clip-search-input") || el.closest?.(".clip-search"));
    };
    const handleListViewFullCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (isFocusInSearch()) return false;
        const item = props.showList[activeIndex.value];
        if (item?.__pinGroup) {
            emit("editPinGroup");
            return true;
        }
        if (item) {
            emit("onDataChange", item);
            return true;
        }
        return false;
    };
    const handleListDrawerOpenCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (isFocusInSearch()) return false;
        openDrawerForCurrentItem();
        return true;
    };
    const handleListPreviewShiftCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (props.isMultiple) isShiftDown.value = true;
        handleShiftKeyDown();
        return {
            handled: true,
            preventDefault: false,
            stopPropagation: false,
        };
    };
    const handleListMultiToggleCurrentCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (props.isSearchPanelExpand) return false;
        if (!props.isMultiple) emit("toggleMultiSelect", true);
        const currentItem = props.showList[activeIndex.value];
        if (!currentItem) return true;
        if (selectedItemIdSet.value.has(currentItem.id)) {
            removeSelectedItemById(currentItem.id);
        } else {
            appendSelectedItems([currentItem]);
            setKeyboardActiveIndex(activeIndex.value + 1, {
                actionType: "step-nav",
                scrollMode: "center-preferred",
            });
        }
        return true;
    };
    const handleListCopyOnlyCommand = () => {
        if (isAliasDialogOpen()) return false;
        if (props.fullData.data) {
            emit("onMultiCopyExecute", {
                paste: false,
                persist: true,
                exit: true,
            });
            return true;
        }
        if (!props.isMultiple && props.showList[activeIndex.value]) {
            copyAndPasteAndExit(props.showList[activeIndex.value], {
                paste: false,
                respectImageCopyGuard: true,
            });
            ElMessage({ message: "澶嶅埗鎴愬姛", type: "success" });
            return true;
        }
        return false;
    };
    const handleListTextLineOperationCommand = (e, operation) => {
        if (isAliasDialogOpen()) return false;
        if (isFocusInSearch()) return false;
        if (e && (e.isComposing || e.key === "Process")) return false;
        const item = props.showList[activeIndex.value];
        if (!item) {
            ElMessage({ type: "info", message: "当前无可处理条目" });
            return false;
        }
        return handleOperateClick(operation, item, { fromShortcut: true }) !== false;
    };
    const handleListLineJoinCommand = (e) => {
        return handleListTextLineOperationCommand(e, { id: "line-join", title: "行拼接" });
    };
    const handleListLineSurroundJoinCommand = (e) => {
        return handleListTextLineOperationCommand(e, { id: "line-surround-join", title: "包围再拼接" });
    };
    const handleListLineSurroundCommand = (e) => {
        return handleListTextLineOperationCommand(e, { id: "line-surround", title: "只包围" });
    };
    const handleListCopyPasteCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (e && (e.isComposing || e.key === "Process")) return false;
        if (props.isMultiple) {
            emit("onMultiCopyExecute", {
                paste: false,
                persist: true,
                exit: true,
            });
            return true;
        }
        if (props.showList[activeIndex.value]?.__pinGroup) {
            emit("pastePinGroupAll");
            return true;
        }
        if (props.showList[activeIndex.value])
            copyAndPasteAndExit(props.showList[activeIndex.value], {
                respectImageCopyGuard: true,
            });
        return true;
    };
    const handleListAliasPasteCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (e && (e.isComposing || e.key === "Process")) return false;
        if (props.isMultiple && selectItemList.value.length) {
            emit("onMultiCopyExecute", {
                paste: true,
                persist: true,
                exit: true,
            });
            return true;
        }
        const item = props.showList[activeIndex.value];
        if (!item) {
            ElMessage({ type: "info", message: "当前无可操作条目" });
            return false;
        }
        const alias = getItemAlias(item);
        const singleFilePath = parseSingleFilePath(item);
        if (singleFilePath && alias) {
            const ok = copySingleFileWithAliasAndPaste(item, alias);
            if (ok) {
                ElMessage({ type: "success", message: "已按别名重命名并粘贴" });
            } else {
                ElMessage({ type: "warning", message: "别名粘贴失败，已回退默认粘贴" });
                copyAndPasteAndExit(item, { respectImageCopyGuard: true });
            }
            return true;
        }
        if (item.type === "image" && alias) {
            // console.log("[alias-paste] list-save-by-alias: image+alias branch enter", {
            //     alias,
            //     hasData: Boolean(item?.data),
            //     dataPreview:
            //         typeof item?.data === "string"
            //             ? item.data.slice(0, 80) + (item.data.length > 80 ? "…" : "")
            //             : item?.data,
            // });
            const ok = copyImageWithAliasAndPaste(item, alias);
            if (ok) {
                // console.log("[alias-paste] list-save-by-alias: image-alias path success (temp file + copyFile)");
                ElMessage({ type: "success", message: "已按别名生成图片文件并粘贴" });
            } else {
                // console.log(
                //     "[alias-paste] list-save-by-alias: image-alias failed -> fallback copyAndPasteAndExit (clipboard image, not temp file name)",
                // );
                ElMessage({ type: "info", message: "图片文件别名粘贴失败，回退为普通图片粘贴" });
                copyAndPasteAndExit(item, { respectImageCopyGuard: true });
            }
            return true;
        }
        if (singleFilePath && !alias) {
            ElMessage({ type: "info", message: "当前无别名，按默认方式粘贴" });
        }
        copyAndPasteAndExit(item, { respectImageCopyGuard: true });
        return true;
    };
    const handleListTagEditCommand = () => {
        const item = props.showList[activeIndex.value];
        if (!item) {
            ElMessage({ type: "info", message: "当前无可操作条目" });
            return false;
        }
        if (window.db && window.db.isCollected(item.id)) {
            emit("openTagEdit", item);
            return true;
        }
        return saveAliasForItem(item);
    };
    const handleListCopyPasteAndLockCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (e && (e.isComposing || e.key === "Process")) return false;
        if (!props.isMultiple && props.showList[activeIndex.value]) {
            const current = props.showList[activeIndex.value];
            setItemLockedState(current.id, true);
            copyAndPasteAndExit(current, { respectImageCopyGuard: true });
            return true;
        }
        if (props.isMultiple && selectItemList.value.length) {
            emit("onMultiCopyExecute", {
                paste: true,
                persist: true,
                exit: true,
            });
            return true;
        }
        return false;
    };
    const handleListPinToggleCommand = () => {
        if (isAliasDialogOpen()) return false;
        const item = props.showList[activeIndex.value];
        if (!item) {
            ElMessage({ type: "info", message: "当前无可置顶条目" });
            return false;
        }
        emit("togglePin", item);
        return true;
    };
    const handleListCollectCommand = () => {
        if (isAliasDialogOpen()) return false;
        const targets =
            props.isMultiple && selectItemList.value.length
                ? [...selectItemList.value]
                : props.showList[activeIndex.value]
                  ? [props.showList[activeIndex.value]]
                  : [];
        targets.forEach((item) => {
            const isCollected = window.db.isCollected(item.id);
            if (props.currentActiveTab === "collect" || isCollected)
                window.db.removeCollect(item.id);
            else window.db.addCollect(item.id);
            const newCollectedState = !(props.currentActiveTab === "collect" || isCollected);
            // 直接在 showList 中查找并修改对应的 item 对象
            const showListItem = props.showList.find((i) => i.id === item.id);
            if (showListItem) {
                showListItem.collected = newCollectedState;
            }
        });
        if (targets.length) {
            ElMessage({
                type: "success",
                message:
                    props.currentActiveTab === "collect"
                        ? "已取消收藏选中项"
                        : "已更新收藏状态",
            });
            emit("onDataRemove");
        }
        return true;
    };
    const handleListLockCommand = () => {
        if (isAliasDialogOpen()) return false;
        const targets =
            props.isMultiple && selectItemList.value.length
                ? [...selectItemList.value]
                : props.showList[activeIndex.value]
                  ? [props.showList[activeIndex.value]]
                  : [];
        if (props.isMultiple && targets.length) {
            preserveSelection();
            const shouldLock = !allSelectedLocked.value;
            setItemsLockedState(
                targets.map((item) => item.id),
                shouldLock,
            );
            allSelectedLocked.value = shouldLock;
        } else {
            targets.forEach((item) => {
                const shouldLock = item.locked !== true;
                setItemLockedState(item.id, shouldLock);
            });
        }
        if (targets.length && shouldRefreshListAfterLockChange()) {
            emit("onDataRemove");
        }
        return true;
    };
    const handleListDeleteCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        if (!getCanDeleteItem(e, false)) return false;
        const itemsToDelete = props.isMultiple
            ? selectItemList.value.length
                ? [...selectItemList.value]
                : props.showList[activeIndex.value]
                  ? [props.showList[activeIndex.value]]
                  : []
            : props.showList[activeIndex.value]
              ? [props.showList[activeIndex.value]]
              : [];
        const deletableItems = itemsToDelete.filter(
            (item) => item.locked !== true,
        );
        const skippedLocked = itemsToDelete.length - deletableItems.length;
        if (deletableItems.length) {
            const deleteMeta = getDeleteAnchorMeta(deletableItems, {
                force: false,
                anchorItems: itemsToDelete,
            });
            if (props.isMultiple && deleteMeta.toKeep) {
                replaceSelectedItems(deleteMeta.toKeep);
            }
            setDeleteAnchor(deleteMeta.anchor);
            if (props.isMultiple && deletableItems.length > 1) {
                emit("onItemsDelete", deletableItems, buildDeleteEventMeta({
                    activeIndex: activeIndex.value,
                    anchor: deleteMeta.anchor,
                    force: false,
                }));
            } else {
                emit("onItemDelete", deletableItems[0], {
                    anchorIndex: activeIndex.value,
                    preferItemId: deleteMeta.anchor.preferItemId,
                    isBatch: false,
                    isLast: true,
                    force: false,
                });
            }
        }
        if (skippedLocked > 0)
            ElMessage({
                type: "info",
                message: `已跳过锁定 ${skippedLocked} 条，使用 ${formatShortcutDisplay("c-del")} / ${formatShortcutDisplay("c-backspace")} 强制删除`,
            });
        return true;
    };
    const handleListForceDeleteCommand = (e) => {
        if (isAliasDialogOpen()) return false;
        const itemsToDelete = props.isMultiple
            ? selectItemList.value.length
                ? [...selectItemList.value]
                : props.showList[activeIndex.value]
                  ? [props.showList[activeIndex.value]]
                  : []
            : props.showList[activeIndex.value]
              ? [props.showList[activeIndex.value]]
              : [];
        if (itemsToDelete.some((item) => item?.__pinGroup)) {
            emit("clearPinGroup");
            return true;
        }
        if (itemsToDelete.length) {
            const deleteMeta = getDeleteAnchorMeta(itemsToDelete, { force: true });
            if (props.isMultiple) {
                setDeleteAnchor(deleteMeta.anchor);
                replaceSelectedItems(deleteMeta.toKeep);
                emit("onItemsDelete", itemsToDelete, buildDeleteEventMeta({
                    activeIndex: activeIndex.value,
                    anchor: deleteMeta.anchor,
                    force: true,
                }));
                replaceSelectedItems([]);
                emit("toggleMultiSelect", false);
            } else {
                setDeleteAnchor(deleteMeta.anchor);
                itemsToDelete.forEach((item, index) =>
                    emit("onItemDelete", item, {
                        anchorIndex: activeIndex.value,
                        preferItemId: deleteMeta.anchor.preferItemId,
                        isBatch: false,
                        isLast: true,
                        force: true,
                    }),
                );
            }
            return true;
        }
        return false;
    };
    const listCommandPairs = [
        { featureId: "list-nav-up", commandId: "list.navigate.up", handler: handleListNavUpCommand },
        { featureId: "list-nav-down", commandId: "list.navigate.down", handler: handleListNavDownCommand },
        { featureId: "list-page-up", commandId: "list.navigate.pageUp", handler: handleListPageUpCommand },
        { featureId: "list-page-down", commandId: "list.navigate.pageDown", handler: handleListPageDownCommand },
        { featureId: "list-nav-left", commandId: "list.navigate.left", handler: handleListNavLeftCommand },
        { featureId: "list-scroll-to-bottom", commandId: "list.navigate.bottom", handler: handleListScrollToBottomCommand },
        { featureId: "list-scroll-to-top", commandId: "list.navigate.top", handler: handleListScrollToTopCommand },
        { featureId: "text-preview-scroll-up", commandId: "list.preview.text.up", handler: handleTextPreviewScrollUpCommand },
        { featureId: "text-preview-scroll-down", commandId: "list.preview.text.down", handler: handleTextPreviewScrollDownCommand },
        { featureId: "image-preview-scroll-left", commandId: "list.preview.image.left", handler: handleImagePreviewScrollLeftCommand },
        { featureId: "image-preview-scroll-right", commandId: "list.preview.image.right", handler: handleImagePreviewScrollRightCommand },
        { featureId: "list-view-full", commandId: "list.item.openFull", handler: handleListViewFullCommand },
        { featureId: "list-drawer-open", commandId: "list.item.openDrawer", handler: handleListDrawerOpenCommand },
        { featureId: "list-shift", commandId: "list.preview.shift", handler: handleListPreviewShiftCommand },
        { featureId: "list-space", commandId: "list.multi.toggleCurrent", handler: handleListMultiToggleCurrentCommand },
        { featureId: "list-copy", commandId: "list.item.copyOnly", handler: handleListCopyOnlyCommand },
        { featureId: "list-line-join", commandId: "list.item.joinLines", handler: handleListLineJoinCommand },
        { featureId: "list-line-surround-join", commandId: "list.item.surroundJoinLines", handler: handleListLineSurroundJoinCommand },
        { featureId: "list-line-surround", commandId: "list.item.surroundLines", handler: handleListLineSurroundCommand },
        { featureId: "list-enter", commandId: "list.item.copyPaste", handler: handleListCopyPasteCommand },
        { featureId: "list-save-by-alias", commandId: "list.item.aliasPaste", handler: handleListAliasPasteCommand },
        { featureId: "list-tag-edit", commandId: "list.item.editTagOrAlias", handler: handleListTagEditCommand },
        { featureId: "list-ctrl-enter", commandId: "list.item.copyPasteAndLock", handler: handleListCopyPasteAndLockCommand },
        { featureId: "list-pin-toggle", commandId: "list.item.pinToggle", handler: handleListPinToggleCommand },
        { featureId: "list-collect", commandId: "list.item.collectToggle", handler: handleListCollectCommand },
        { featureId: "list-lock", commandId: "list.item.lockToggle", handler: handleListLockCommand },
        { featureId: "list-delete", commandId: "list.item.delete", handler: handleListDeleteCommand },
        { featureId: "list-force-delete", commandId: "list.item.forceDelete", handler: handleListForceDeleteCommand },
    ];
    for (let n = 1; n <= 9; n++) {
        const num = n;
        listCommandPairs.push({
            featureId: `list-quick-copy-${num}`,
            commandId: `list.quickCopy.${num}`,
            handler: () => {
                if (isAliasDialogOpen()) return false;
                const targetItem = props.showList[num - 1];
                if (targetItem) {
                    copyAndPasteAndExit(targetItem, {
                        respectImageCopyGuard: true,
                    });
                    replaceSelectedItems([]);
                    return true;
                }
                return false;
            },
        });
    }
    for (let n = 1; n <= 9; n++) {
        const num = n;
        listCommandPairs.push({
            featureId: `list-drawer-sub-${num}`,
            commandId: `list.drawerSub.${num}`,
            handler: () => {
                if (isAliasDialogOpen()) return false;
                const currentItem = props.showList[activeIndex.value];
                if (!currentItem) return false;
                const menu = getDrawerFullMenuItems(currentItem);
                const result = getContextMenuActionByIndex(menu, num);
                if (!result.ok) {
                    ElMessage({ type: "info", message: "该序号无可执行操作" });
                    return false;
                }
                handleDrawerSelect(result.action, { sub: false, fromShortcut: true });
                return true;
            },
        });
    }
    disposeListCommandHandlers = registerCommandFeaturePairs(listCommandPairs);
}

// 长按方向键：先逐条移动，重复后按页加速滚动
const startAutoScroll = (direction) => {
    if (autoScrollDirection.value && autoScrollDirection.value !== direction) {
        stopAutoScroll();
    }
    if (autoScrollTimer.value || autoScrollDirection.value === direction) return;

    autoScrollDirection.value = direction;
    autoScrollSpeed.value = 100; // 重置速度

    const scroll = () => {
        if (direction === "up") {
            if (activeIndex.value > 0) {
                runPageNavigation("up", { center: true, forceScroll: false });
            } else {
                stopAutoScroll();
                return;
            }
        } else if (direction === "down") {
            if (activeIndex.value < props.showList.length - 1) {
                runPageNavigation("down", { center: true, forceScroll: false });
            } else {
                const oldLen = props.showList.length;
                hoverPreviewSuspendedByKeyboard.value = true;
                setPendingNavAfterLoad(oldLen);
                emit("loadMore");
                runLoadMoreRecovery(
                    oldLen,
                    () => {
                        const targetIndex = scrollHalfPage(direction, activeIndex.value);
                        submitNavigationAction("hold-scroll", targetIndex, {
                            source: "hold-scroll",
                            scrollMode: "center-preferred",
                            forceScroll: false,
                        });
                        stopAutoScroll();
                    },
                    () => {
                        autoScrollTimer.value = setTimeout(scroll, autoScrollSpeed.value);
                    },
                );
                return;
            }
        }

        autoScrollSpeed.value = Math.max(
            30,
            Math.floor(autoScrollSpeed.value / autoScrollAcceleration.value),
        );
        autoScrollTimer.value = setTimeout(scroll, autoScrollSpeed.value);
    };

    autoScrollTimer.value = setTimeout(scroll, AUTO_SCROLL_INITIAL_DELAY);
};

const stopAutoScroll = () => {
    if (autoScrollTimer.value) {
        clearTimeout(autoScrollTimer.value);
        autoScrollTimer.value = null;
    }
    if (currentNavigationAction.value?.type === "hold-scroll") {
        currentNavigationAction.value = null;
    }
    autoScrollDirection.value = null;
    autoScrollSpeed.value = 100;
};

const runPageNavigation = (direction, options = {}) => {
    if (options.center) {
        const targetIndex = getPageTargetIndex(direction, activeIndex.value);
        return submitNavigationAction("hold-scroll", targetIndex, {
            source: "hold-scroll",
            scrollMode: "center-preferred",
            forceScroll: options.forceScroll === true,
        });
    }
    const targetIndex = scrollByPage(direction, activeIndex.value);
    return submitNavigationAction("page-nav", targetIndex, {
        source: "page-nav",
        scrollMode: "edge-align",
        edge: direction === "up" ? "start" : "end",
        forceScroll: true,
    });
};

// 长文本预览相关
const unifiedKeyHandler = (e) => {
    if (e.__hotkeyHandled) return;

    const { key, repeat } = e;
    const isShift = key === "Shift";
    const previewDirectionMap = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
    };
    const previewDirection = previewDirectionMap[key];

    if (hasActiveShiftPreview() && isPureShiftPreviewEvent(e) && previewDirection) {
        if (handlePreviewScrollShortcut(previewDirection, e)) {
            e.preventDefault();
            e.stopPropagation();
            e.__hotkeyHandled = true;
        }
        return;
    }

    if (isShiftPreviewCancelModifier(e)) {
        handleShiftKeyUp();
        return;
    }

    // 聚焦到预览窗口
    if (isShift) {
        if (isAliasDialogOpen()) return;
        if (isPureShiftPreviewEvent(e) && !repeat && !shiftKeyTimer) {
            // Shift键按下，启动预览计时
            if (props.isMultiple) isShiftDown.value = true;
            handleShiftKeyDown();
        }
        return; // 不阻止默认行为，让hotkeyRegistry处理
    }
};

const unifiedKeyReleaseHandler = (e) => {
    if (e.__hotkeyHandled) return;
    
    const { key } = e;
    const isShift = key === "Shift";
    const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key);
    
    // 使用统一的图片预览逻辑
    if (isShift) {
        handleShiftKeyUp();
        return;
    }

    if (isArrow) {
        resetPreviewScrollHold();
        stopAutoScroll();
    }
};

// 绐楀彛澶辩劍鏃堕殣钘忔墍鏈夐瑙?
const handleWindowBlur = () => {
    if (window.__isExitingPlugin) return;
    resetTransientPreviewState();
    stopAutoScroll();
    // 文字预览半透明黑色背景，居中显示
    if (shiftKeyTimer) {
        clearTimeout(shiftKeyTimer);
        shiftKeyTimer = null;
    }
    if (keyboardTriggeredPreview.value) {
        keyboardTriggeredPreview.value = false;
        hoverTriggeredPreview.value = false;
        stopImagePreview(true);
        hideTextPreview();
        clearFilePreviewImmediately();
    }
};

onMounted(() => {
    refreshAliasMap();
    applyHoverPreviewConfig(setting);
    registerListHotkeyFeatures();
    // 移除延时隐藏，文字预览只在Shift键释放时隐藏
    document.addEventListener("keydown", unifiedKeyHandler, true);
    document.addEventListener("keyup", unifiedKeyReleaseHandler, true);
    window.addEventListener(SETTING_UPDATED_EVENT, handleSettingUpdated);
    window.addEventListener("blur", handleWindowBlur);

    // 方向键或点击后挂起悬浮高亮与悬浮预览，必须等真实鼠标移动后再恢复
    if (listRootRef.value) {
        const resizeObserver = new ResizeObserver(() => {
            // getPageStep 每次实时取 clientHeight，此处无需额外缓存
        });
        resizeObserver.observe(listRootRef.value);
        // 降级方案：使用 DOM scrollIntoView
        listRootRef.value._resizeObserver = resizeObserver;
    }
});

onUnmounted(() => {
    // 从不同行移入时停止上一行的 hover 预览，避免同一行内移动造成闪烁
    disposeListCommandHandlers?.();
    disposeListCommandHandlers = null;
    document.removeEventListener("keydown", unifiedKeyHandler, true);
    document.removeEventListener("keyup", unifiedKeyReleaseHandler, true);
    window.removeEventListener(SETTING_UPDATED_EVENT, handleSettingUpdated);
    window.removeEventListener("blur", handleWindowBlur);
    
    // 行级悬浮预览；方向键生效后的第一次移入也不启动
    stopAutoScroll();
    
    // 清理图片预览定时器
    if (imagePreviewHideTimer) {
        clearTimeout(imagePreviewHideTimer);
        imagePreviewHideTimer = null;
    }

    // 虚拟列表 scrollToIndex 的 align：start / center / end
    if (listRootRef.value?._resizeObserver) {
        listRootRef.value._resizeObserver.disconnect();
        listRootRef.value._resizeObserver = null;
    }
    resetTransientPreviewState();
});
</script>

<style lang="less" scoped>
@import "../style";

/* flex:1 + min-height:0 让列表在 .main 纵向 flex 中拿到确定高度；缺 min-height:0 时 flex 子项不会收缩，
   .clip-item-scroll 就不会产生溢出，滚动会退化到 document（见 EM-2026-04-06-scroll-path）。 */
.clip-item-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

/* 滚动区吃掉剩余高度，空态占位仍留在其下方可见 */
.scroller {
    flex: 1 1 auto;
    min-height: 0;
}

.empty-placeholder {
    flex: none;
}

.clip-item-scroll {
    overflow-y: auto;
    overflow-x: hidden;
}

.clip-item-list-body {
    width: 100%;
}

.clip-item-list-row {
    width: 100%;
    padding: 4px 8px 0;
    box-sizing: border-box;
}

.text-preview-modal {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
    background: transparent;
    overflow: hidden;

    /* 灰色遮罩约 95% 不透明度，仅包住文本区域；超长时由 max-height + 内部滚动承担 */
    .text-preview-panel {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        box-sizing: border-box;
        padding: 24px 28px;
        min-height: 0;
        max-height: 80vh;
        width: auto;
        border-radius: 12px;
        border: 1px solid rgba(100, 110, 128, 0.55);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
        font-size: 14px;
        line-height: 1.5;
        background: rgba(118, 124, 138, 0.95);

        &.is-wrap-text {
            border-radius: 14px;
        }
    }

    .text-preview-content {
        white-space: pre-wrap;
        word-break: break-word;
        width: 100%;
        min-height: 0;
        -webkit-font-smoothing: antialiased;

        flex: 0 1 auto;
        max-height: calc(80vh - 56px);
        overflow-y: auto;

        &.is-table {
            white-space: normal;
            word-break: normal;
            overflow-x: auto;
        }

        &.is-structured,
        &.is-html {
            white-space: normal;
            word-break: break-word;
            overflow-x: auto;
        }
    }

    .text-preview-sheet,
    .text-preview-note {
        margin-bottom: 8px;
        color: rgba(255, 255, 255, 0.78);
        font-size: 12px;
        line-height: 1.4;
    }

    .text-preview-note {
        margin-top: 8px;
        margin-bottom: 0;
    }

    .text-preview-table {
        min-width: max-content;
        border-collapse: collapse;
        color: #f8fafc;
        font-size: 12px;
        line-height: 1.35;

        td {
            max-width: 220px;
            min-width: 76px;
            padding: 6px 8px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(255, 255, 255, 0.08);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    .text-preview-structured-tree {
        min-width: min(100%, 520px);
        padding: 8px 0;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
    }

    .text-preview-structured-row {
        display: flex;
        min-width: 0;
        align-items: baseline;
        gap: 5px;
        padding: 3px 10px 3px calc(10px + var(--depth, 0) * 14px);
        color: #f8fafc;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        line-height: 1.5;
        word-break: break-word;

        &.is-container {
            color: rgba(226, 232, 240, 0.9);
            font-weight: 600;
        }

        &.is-string .text-preview-structured-value {
            color: #86efac;
        }

        &.is-number .text-preview-structured-value {
            color: #fdba74;
        }

        &.is-boolean .text-preview-structured-value {
            color: #93c5fd;
        }

        &.is-null .text-preview-structured-value {
            color: rgba(226, 232, 240, 0.62);
            font-style: italic;
        }
    }

    .text-preview-structured-key {
        flex-shrink: 0;
        color: #bfdbfe;
        font-weight: 600;
    }

    .text-preview-structured-colon {
        flex-shrink: 0;
        color: rgba(226, 232, 240, 0.62);
    }

    .text-preview-structured-value {
        min-width: 0;
    }

    .text-preview-html {
        color: #f8fafc;
        font-size: 14px;
        line-height: 1.65;

        :deep(h1),
        :deep(h2),
        :deep(h3) {
            margin: 0.8em 0 0.45em;
            line-height: 1.25;
        }

        :deep(p),
        :deep(ul),
        :deep(ol),
        :deep(pre),
        :deep(blockquote) {
            margin: 0 0 0.75em;
        }

        :deep(pre),
        :deep(code) {
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.1);
        }

        :deep(pre) {
            overflow: auto;
            padding: 10px;
        }
    }
}

:global(html[data-theme='dark']) .text-preview-modal .text-preview-panel {
    background: rgba(48, 54, 68, 0.95);
    border-color: rgba(200, 210, 230, 0.28);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
}

.image-preview-modal {
    .image-preview-content {
        flex: 1;
        min-height: 0;
        width: 100%;
        overflow-y: auto;
        overflow-x: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.78) rgba(255, 255, 255, 0.16);
        // 使用 transform 将滚动条移到左侧和上侧
        transform: rotate(180deg);
        
        &::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        
        &::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.16);
            border-radius: 5px;
        }
        
        &::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.78);
            border-radius: 5px;
            border: 2px solid rgba(0, 0, 0, 0.55);
            
            &:hover {
                background: rgba(255, 255, 255, 0.95);
            }
        }
    }

    .image-preview-inner {
        width: 100%;
        display: flex;
        justify-content: center;
        // 再旋转回来保持正常显示
        transform: rotate(180deg);

        &.is-centered {
            align-items: center;
        }

        &.is-scroll {
            align-items: flex-start;
        }

        &.is-fit-width-scroll {
            justify-content: center;
        }

        &.is-fit-height-scroll {
            align-items: center;
            justify-content: flex-start;
        }
    }

    .image-preview-footer {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        white-space: pre-wrap;
        word-break: break-all;
        text-align: center;
    }
    .image-preview-footer-main {
        max-width: min(90vw, 880px);
    }
    .preview-error {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        color: #ef4444;
        font-size: 16px;
        font-weight: 500;
        text-align: center;
        transform: rotate(180deg);
    }
}

.image-preview-toolbar-hint {
    position: fixed;
    top: 4px;
    right: 8px;
    z-index: 10000;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.22);
    color: rgba(255, 255, 255, 0.94);
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    pointer-events: none;
}
</style>
