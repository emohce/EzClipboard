<template>
    <div
        class="clip-item"
        :data-index="index"
        :class="{
            active: !isMultiple && isActive,
            'multi-active': isMultiple && isActive,
            select: isSelected,
            'clip-item--compact': isCompact,
            'clip-item--has-image': displayType === 'image',
            'clip-item--pin-group': item.__pinGroup,
        }"
        :aria-selected="isActive"
        role="option"
        @click.left="emit('row-click-left', $event)"
        @click.right="emit('row-click-right', $event)"
        @mouseenter.prevent="emit('row-mouseenter', $event)"
        @mouseleave="emit('row-mouseleave')"
    >
        <div class="clip-info">
            <div class="clip-time">
                <span
                    v-if="isMultiple && isSelected"
                    class="clip-multi-check"
                    aria-hidden="true"
                    >✓</span
                >
                <span
                    v-if="isPinned || isCollected || item.locked"
                    class="clip-status-icons"
                >
                    <span
                        v-if="isPinned"
                        class="clip-pin-icon"
                        title="已置顶"
                        aria-label="已置顶"
                    >📌</span>
                    <span v-if="isCollected" class="clip-collect-icon">⭐</span>
                    <span
                        v-if="item.locked"
                        class="clip-lock"
                        >🔒</span
                    >
                </span>
                <span v-if="item.__pinGroup" class="clip-pin-group-icon" aria-hidden="true">⧉</span>
                <span class="relative-date">{{ dateFormat(item.updateTime) }}</span>
                <div v-if="itemTags.length" class="clip-tags">
                    <span
                        v-for="tag in itemTags"
                        :key="`${item.id}-${tag}`"
                        class="clip-tag"
                        >{{ tag }}</span
                    >
                </div>
            </div>
            <div class="clip-data">
                <template v-if="item.__pinGroup">
                    <div class="clip-pin-group-data">
                        <div class="clip-pin-group-copy">
                            <div class="clip-pin-group-summary">
                                <div
                                    v-for="(line, index) in pinGroupPreviewLines"
                                    :key="`${index}-${line.name}`"
                                    class="clip-pin-group-line"
                                >
                                    <span
                                        v-if="line.type"
                                        class="clip-pin-group-type"
                                    >
                                        {{ line.type }}
                                    </span>
                                    <span class="clip-pin-group-name">{{ line.name }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
                <template v-else-if="item.type === 'text'">
                    <div v-if="isCompact" class="clip-data-one-line">
                        <span v-if="hasAlias" class="clip-alias-primary">{{ itemAlias }}</span>
                        <span v-if="hasAlias" class="clip-alias-secondary">{{ textSingleLine }}</span>
                        <span
                            v-if="isPreviewableText && !hasAlias"
                            class="clip-data-preview-tag"
                        >
                            L
                        </span>
                        <span
                            v-if="!hasAlias"
                            class="clip-data-one-line-text"
                            :class="{
                                'clip-data-one-line-text--previewable': isPreviewableText,
                            }"
                        >
                            {{ textSingleLine }}
                        </span>
                    </div>
                    <div
                        v-else
                        :class="{ 'clip-over-sized-content': isOverSizedContent(item) }"
                    >
                        <div v-if="hasAlias" class="clip-alias-primary">{{ itemAlias }}</div>
                        <div v-if="hasAlias" class="clip-alias-secondary">{{ textPreviewContent }}</div>
                        <template v-else>{{ textPreviewContent }}</template>
                    </div>
                </template>
                <template v-else-if="displayType === 'image'">
                    <div class="image-container" @click="handleImageClick">
                        <div v-if="hasAlias" class="clip-image-alias-left">
                            <div class="clip-alias-primary">{{ itemAlias }}</div>
                            <div class="clip-alias-secondary">{{ imageInfoLine }}</div>
                        </div>
                        <div class="clip-image-preview-wrap">
                        <img
                            v-if="imageSrc && !imageLoadFailed"
                            class="clip-data-image"
                            :src="imageSrc"
                            :alt="coverIsGif ? 'GIF 首帧' : '图片预览'"
                            loading="lazy"
                            @error="handleImageError"
                        />
                        <div v-else class="image-error-placeholder">
                            <span>{{ thumbnailLoading ? '首帧加载中…' : '图片无法预览' }}</span>
                        </div>
                        <span v-if="isGif" class="clip-gif-badge">GIF</span>
                        </div>
                        <span v-if="imageFileGroup.length > 1" class="clip-image-count">{{ imageFileGroup.length }} 张</span>
                    </div>
                </template>
                <template v-else-if="item.type === 'file'">
                    <div v-if="isCompact" class="clip-data-one-line">
                        <span v-if="hasAlias" class="clip-alias-primary">{{ itemAlias }}</span>
                        <span v-if="hasAlias" class="clip-alias-secondary">{{ fileSummaryLine }}</span>
                        <template v-else>{{ fileSummaryLine }}</template>
                    </div>
                    <el-popover
                        v-else-if="enableRichFilePreview"
                        placement="left"
                        trigger="click"
                        width="320"
                    >
                        <template #reference>
                            <div :class="{ 'clip-over-sized-content': isOverSizedContent(item) }">
                                <div v-if="hasAlias" class="clip-alias-primary">{{ itemAlias }}</div>
                                <div v-if="hasAlias" class="clip-alias-secondary">{{ fileSummaryLine }}</div>
                                <div v-if="imageFiles.length" class="file-with-images">
                                    <div class="image-files-preview">
                                        <span
                                            v-for="imgFile in imageFiles.slice(0, 3)"
                                            :key="imgFile.path"
                                            class="image-file-indicator"
                                        >
                                            🖼️
                                        </span>
                                        <span v-if="imageFiles.length > 3" class="more-images">
                                            +{{ imageFiles.length - 3 }}
                                        </span>
                                    </div>
                                    <FileList :data="fileListPreview" />
                                </div>
                                <FileList v-else :data="fileListPreview" />
                            </div>
                        </template>
                        <div style="max-height: 260px; overflow: auto">
                            <div v-if="imageFiles.length" class="image-files-section">
                                <div class="section-title">📷 图片文件 ({{ imageFiles.length }})</div>
                                <div class="image-files-grid">
                                    <div
                                        v-for="imgFile in imageFiles"
                                        :key="imgFile.path"
                                        class="image-file-item"
                                        @mouseenter="showImageFilePreview(imgFile.path)"
                                        @mouseleave="showImageFilePreview(imageFiles[0]?.path)"
                                    >
                                        <img
                                            class="image-file-preview"
                                            :src="toFileUrl(imgFile.path)"
                                            :alt="imgFile.name || 'image-file'"
                                            @error="handleImageError"
                                            @load="handleImageLoad"
                                        />
                                        <div class="file-name">
                                            {{ imgFile.path?.split('/').pop() || imgFile.name }}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="all-files-section">
                                <div class="section-title">📁 所有文件</div>
                                <FileList :data="fileList" />
                            </div>
                            <div
                                v-if="Array.isArray(item.originPaths) && item.originPaths.length"
                                style="margin-top: 8px; opacity: 0.75"
                            >
                                <div>原始路径</div>
                                <div
                                    v-for="p in item.originPaths"
                                    :key="p"
                                    style="font-size: 12px; word-break: break-all"
                                >
                                    {{ p }}
                                </div>
                            </div>
                        </div>
                    </el-popover>
                    <div
                        v-else
                        :class="{ 'clip-over-sized-content': isOverSizedContent(item) }"
                    >
                        <div v-if="hasAlias" class="clip-alias-primary">{{ itemAlias }}</div>
                        <div v-if="hasAlias" class="clip-alias-secondary">{{ fileSummaryLine }}</div>
                        <FileList :data="fileListPreview" />
                    </div>
                </template>
            </div>
        </div>
        <ClipOperate
            v-show="showOperate"
            :item="item"
            :currentActiveTab="currentActiveTab"
            @onDataChange="emit('row-data-change')"
            @onDataRemove="emit('row-data-remove')"
            @openTagEdit="emit('row-open-tag-edit', $event)"
        />
        <div class="clip-count" v-show="isMultiple || !isActive">
            {{ index + 1 }}
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import FileList from "./FileList.vue";
import ClipOperate from "./ClipOperate.vue";
import { dateFormat } from "../utils";
import { isGifItem, loadGifListThumbnail } from "../utils/gifPreview.mjs";
import { getClipboardDisplayType, getImageFileGroup } from "../utils/imagePresentation.mjs";

const props = defineProps({
    item: { type: Object, required: true },
    index: { type: Number, required: true },
    isMultiple: { type: Boolean, required: true },
    isActive: { type: Boolean, required: true },
    isSelected: { type: Boolean, required: true },
    isCollected: { type: Boolean, required: true },
    isPinned: { type: Boolean, default: false },
    showOperate: { type: Boolean, required: true },
    currentActiveTab: { type: String, required: true },
    isOverSizedContent: { type: Function, required: true },
    isPreviewableText: { type: Boolean, default: false },
    itemAlias: { type: String, default: "" },
    getItemImageSrc: { type: Function, required: true },
    hasImageFiles: { type: Function, required: true },
    getImageFiles: { type: Function, required: true },
    toFileUrl: { type: Function, required: true },
    showImageFilePreview: { type: Function, required: true },
});

const emit = defineEmits([
    "row-click-left",
    "row-click-right",
    "row-mouseenter",
    "row-mouseleave",
    "row-data-change",
    "row-data-remove",
    "row-open-tag-edit",
    "row-image-click",
]);

// 单选模式：选中也不增高，避免推挤下方条目；多选时仅当前多选行可展开详情
const isCompact = computed(() => !props.isMultiple || !props.isActive);
const fileList = computed(() => {
    if (props.item.type !== "file") return [];
    try {
        return JSON.parse(props.item.data) || [];
    } catch (_) {
        return [];
    }
});
const textSingleLine = computed(() => {
    const s = String(props.item.data || "")
        .replace(/\s+/g, " ")
        .trim();
    if (s.length > 100) return `${s.slice(0, 97)}…`;
    return s;
});
const pinGroupPreviewLines = computed(() => {
    const lines = Array.isArray(props.item.__pinGroupPreviewLines)
        ? props.item.__pinGroupPreviewLines
        : [];
    if (!lines.length) return [{ type: "", name: textSingleLine.value }];
    return lines.slice(0, 6).map((line) => {
        if (typeof line === "string") return { type: "", name: line };
        return {
            type: line?.type || "",
            name: line?.name || "项目",
        };
    });
});
const hasAlias = computed(() => Boolean(props.itemAlias && props.itemAlias.trim()));
const fileSummaryLine = computed(() => {
    if (props.item.type !== "file") return "";
    const list = fileList.value;
    if (!list.length) return "文件";
    const name =
        list[0].path?.split(/[/\\]/).pop() || list[0].name || "文件";
    return list.length > 1 ? `${name} 等${list.length}项` : name;
});
const imageInfoLine = computed(() => {
    const ts = dateFormat(props.item.updateTime);
    return `图片 · ${ts}`;
});
const itemTags = computed(() =>
    Array.isArray(props.item.tags) ? props.item.tags : [],
);
const textPreviewContent = computed(() =>
    String(props.item.data || "")
        .split("\n")
        .slice(0, 6)
        .join("\n")
        .trim(),
);
const fileListPreview = computed(() => fileList.value.slice(0, 6));
const imageFiles = computed(() =>
    enableRichFilePreview.value && props.hasImageFiles(props.item)
        ? props.getImageFiles(props.item)
        : [],
);
const displayType = computed(() => getClipboardDisplayType(props.item));
const imageFileGroup = computed(() => getImageFileGroup(props.item));
const isGif = computed(() => isGifItem(props.item));
const coverIsGif = computed(() => imageFileGroup.value.length
    ? /\.gif$/i.test(imageFileGroup.value[0].path) : isGif.value);
const gifThumbnail = ref("");
const thumbnailLoading = ref(false);
watch([() => props.item.data, () => props.item.thumbnail, () => props.item.type], async (_, __, onCleanup) => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    gifThumbnail.value = "";
    thumbnailLoading.value = coverIsGif.value;
    if (!coverIsGif.value) return;
    const thumbnail = await loadGifListThumbnail(props.item, window.exports || {});
    if (cancelled) return;
    gifThumbnail.value = thumbnail;
    thumbnailLoading.value = false;
}, { immediate: true });
const imageSrc = computed(() => coverIsGif.value
    ? gifThumbnail.value : props.getItemImageSrc(props.item));
const imageLoadFailed = ref(false);
watch(imageSrc, () => { imageLoadFailed.value = false; });
const enableRichFilePreview = computed(
    () => props.item.type === "file" && props.isActive,
);

const handleImageClick = (event) => {
    event.stopPropagation();
    emit("row-image-click", event);
};

const handleImageError = () => { imageLoadFailed.value = true; };
</script>

<style scoped>
.clip-image-preview-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 60px; min-height: 44px; }
.clip-gif-badge { position: absolute; right: 2px; bottom: 2px; padding: 1px 4px; border-radius: 3px; background: rgba(0, 0, 0, 0.68); color: #fff; font-size: 10px; font-weight: 600; line-height: 14px; pointer-events: none; }
.clip-image-count { margin-left: 8px; font-size: 12px; opacity: 0.65; white-space: nowrap; }
</style>
