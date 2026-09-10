<template>
  <div
    class="setting"
    ref="settingRootRef"
    tabindex="-1"
    @mousedown="focusSettingSurface"
  >
    <el-card class="setting-card">
      <div class="setting-card-content">
        <div class="setting-header-bar">
          <div class="sub-tab-nav">
            <el-button
              class="sub-tab-btn"
              :class="{ 'is-current': activeTab === 'basic' }"
              @click="activeTab = 'basic'"
            >
              存储
            </el-button>
            <el-button
              class="sub-tab-btn"
              :class="{ 'is-current': activeTab === 'shortcut' }"
              @click="activeTab = 'shortcut'"
            >
              命令
            </el-button>
            <el-button
              class="sub-tab-btn"
              :class="{ 'is-current': activeTab === 'feature' }"
              @click="activeTab = 'feature'"
            >
              功能
            </el-button>
            <el-button
              class="sub-tab-btn"
              :class="{ 'is-current': activeTab === 'feature-config' }"
              @click="activeTab = 'feature-config'"
            >
              功能配置
            </el-button>
          </div>
          <div class="setting-header-actions">
            <el-button class="setting-header-btn" @click="emit('back')">返回</el-button>
            <el-button class="setting-header-btn setting-header-btn--primary" type="primary" @click="handleSaveBtnClick">保存</el-button>
          </div>
        </div>

        <div class="sub-tab-content" v-show="activeTab === 'basic'">
          <div class="setting-card-content-item setting-storage-compact">
            <div class="setting-panel setting-panel--config">
              <div class="setting-row setting-row--compact">
                <span class="setting-label">数据根路径</span>
                <el-input class="path" v-model="path" :title="path" disabled></el-input>
                <el-button type="primary" plain class="setting-section-action" @click="handlePathBtnClick('modify')">修改</el-button>
                <el-button plain class="setting-section-action" @click="handlePathBtnClick('open')" v-show="path">打开</el-button>
                <input type="file" id="database-path" :style="{ display: 'none' }" />
              </div>
              <div class="setting-row setting-row--compact setting-row--split">
                <div class="setting-field-group">
                  <span class="setting-label">最大历史</span>
                  <el-select class="number-select" v-model="maxsize" placeholder="">
                    <el-option label="无限" :value="unlimitedVal" />
                    <el-option v-for="n in [500, 1000, 5000, 50000]" :key="n" :value="n" />
                  </el-select>
                  <span class="setting-unit">条</span>
                </div>
                <div class="setting-field-group">
                  <span class="setting-label">保存时间</span>
                  <el-select class="number-select" v-model="maxage" placeholder="">
                    <el-option label="无限" :value="unlimitedVal" />
                    <el-option v-for="n in [1, 5, 7, 15, 30, 60, 90, 360]" :key="n" :value="n" />
                  </el-select>
                  <span class="setting-unit">天</span>
                </div>
              </div>
            </div>
            <div class="setting-panel setting-panel--status">
              <div class="setting-panel-head">
                <span class="setting-status-chip" :class="storageModeClass">{{ storageModeLabel }}</span>
                <span class="setting-status-chip" :class="{ 'is-danger': storageStatus.migrationStatus === 'failed' }">{{ storageMigrationLabel }}</span>
                <span class="setting-status-time">{{ storageUpdatedAtLabel }}</span>
                <HelpHint
                  marker="!"
                  button-class="setting-help-btn"
                  aria-label="查看存储模式说明"
                  content="旧 JSON 会保留为备份；正常运行优先使用 SQLite，迁移失败时临时使用 JSON 降级模式。"
                />
                <el-button
                  v-if="storageStatus.migrationStatus === 'failed'"
                  type="primary"
                  plain
                  class="setting-section-action"
                  :loading="isRetryingMigration"
                  @click="handleRetryStorageMigration"
                >
                  再次尝试迁移
                </el-button>
              </div>
              <div class="setting-path-strip">
                <div class="setting-path-item">
                  <span class="setting-path-tag">SQLite</span>
                  <span class="setting-path-value" :title="storageSqlitePath">{{ storageSqlitePath }}</span>
                </div>
                <div class="setting-path-item">
                  <span class="setting-path-tag">素材</span>
                  <span class="setting-path-value" :title="storageAssetDir">{{ storageAssetDir }}</span>
                </div>
              </div>
              <div class="setting-row setting-row--compact" v-if="isStorageMigrationActive || storageStatus.migrationStatus === 'failed'">
                <span class="setting-label">当前步骤</span>
                <div class="storage-progress">
                  <el-progress
                    :percentage="storageStatus.progress"
                    :status="storageStatus.migrationStatus === 'failed' ? 'exception' : undefined"
                  />
                  <span class="setting-inline-hint">{{ storageStatus.stepText || '等待存储状态' }}</span>
                </div>
              </div>
              <div class="setting-row setting-row--compact" v-if="storageStatus.errorMessage">
                <span class="setting-label">错误信息</span>
                <span class="setting-static-value setting-static-value--danger setting-static-value--compact" :title="storageStatus.errorMessage">
                  {{ storageStatus.errorMessage }}
                </span>
              </div>
              <div class="setting-row setting-row--compact" v-if="storageStatus.migrationStatus === 'failed'">
                <span class="setting-label">排查方式</span>
                <span class="setting-inline-hint">
                  失败详情已记录在 uTools dbStorage 的 storageRuntimeStatus.errorMessage；dev 模式也会输出到控制台。
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="sub-tab-content sub-tab-content--fill" v-show="activeTab === 'shortcut'">
          <div class="setting-card-content-item setting-shortcut-shell">
            <div class="shortcut-system-notice">
              部分按键为系统占用，无法更改（悬浮 ⌨ 查看详情）
            </div>
            <div class="shortcut-strip shortcut-strip--single">
              <el-tooltip :content="currentShortcutScopeLabel" placement="top" :show-after="400">
                <el-select
                  ref="shortcutScopeSelectRef"
                  v-model="shortcutScope"
                  class="shortcut-scope-select"
                  popper-class="shortcut-scope-popper"
                  @visible-change="handleShortcutScopeVisible"
                >
                  <el-option
                    v-for="opt in shortcutScopeOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-tooltip>
              <div class="shortcut-search-wrap">
                <el-input
                  ref="shortcutSearchInputRef"
                  v-model="shortcutQueryInput"
                  clearable
                  placeholder="搜索 command / 键位 / when"
                  @clear="applyShortcutSearch"
                  @keydown.enter.prevent="applyShortcutSearch"
                />
              </div>
              <div class="shortcut-strip-actions">
                <span
                  class="shortcut-strip-meta"
                  :class="{ 'is-fallback': shortcutCommandStorageMode !== SHORTCUT_STORAGE_MODE_SQLITE }"
                  :title="shortcutStorageHint"
                >
                  <span class="shortcut-strip-meta-label">
                    {{ shortcutStorageSourceLabel }}
                  </span>
                  <span class="shortcut-strip-meta-count">{{ filteredShortcutCommandRows.length }}/{{ shortcutCommandRows.length }}</span>
                </span>
                <el-popover
                  placement="bottom-start"
                  trigger="hover"
                  :width="520"
                  :show-after="200"
                  popper-class="shortcut-record-reserved-popper"
                >
                  <template #reference>
                    <button type="button" class="setting-help-btn setting-help-btn--compact" aria-label="查看保留按键规则">⌨</button>
                  </template>
                  <table class="shortcut-reservation-table">
                    <thead>
                      <tr>
                        <th>快捷键</th>
                        <th>Command ID</th>
                        <th>When</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(rule, ruleIndex) in shortcutReservationRows" :key="`strip:${rule.commandId}:${rule.shortcutId}:${ruleIndex}`">
                        <td>{{ formatShortcutDisplay(rule.shortcutId) }}</td>
                        <td>{{ rule.commandId }}</td>
                        <td>{{ rule.when || '—' }}</td>
                        <td>{{ rule.description }}</td>
                      </tr>
                    </tbody>
                  </table>
                </el-popover>
                <HelpHint
                  marker="?"
                  button-class="setting-help-btn setting-help-btn--compact"
                  aria-label="查看命令列表说明"
                  :content="shortcutHelpContent"
                />
              </div>
            </div>
            <div class="shortcut-list-scroll">
              <div v-if="filteredShortcutCommandRows.length" class="shortcut-list shortcut-list--grid">
                <div class="shortcut-list-head">
                  <span class="shortcut-col shortcut-col--id">ID</span>
                  <span class="shortcut-col shortcut-col--scope">作用域</span>
                  <span class="shortcut-col shortcut-col--kbd">快捷键</span>
                  <span class="shortcut-col shortcut-col--when">When</span>
                  <span class="shortcut-col shortcut-col--source">来源</span>
                  <span class="shortcut-col shortcut-col--ops">操作</span>
                </div>
                <div
                  v-for="row in filteredShortcutCommandRows"
                  :key="row.id"
                  class="shortcut-list-item"
                  :class="{ 'is-disabled': row.disabled, 'is-risk': row.risk === 'data-write' }"
                >
                  <div
                    class="shortcut-col shortcut-col--id shortcut-id-cell"
                    @mouseenter="syncShortcutDrawerPosition"
                    @mouseleave="resetShortcutDrawerPosition"
                  >
                    <span class="shortcut-id-anchor">
                      <span class="shortcut-id-value">{{ row.commandId }}</span>
                    </span>
                  </div>
                  <div class="shortcut-col shortcut-col--scope">
                    <span v-if="row.risk === 'data-write'" class="shortcut-list-badge shortcut-list-badge--risk">写入</span>
                    <span class="shortcut-list-badge" :title="row.scopeLabel">{{ row.scopeLabel }}</span>
                  </div>
                  <span class="shortcut-col shortcut-col--kbd">
                    <template v-for="(sid, sidIndex) in (row.shortcutIds || [row.shortcutId]).filter(Boolean)" :key="`${row.id}:${sid}`">
                      <span v-if="sidIndex > 0" class="shortcut-kbd-sep"> / </span>
                      <el-tooltip :content="getShortcutTooltipContent(sid)" placement="top" :show-after="300" :disabled="!getShortcutTooltipContent(sid)">
                        <span class="feature-kbd" :class="{ 'feature-kbd--muted': row.disabled }">
                          {{ formatShortcutDisplayCompact(sid) }}
                        </span>
                      </el-tooltip>
                    </template>
                  </span>
                  <span class="shortcut-col shortcut-col--when" :title="row.when">{{ row.when || '始终' }}</span>
                  <span class="shortcut-col shortcut-col--source" :class="{ user: row.source === 'user' }">{{ row.sourceLabel }}</span>
                  <div class="shortcut-col shortcut-col--ops shortcut-list-ops">
                    <el-tooltip content="录制或修改快捷键" placement="top" :show-after="280">
                      <button type="button" class="shortcut-list-op" @click="openShortcutEdit(row)">键</button>
                    </el-tooltip>
                    <el-tooltip content="编辑 When 条件" placement="top" :show-after="280">
                      <button type="button" class="shortcut-list-op" @click="openWhenEdit(row)">W</button>
                    </el-tooltip>
                    <el-tooltip
                      v-if="row.source === 'user' || row.source === 'removed'"
                      content="恢复为默认快捷键"
                      placement="top"
                      :show-after="280"
                    >
                      <button type="button" class="shortcut-list-op" @click="restoreShortcutDefault(row)">复</button>
                    </el-tooltip>
                    <el-tooltip
                      v-if="row.disabled"
                      content="启用此 action 的快捷键触发"
                      placement="top"
                      :show-after="280"
                    >
                      <button type="button" class="shortcut-list-op" @click="enableShortcut(row)">启</button>
                    </el-tooltip>
                    <el-tooltip
                      v-else
                      content="禁用此 action 的快捷键触发"
                      placement="top"
                      :show-after="280"
                    >
                      <button type="button" class="shortcut-list-op shortcut-list-op--danger" @click="disableShortcut(row)">禁</button>
                    </el-tooltip>
                  </div>
                  <div
                    class="shortcut-id-drawer"
                    role="tooltip"
                    :aria-label="row.commandTitle || row.commandId"
                  >
                    <span class="shortcut-id-drawer-label">命令</span>
                    <span class="shortcut-id-drawer-title">{{ row.commandTitle || row.commandId }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="shortcut-list-empty">暂无匹配命令</div>
            </div>
          </div>
        </div>
        <el-dialog
          v-model="shortcutRecordVisible"
          title="录制快捷键"
          width="560px"
          align-center
          destroy-on-close
          class="setting-modal-dialog shortcut-record-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
          :close-on-click-modal="false"
          :before-close="handleShortcutRecordBeforeClose"
          @opened="focusShortcutRecorder"
          @closed="resetShortcutRecorder"
        >
          <el-popover
            placement="top-start"
            trigger="hover"
            :width="520"
            :show-after="200"
            :offset="8"
            popper-class="shortcut-record-reserved-popper"
          >
            <template #reference>
              <div class="shortcut-recorder-reserved">保留按键规则，悬浮查看</div>
            </template>
            <table class="shortcut-reservation-table">
              <thead>
                <tr>
                  <th>快捷键</th>
                  <th>Command ID</th>
                  <th>When</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(rule, ruleIndex) in shortcutReservationRows" :key="`${rule.commandId}:${rule.shortcutId}:${ruleIndex}`">
                  <td>{{ formatShortcutDisplay(rule.shortcutId) }}</td>
                  <td>{{ rule.commandId }}</td>
                  <td>{{ rule.when || '—' }}</td>
                  <td>{{ rule.description }}</td>
                </tr>
              </tbody>
            </table>
          </el-popover>
          <div class="shortcut-record-head shortcut-record-head--command">
            <div class="shortcut-record-head-main">
              <div class="shortcut-record-command">{{ shortcutRecordRow?.commandTitle || '' }}</div>
              <div class="shortcut-record-command-id">{{ shortcutRecordRow?.commandId || '' }}</div>
            </div>
            <div class="shortcut-record-head-defaults">
              <span class="shortcut-record-default-label">默认值</span>
              <span
                v-for="defId in shortcutRecordDefaultIds"
                :key="defId"
                class="shortcut-record-default-value"
              >{{ formatShortcutDisplayCompact(defId) }}</span>
              <button
                v-if="showShortcutRecordDefaultRestore"
                type="button"
                class="shortcut-record-default-reset"
                @click="restoreShortcutRecordToDefault"
              >
                恢复默认
              </button>
            </div>
          </div>
          <div class="shortcut-record-panels">
            <div class="shortcut-record-panel shortcut-record-panel--current">
              <div class="shortcut-record-panel-label">当前绑定</div>
              <div v-if="shortcutRecordActiveIds.length" class="shortcut-record-key-list">
                <div
                  v-for="(sid, index) in shortcutRecordActiveIds"
                  :key="`active:${sid}:${index}`"
                  class="shortcut-record-key-row"
                >
                  <span class="feature-kbd">{{ formatShortcutDisplay(sid) }}</span>
                  <button type="button" class="shortcut-record-key-remove" @click="removeShortcutRecordActiveId(index)">×</button>
                </div>
              </div>
              <div v-else class="shortcut-record-key-empty">暂无绑定</div>
            </div>
            <div class="shortcut-record-panel shortcut-record-panel--pending">
              <div class="shortcut-record-panel-label">待绑定</div>
              <div v-if="shortcutRecordPendingIds.length" class="shortcut-record-key-list">
                <div
                  v-for="(sid, index) in shortcutRecordPendingIds"
                  :key="`pending:${sid}:${index}`"
                  class="shortcut-record-key-row"
                >
                  <el-input
                    v-if="shortcutRecordEditingIndex === index"
                    v-model="shortcutRecordEditingValue"
                    size="small"
                    @blur="finishEditingShortcut(index)"
                    @keyup.enter="finishEditingShortcut(index)"
                    @keyup.esc="cancelEditingShortcut"
                  />
                  <span v-else class="feature-kbd" @click="startEditingShortcut(index, sid)">{{ formatShortcutDisplayCompact(sid) }}</span>
                  <button type="button" class="shortcut-record-key-remove" @click="removeShortcutRecordPendingId(index)">×</button>
                </div>
              </div>
              <div v-else class="shortcut-record-key-empty">录制后点 ✅ 添加</div>
            </div>
          </div>
          <div
            ref="shortcutRecorderRef"
            class="shortcut-record-capture-row shortcut-recorder"
            tabindex="0"
            @keydown.stop.prevent="handleShortcutRecordKeydown"
          >
            <span class="shortcut-record-capture-hint">按下快捷键录制</span>
            <div v-if="shortcutRecordCapturedId" class="shortcut-record-capture-staging">
              <span class="feature-kbd">{{ formatShortcutDisplayCompact(shortcutRecordCapturedId) }}</span>
            </div>
            <button
              v-if="shortcutRecordCapturedId"
              type="button"
              class="shortcut-record-capture-confirm"
              @click="promoteShortcutRecordCaptured"
            >
              ✓
            </button>
          </div>
          <div class="shortcut-record-direct-input-row">
            <span class="shortcut-record-capture-hint">或直接录入</span>
            <el-input
              v-model="shortcutRecordDirectInput"
              placeholder="如 s-esc"
              clearable
              @keyup.enter="handleDirectInputSubmit"
              @clear="shortcutRecordDirectInput = ''"
            />
            <el-button type="primary" @click="handleDirectInputSubmit">添加</el-button>
          </div>
          <template #footer>
            <el-button @click="requestCloseShortcutRecord">取消</el-button>
            <el-button type="primary" :disabled="!canSubmitShortcutRecord" @click="submitShortcutRecord">确定</el-button>
          </template>
        </el-dialog>
        <el-dialog
          v-model="whenEditVisible"
          title="编辑 When 条件"
          width="720px"
          align-center
          destroy-on-close
          class="setting-modal-dialog when-edit-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
          :close-on-click-modal="false"
          :before-close="handleWhenEditBeforeClose"
          @closed="resetWhenEditor"
        >
          <div class="when-editor-shell">
          <div class="when-editor-head">
            <div class="when-editor-title">{{ whenEditRow?.commandTitle || '' }}</div>
            <div class="when-editor-meta">{{ whenEditRow?.commandId || '' }}</div>
          </div>
          <div class="when-editor-mode-row">
            <button
              type="button"
              class="filter-chip filter-chip--when"
              :class="{ active: whenEditMode === 'builder' }"
              @click="switchWhenEditMode('builder')"
            >
              图形
            </button>
            <button
              type="button"
              class="filter-chip filter-chip--when"
              :class="{ active: whenEditMode === 'text' }"
              @click="switchWhenEditMode('text')"
            >
              文本
            </button>
            <span class="when-editor-summary" :title="getWhenBuilderSummary(whenEditInput)">
              当前：{{ getWhenBuilderSummary(whenEditInput) }}
            </span>
          </div>
          <div v-if="whenEditMode === 'builder'" class="when-builder">
            <div class="when-builder-toolbar">
              <span class="when-builder-toolbar-label">条件关系</span>
              <div class="when-operator-segment">
                <button
                  type="button"
                  class="filter-chip filter-chip--when"
                  :class="{ active: whenBuilderOperator === '&&' }"
                  @click="setWhenBuilderOperator('&&')"
                >
                  全部满足
                </button>
                <button
                  type="button"
                  class="filter-chip filter-chip--when"
                  :class="{ active: whenBuilderOperator === '||' }"
                  @click="setWhenBuilderOperator('||')"
                >
                  任一满足
                </button>
              </div>
            </div>
            <div class="when-builder-groups">
              <div
                v-for="group in WHEN_CONTEXT_GROUPS"
                :key="group.id"
                class="when-builder-group"
                :class="`when-builder-group--${group.id}`"
              >
                <div class="when-builder-group-title">{{ group.title }}</div>
                <div class="when-builder-options">
                  <div
                    v-for="item in group.keys"
                    :key="item.key"
                    class="when-builder-option"
                    :class="{
                      'is-set-include': whenBuilderStates[item.key] === 'include',
                      'is-set-exclude': whenBuilderStates[item.key] === 'exclude',
                      'is-disabled': whenBuilderDisabledKeys.has(item.key)
                    }"
                  >
                    <span class="when-builder-option-label" :title="item.label">{{ item.label }}</span>
                    <div class="when-builder-option-actions">
                      <button
                        type="button"
                        class="when-state-btn"
                        :class="{ 'active-include': whenBuilderStates[item.key] === 'include' }"
                        :disabled="whenBuilderDisabledKeys.has(item.key)"
                        @click="setWhenBuilderState(item.key, 'include')"
                      >
                        是
                      </button>
                      <button
                        type="button"
                        class="when-state-btn"
                        :class="{ 'active-exclude': whenBuilderStates[item.key] === 'exclude' }"
                        :disabled="whenBuilderDisabledKeys.has(item.key)"
                        @click="setWhenBuilderState(item.key, 'exclude')"
                      >
                        否
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <el-input
            v-show="whenEditMode === 'text'"
            v-model="whenEditInput"
            type="textarea"
            :rows="4"
            placeholder="例如 mainFocus && !inputFocus"
            @input="validateWhenEdit"
          />
          <div class="when-editor-status" :class="{ error: whenEditError }">
            {{ whenEditError || whenEditConflictLabel || 'When 表达式有效' }}
          </div>
          <div class="when-editor-presets">
            <span class="when-editor-presets-label">快捷预设</span>
            <div class="when-editor-presets-row">
              <button
                v-for="preset in WHEN_PRESETS"
                :key="preset.label"
                type="button"
                class="filter-chip filter-chip--when"
                @click="applyWhenEditPreset(preset.when)"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>
          <div v-if="showWhenEditDefaultRestore" class="when-editor-default">
            <span class="when-editor-default-label">默认值</span>
            <button
              type="button"
              class="when-editor-default-value"
              :title="getWhenBuilderSummary(whenEditDefaultWhen)"
              @click="restoreWhenEditToDefault"
            >
              {{ getWhenBuilderSummary(whenEditDefaultWhen) }}
            </button>
            <span class="when-editor-default-hint">点击恢复</span>
          </div>
          </div>
          <template #footer>
            <el-button @click="requestCloseWhenEdit">取消</el-button>
            <el-button type="primary" :disabled="Boolean(whenEditError)" @click="submitWhenEdit">确定</el-button>
          </template>
        </el-dialog>
        <div class="sub-tab-content sub-tab-content--fill" v-show="activeTab === 'feature'">
          <div class="setting-card-content-item setting-feature-shell">
            <div class="feature-strip feature-strip--single">
              <el-popover
                placement="bottom-start"
                :width="300"
                trigger="click"
                popper-class="feature-select-popover"
              >
                <template #reference>
                  <button type="button" class="feature-strip-chip feature-strip-chip--home">
                    主页 {{ shown.length }}/9
                  </button>
                </template>
                <div class="feature-select-popover-body">
                  <el-select
                    class="operation-select operation-select--popover"
                    v-model="shown"
                    multiple
                    :multiple-limit="9"
                    collapse-tags
                    collapse-tags-tooltip
                    placeholder="选择主页展示功能"
                  >
                    <el-option
                      v-for="o in allOperations"
                      :key="o.id"
                      :label="`${o.index}. ${o.icon} ${o.title}`"
                      :value="o.id"
                    />
                  </el-select>
                </div>
              </el-popover>
              <div class="feature-search-wrap">
                <el-input
                  v-model="featureQuery"
                  clearable
                  placeholder="搜索"
                />
              </div>
              <span class="feature-strip-chip feature-strip-chip--count">{{ filteredFeatureRows.length }}/{{ featureRows.length }}</span>
              <span v-if="isFeatureFilterActive" class="feature-strip-chip feature-strip-chip--filter">过滤</span>
              <button
                type="button"
                class="feature-strip-chip feature-strip-chip--add"
                title="新增自定义功能"
                @click="openCustomAdd"
              >
                +
              </button>
              <HelpHint
                marker="?"
                button-class="setting-help-btn setting-help-btn--compact"
                aria-label="查看功能列表说明"
                content="拖拽左侧手柄排序；过滤时禁用拖拽。自定义功能可编辑删除。"
              />
            </div>
            <div class="feature-list-scroll">
              <draggable
                v-if="!isFeatureFilterActive"
                v-model="featureListRows"
                item-key="id"
                class="feature-list"
                handle=".feature-list-grip"
                :move="allowFeatureDrag"
                @end="handleFeatureListDragEnd"
              >
                <template #item="{ element: row }">
                  <div class="feature-list-item" :class="{ custom: row.isCustom }">
                    <span class="feature-list-grip" title="拖拽排序">⋮⋮</span>
                    <span class="feature-list-icon">{{ row.icon }}</span>
                    <div class="feature-list-main">
                      <span class="feature-list-title">{{ row.title }}</span>
                      <span class="feature-list-badge" :class="{ custom: row.isCustom }">{{ row.typeLabel }}</span>
                    </div>
                    <button
                      v-if="row.shortcutSummary.count"
                      type="button"
                      class="feature-kbd"
                      :title="row.shortcutSummary.hint"
                      :aria-label="`查看 ${row.title} 快捷键：${row.shortcutSummary.label}`"
                      @click="openFeatureShortcut(row)"
                    >
                      {{ row.shortcutSummary.label }}
                    </button>
                    <span v-else class="feature-kbd feature-kbd--muted" :title="row.shortcutSummary.hint">—</span>
                    <div v-if="row.isCustom" class="feature-list-ops">
                      <button type="button" class="feature-list-op" title="编辑" @click="openCustomEdit(row.raw)">✎</button>
                      <button type="button" class="feature-list-op feature-list-op--danger" title="删除" @click="deleteCustom(row.raw)">×</button>
                    </div>
                  </div>
                </template>
              </draggable>
              <div v-else-if="filteredFeatureRows.length" class="feature-list">
                <div
                  v-for="row in filteredFeatureRows"
                  :key="row.id"
                  class="feature-list-item"
                  :class="{ custom: row.isCustom }"
                >
                  <span class="feature-list-grip feature-list-grip--disabled">⋮⋮</span>
                  <span class="feature-list-icon">{{ row.icon }}</span>
                  <div class="feature-list-main">
                    <span class="feature-list-title">{{ row.title }}</span>
                    <span class="feature-list-badge" :class="{ custom: row.isCustom }">{{ row.typeLabel }}</span>
                  </div>
                  <button
                    v-if="row.shortcutSummary.count"
                    type="button"
                    class="feature-kbd"
                    :title="row.shortcutSummary.hint"
                    @click="openFeatureShortcut(row)"
                  >
                    {{ row.shortcutSummary.label }}
                  </button>
                  <span v-else class="feature-kbd feature-kbd--muted">—</span>
                  <div v-if="row.isCustom" class="feature-list-ops">
                    <button type="button" class="feature-list-op" title="编辑" @click="openCustomEdit(row.raw)">✎</button>
                    <button type="button" class="feature-list-op feature-list-op--danger" title="删除" @click="deleteCustom(row.raw)">×</button>
                  </div>
                </div>
              </div>
              <div v-else class="feature-list-empty">暂无匹配功能</div>
            </div>
            <el-dialog
              v-model="customDialogVisible"
              :title="customDialogMode === 'add' ? '新增功能' : '编辑功能'"
              :fullscreen="true"
              :close-on-click-modal="false"
              class="setting-modal-dialog feature-dialog"
              modal-class="setting-modal-overlay"
              :modal="true"
              @closed="customFormRef?.resetFields?.()"
            >
              <el-form
                ref="customFormRef"
                class="feature-form"
                :model="customForm"
                :rules="customFormRules"
                label-width="90px"
              >
                <el-form-item label="标题" prop="title">
                  <el-input v-model="customForm.title" placeholder="功能标题" />
                </el-form-item>
                <el-form-item label="图标" prop="icon">
                  <el-input v-model="customForm.icon" placeholder="如 📌" maxlength="4" show-word-limit />
                </el-form-item>
                <el-form-item label="匹配" prop="matchStr">
                  <el-input v-model="customForm.matchStr" type="textarea" :rows="6" placeholder='JSON 数组，如 ["text","image"]' />
                </el-form-item>
                <el-form-item label="命令" prop="command">
                  <el-input v-model="customForm.command" placeholder="如 redirect:插件名" />
                </el-form-item>
              </el-form>
              <template #footer>
                <el-button @click="customDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="submitCustomForm">确定</el-button>
              </template>
            </el-dialog>
          </div>
        </div>
        <div class="sub-tab-content sub-tab-content--fill" v-show="activeTab === 'feature-config'">
          <div class="setting-card-content-item setting-feature-config-shell">
            <div class="feature-config-panel feature-config-panel--compact">
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-title-row">
                  <strong>悬浮预览</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看悬浮预览说明"
                    content="关闭后列表悬浮不再触发预览；Shift 长按不受影响。保存后立即同步，路径 userConfig.preview.hover"
                  />
                </div>
                <div class="feature-config-control feature-config-control--compact">
                  <div
                    class="feature-config-input inline"
                    :class="{ 'is-hidden': !hoverPreviewEnabled }"
                  >
                    <span class="feature-config-inline-label">延迟</span>
                    <input
                      v-model.number="hoverPreviewDelay"
                      class="feature-config-native-input"
                      type="number"
                      :min="0"
                      :max="5000"
                      :step="50"
                      :disabled="!hoverPreviewEnabled"
                      :tabindex="hoverPreviewEnabled ? 0 : -1"
                    >
                    <span class="feature-config-unit">ms</span>
                  </div>
                  <button
                    type="button"
                    class="toggle-pill toggle-pill--compact"
                    :class="{ 'is-on': hoverPreviewEnabled, 'is-off': !hoverPreviewEnabled }"
                    :aria-pressed="hoverPreviewEnabled"
                    @click="toggleHoverPreview"
                  >
                    <span class="toggle-pill-track">
                      <span class="toggle-pill-knob"></span>
                    </span>
                    <span class="toggle-pill-text">{{ hoverPreviewEnabled ? '开' : '关' }}</span>
                  </button>
                </div>
              </div>
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-title-row">
                  <strong>行拼接</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看行拼接说明"
                    content="多行文本 item 的行拼接、包围再拼接和只包围共用此配置；输入 { 会自动匹配 }，输入引号或反引号会作为对称的一对。"
                  />
                </div>
                <div class="feature-config-control feature-config-control--compact feature-config-control--line-join">
                  <div class="feature-config-input inline feature-config-input--line-join">
                    <span class="feature-config-inline-label">分隔</span>
                    <input
                      v-model="lineJoinSeparator"
                      class="feature-config-native-input feature-config-native-input--text"
                      type="text"
                      :placeholder="LINE_JOIN_DEFAULT_SEPARATOR"
                      maxlength="32"
                    >
                  </div>
                  <div class="feature-config-input inline feature-config-input--line-surround">
                    <span class="feature-config-inline-label">包围</span>
                    <input
                      v-model="lineJoinSurround"
                      class="feature-config-native-input feature-config-native-input--text"
                      type="text"
                      :placeholder="LINE_JOIN_DEFAULT_SURROUND"
                      maxlength="4"
                    >
                  </div>
                  <span class="line-surround-preview" :title="lineJoinSurroundHint">{{ lineJoinSurroundPreview }}</span>
                </div>
              </div>
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-title-row">
                  <strong>外观主题</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看外观主题说明"
                    content="默认亮色；选择跟随系统后会随操作系统深浅色变化。保存路径 userConfig.appearance.theme"
                  />
                </div>
                <div class="feature-config-control feature-config-control--compact theme-mode-segmented">
                  <button
                    v-for="option in themeOptions"
                    :key="option.value"
                    type="button"
                    class="feature-config-chip theme-mode-chip"
                    :class="{ 'is-active': themePreference === option.value }"
                    :aria-pressed="themePreference === option.value"
                    @click="setThemePreference(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-title-row">
                  <strong>全局粘贴</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看快捷粘贴说明"
                    content="uTools 全局快捷键；置顶项粘贴筛选下最上方单项，组合项按已保存组合循环粘贴"
                  />
                </div>
                <div class="feature-config-control feature-config-control--compact">
                  <button
                    type="button"
                    class="feature-config-chip feature-config-chip--primary"
                    @click="openUtoolsHotkeySetting('粘贴置顶项')"
                  >
                    置顶
                  </button>
                  <button
                    type="button"
                    class="feature-config-chip feature-config-chip--primary"
                    @click="openUtoolsHotkeySetting('循环粘贴组合项')"
                  >
                    组合
                  </button>
                </div>
              </div>
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-meta-inline">
                  <strong>命令动作</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看命令动作说明"
                    :content="featureConfigCommandHelp"
                  />
                  <span
                    class="feature-config-status-mini"
                    :class="{ fallback: shortcutCommandStorageMode !== SHORTCUT_STORAGE_MODE_SQLITE }"
                    :title="shortcutStorageHint"
                  >
                    {{ shortcutStorageSourceLabel }}
                  </span>
                  <span
                    class="feature-config-status-mini"
                    :class="{ fallback: commandMacroStorageMode !== COMMAND_MACRO_STORAGE_MODE_SQLITE }"
                    :title="commandMacroStorageHint"
                  >
                    {{ commandMacroStorageMode === COMMAND_MACRO_STORAGE_MODE_SQLITE ? 'Macro' : 'Draft' }}
                  </span>
                </div>
                <div class="feature-config-control feature-config-control--compact">
                  <button type="button" class="feature-config-chip feature-config-chip--primary" @click="openShortcutSystemConfig">
                    命令
                  </button>
                  <button type="button" class="feature-config-chip" @click="commandMacroDialogVisible = true">
                    组合
                  </button>
                  <button type="button" class="feature-config-chip" @click="contextMenuDialogVisible = true">
                    菜单
                  </button>
                  <button type="button" class="feature-config-chip" @click="openCommandMacroDraftAdd">
                    新增
                  </button>
                </div>
              </div>
              <div class="feature-config-row feature-config-row--compact">
                <div class="feature-config-meta-inline">
                  <strong>快捷键配置管理</strong>
                  <HelpHint
                    marker="?"
                    button-class="setting-help-btn setting-help-btn--compact"
                    aria-label="查看快捷键配置管理说明"
                    content="每台机器都会保留自己的本机快捷键配置；公共配置单独共享。当前机器可选择使用本机配置或公共配置，推为公共需要确认。"
                  />
                  <span
                    class="feature-config-status-mini"
                    :class="{ fallback: shortcutRuntimeSource !== SHORTCUT_RUNTIME_SOURCE_PUBLIC }"
                    :title="shortcutStorageHint"
                  >
                    {{ shortcutRuntimeSourceLabel }}
                  </span>
                </div>
                <div class="feature-config-control feature-config-control--compact">
                  <button type="button" class="feature-config-chip feature-config-chip--primary" @click="shortcutSyncDialogVisible = true">
                    管理
                  </button>
                  <button type="button" class="feature-config-chip" @click="promoteShortcutLocalToPublic">
                    推为公共
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <el-dialog
          v-model="shortcutSyncDialogVisible"
          title="快捷键配置管理"
          width="680px"
          align-center
          class="setting-modal-dialog command-macro-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
          :close-on-click-modal="false"
        >
          <div class="shortcut-sync-dialog">
            <div class="shortcut-sync-row">
              <span class="shortcut-sync-label">本机别名</span>
              <el-input v-model="shortcutDeviceAlias" placeholder="例如 办公 Mac" />
              <el-button plain @click="saveShortcutDeviceAlias">保存别名</el-button>
            </div>
            <div class="shortcut-sync-row">
              <span class="shortcut-sync-label">当前使用</span>
              <el-radio-group v-model="shortcutRuntimeSourceDraft">
                <el-radio-button :value="SHORTCUT_RUNTIME_SOURCE_LOCAL">本机配置</el-radio-button>
                <el-radio-button :value="SHORTCUT_RUNTIME_SOURCE_PUBLIC">公共配置</el-radio-button>
              </el-radio-group>
              <el-button type="primary" plain @click="applyShortcutRuntimeSource">应用</el-button>
            </div>
            <div class="shortcut-sync-profiles">
              <div class="shortcut-sync-profile">
                <strong>本机配置</strong>
                <span>{{ localShortcutProfileCount }} 项改动</span>
              </div>
              <div class="shortcut-sync-profile">
                <strong>公共配置</strong>
                <span>{{ publicShortcutProfileCount }} 项改动</span>
              </div>
              <div class="shortcut-sync-profile">
                <strong>设备记录</strong>
                <span>{{ shortcutSyncDeviceCount }} 台机器</span>
              </div>
            </div>
            <div class="shortcut-sync-device-list">
              <div
                v-for="device in shortcutSyncDeviceRows"
                :key="device.nativeId"
                class="shortcut-sync-device-row"
              >
                <div class="shortcut-sync-device-main">
                  <strong>{{ device.alias }}</strong>
                  <span>{{ device.nativeId }}</span>
                </div>
                <div class="shortcut-sync-device-meta">
                  <span>{{ device.runtimeLabel }}</span>
                  <span>{{ device.updatedLabel }}</span>
                </div>
              </div>
            </div>
          </div>
          <template #footer>
            <el-button @click="shortcutSyncDialogVisible = false">关闭</el-button>
            <el-button type="primary" @click="promoteShortcutLocalToPublic">推本机为公共</el-button>
          </template>
        </el-dialog>
        <el-dialog
          v-model="commandMacroDialogVisible"
          title="组合命令"
          width="720px"
          align-center
          class="setting-modal-dialog command-macro-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
        >
          <SettingPagedTable
            :rows="commandMacroRows"
            :columns="commandMacroColumns"
            :total="commandMacroRows.length"
            row-key="id"
            empty-text="暂无组合命令"
            :show-pagination="false"
            body-max-height="360px"
          >
            <template #cell-title="{ row }">
              <div class="command-macro-cell">
                <div class="command-macro-title">{{ row.title }}</div>
                <div class="command-macro-meta">{{ row.id }}</div>
              </div>
            </template>
            <template #cell-steps="{ row }">
              <span class="command-macro-steps" :title="row.stepHint">{{ row.stepSummary }}</span>
            </template>
            <template #cell-runtimeLabel="{ row }">
              <span class="shortcut-source-tag" :class="{ user: row.runtimeStatus === 'running' || row.runtimeStatus === 'completed' }">
                {{ row.runtimeLabel }}
              </span>
            </template>
            <template #cell-storageLabel="{ row }">
              <span class="shortcut-source-tag">{{ row.storageLabel }}</span>
            </template>
            <template #actions="{ row }">
              <el-button v-if="row.canCancel" link type="warning" size="small" @click="cancelCommandMacroRuntime(row)">取消</el-button>
              <el-button link type="primary" size="small" @click="openCommandMacroDraftEdit(row.raw)">编辑</el-button>
              <el-button link type="danger" size="small" @click="deleteCommandMacroDraft(row.raw)">删除</el-button>
            </template>
          </SettingPagedTable>
          <p class="command-macro-dialog-note">
            组合命令会在快捷键刷新时动态注册为 macro.* command；当前仍只允许非写入 command 进入组合。
          </p>
        </el-dialog>
        <el-dialog
          v-model="contextMenuDialogVisible"
          title="右键菜单"
          width="720px"
          align-center
          class="setting-modal-dialog command-macro-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
        >
          <SettingPagedTable
            :rows="contextMenuActionRows"
            :columns="contextMenuActionColumns"
            :total="contextMenuActionRows.length"
            row-key="id"
            empty-text="暂无右键菜单项"
            :show-pagination="false"
            body-max-height="360px"
            draggable
            drag-handle=".context-menu-drag-handle"
            :move-guard="allowContextMenuActionDrag"
            @drag-end="handleContextMenuActionDragEnd"
          >
            <template #cell-drag="{ row }">
              <span
                v-if="row.orderable"
                class="drag-handle context-menu-drag-handle"
                title="拖拽调整右键菜单顺序"
              >⋮⋮</span>
              <span
                v-else
                class="feature-shortcut-muted"
                title="该动作固定在第 2 位"
              >固定</span>
            </template>
            <template #cell-title="{ row }">
              <div class="command-macro-cell">
                <div class="command-macro-title">
                  <span class="context-menu-action-icon">{{ row.icon }}</span>
                  <span>{{ row.title }}</span>
                  <span v-if="row.risk === 'data-write'" class="shortcut-risk-tag">写入</span>
                </div>
                <div class="command-macro-meta">{{ row.id }}</div>
              </div>
            </template>
            <template #cell-shortcut="{ row }">
              <button
                v-if="row.shortcutSummary.count"
                type="button"
                class="feature-shortcut-link"
                :title="row.shortcutSummary.hint"
                :aria-label="`查看 ${row.title} 的 command 快捷键：${row.shortcutSummary.label}`"
                @click="openContextMenuShortcut(row)"
              >
                {{ row.shortcutSummary.label }}
              </button>
              <span v-else class="feature-shortcut-muted" :title="row.shortcutSummary.hint">
                {{ row.shortcutSummary.label }}
              </span>
            </template>
            <template #cell-sourceLabel="{ row }">
              <span class="shortcut-source-tag" :class="{ user: row.source !== 'system' }">{{ row.sourceLabel }}</span>
            </template>
          </SettingPagedTable>
          <p class="command-macro-dialog-note">
            右键抽屉渲染、数字序号执行和本列表共用同一 action 模型；当前仅管理顺序审计和恢复默认，不隐藏业务动作。
          </p>
          <template #footer>
            <el-button
              plain
              :disabled="!contextMenuDrawerOrder.length"
              @click="restoreContextMenuOrder"
            >
              恢复默认顺序
            </el-button>
            <el-button @click="contextMenuDialogVisible = false">关闭</el-button>
          </template>
        </el-dialog>
        <el-dialog
          v-model="commandMacroDraftDialogVisible"
          :title="commandMacroDraftMode === 'add' ? '新增组合命令' : '编辑组合命令'"
          width="560px"
          align-center
          class="setting-modal-dialog command-macro-dialog"
          modal-class="setting-modal-overlay"
          :modal="true"
          :close-on-click-modal="false"
        >
          <el-form class="feature-form" :model="commandMacroDraftForm" label-width="92px">
            <el-form-item label="标题">
              <el-input v-model="commandMacroDraftForm.title" placeholder="例如 打开设置并切换页签" />
            </el-form-item>
            <el-form-item label="快捷键">
              <el-input v-model="commandMacroDraftForm.shortcutId" placeholder="例如 c-s-1" />
            </el-form-item>
            <el-form-item label="When">
              <el-input v-model="commandMacroDraftForm.when" placeholder="例如 mainFocus" />
            </el-form-item>
            <el-form-item label="步骤">
              <div class="command-macro-step-list">
                <div
                  v-for="(step, index) in commandMacroDraftForm.steps"
                  :key="index"
                  class="command-macro-step-row"
                >
                  <span class="command-macro-step-index">{{ index + 1 }}</span>
                  <el-select v-model="step.command" filterable clearable placeholder="选择 command">
                    <el-option
                      v-for="command in macroCommandOptions"
                      :key="command.id"
                      :label="`${command.id} - ${command.title}`"
                      :value="command.id"
                    />
                  </el-select>
                  <input
                    v-model.number="step.delayMs"
                    class="command-macro-delay-input"
                    type="number"
                    :min="0"
                    :max="COMMAND_MACRO_MAX_DELAY_MS"
                    :step="50"
                    title="执行前延迟 ms"
                  >
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="commandMacroDraftForm.steps.length <= 1"
                    @click="removeCommandMacroDraftStep(index)"
                  >
                    删除
                  </el-button>
                </div>
                <el-button
                  plain
                  size="small"
                  :disabled="commandMacroDraftForm.steps.length >= COMMAND_MACRO_MAX_STEPS"
                  @click="addCommandMacroDraftStep"
                >
                  添加步骤
                </el-button>
              </div>
            </el-form-item>
          </el-form>
          <p class="command-macro-dialog-note">
            当前只允许非写入 command 进入组合命令，避免删除、清空、锁定等副作用被组合放大。
          </p>
          <template #footer>
            <el-button @click="commandMacroDraftDialogVisible = false">取消</el-button>
            <el-button type="primary" @click="submitCommandMacroDraft">{{ commandMacroDraftMode === 'add' ? '保存草稿' : '保存修改' }}</el-button>
          </template>
        </el-dialog>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import draggable from 'vuedraggable'
import { ElMessage, ElMessageBox } from 'element-plus'
import setting, { saveSetting, getHoverPreviewConfig, getLineJoinConfig } from '../global/readSetting'
import defaultOperation from '../data/operation.json'
import { activateLayer, deactivateLayer } from '../global/hotkeyLayers'
import { getFeatureLabel } from '../global/hotkeyLabels'
import { COMMANDS } from '../global/commandDefaults.js'
import {
  buildContextMenuDrawerOrderFromRows,
  buildContextMenuActionRows,
  getContextMenuActionSummary
} from '../global/contextMenuActions'
import { formatShortcutDisplay, formatShortcutDisplayCompact, normalizeShortcutId } from '../global/shortcutKey'
import {
  applyShortcutOverrideValue,
  buildShortcutOverrideValue,
  disableCommandShortcutOverride,
  enableCommandShortcutOverride,
  filterShortcutCommandRows,
  getOperationShortcutSummary,
  shortcutIdsEqual
} from '../global/shortcutCommandRows'
import { formatShortcutConflictMessage, getShortcutCommandRowConflicts } from '../global/keybindingConflicts'
import { parseWhenExpression } from '../global/whenExpression'
import {
  WHEN_CONTEXT_GROUPS,
  WHEN_PRESETS,
  buildWhenExpression,
  getWhenBuilderSummary,
  getWhenBuilderDisabledKeys,
  parseWhenToSelection
} from '../global/whenBuilder'
import { eventLikeToShortcutId, isRecordableShortcutId, getShortcutReservationRows } from '../global/shortcutRecorder'
import { dedupeShortcutIds } from '../global/commandKeybindings'
import { registerCommandFeaturePairs, registerFeature, unregisterFeature } from '../global/hotkeyRegistry'
import { COMMAND_MACRO_MAX_DELAY_MS, COMMAND_MACRO_MAX_STEPS } from '../global/commandMacro.js'
import {
  SHORTCUT_RUNTIME_SOURCE_LOCAL,
  SHORTCUT_RUNTIME_SOURCE_PUBLIC,
  SHORTCUT_STORAGE_MODE_SQLITE,
  SHORTCUT_STORAGE_MODE_UTOOLS_SYNC,
  emitShortcutBindingsUpdated,
  ensureShortcutSyncDocument,
  getEffectiveShortcutCommandRows,
  getEffectiveShortcutOverrides,
  getLocalShortcutProfileId,
  getShortcutRuntimeSource,
  normalizeShortcutSyncDocument,
  promoteLocalShortcutProfileToPublic,
  saveShortcutSettingsPayload,
  setShortcutRuntimeSource,
  updateShortcutDeviceAlias
} from '../global/shortcutStore'
import {
  COMMAND_MACRO_STORAGE_MODE_SQLITE,
  getEffectiveCommandMacros,
  saveCommandMacros
} from '../global/commandMacroStore'
import {
  COMMAND_MACRO_RUNTIME_EVENT,
  getCommandMacroRuntimeSnapshot,
  requestCancelCommandMacroRun
} from '../global/commandMacroRuntime'
import { getNativeId } from '../utils'
import {
  LINE_JOIN_DEFAULT_SEPARATOR,
  LINE_JOIN_DEFAULT_SURROUND,
  normalizeLineJoinSeparator,
  normalizeLineJoinSurround,
  resolveLineJoinSurroundPair
} from '../utils/lineJoin.mjs'
import SettingPagedTable from '../cpns/SettingPagedTable.vue'
import HelpHint from '../cpns/HelpHint.vue'
import {
  THEME_DARK,
  THEME_LIGHT,
  THEME_SYSTEM,
  applyThemePreference,
  normalizeThemePreference
} from '../global/theme'
import {
  STORAGE_STATUS_EVENT,
  getStorageRuntimeStatus,
  markStorageNoticeRead
} from '../storage/storageRuntimeStatus'

const emit = defineEmits(['back'])
const { database, operation } = setting
const nativeId = getNativeId()

const unlimitedVal = 'unlimited'
const path = ref(database.path[nativeId])
const maxsize = ref(database.maxsize ?? unlimitedVal)
const maxage = ref(database.maxage ?? unlimitedVal)
const sqlitePath = computed(() => (path.value ? `${path.value}.sqlite` : ''))
const assetDir = computed(() => (path.value ? `${path.value}.sqlite.assets` : ''))
const storageStatus = ref(getStorageRuntimeStatus())
const isRetryingMigration = ref(false)
const refreshStorageStatus = (event) => {
  storageStatus.value = event?.detail || getStorageRuntimeStatus()
}
let disposeSettingCommandHandlers = null
const storageSqlitePath = computed(() => storageStatus.value.sqlitePath || sqlitePath.value)
const storageJsonPath = computed(() => storageStatus.value.jsonPath || path.value)
const storageAssetDir = computed(() => storageStatus.value.assetDir || assetDir.value)
const storageModeLabel = computed(() => {
  if (storageStatus.value.mode === 'sqlite') return 'SQLite 索引库 + 文件映射'
  if (storageStatus.value.mode === 'json-fallback') return 'JSON 降级模式'
  return '检测中'
})
const storageModeClass = computed(() => ({
  'is-fallback': storageStatus.value.mode === 'json-fallback'
}))
const storageMigrationLabel = computed(() => {
  const map = {
    idle: '未开始',
    checking: '检查中',
    migrating: '迁移中',
    migrated: '已迁移并应用 SQLite',
    'already-migrated': 'SQLite 已是最新',
    failed: '迁移失败'
  }
  return map[storageStatus.value.migrationStatus] || storageStatus.value.migrationStatus || '未知'
})
const isStorageMigrationActive = computed(() =>
  ['checking', 'migrating'].includes(storageStatus.value.migrationStatus)
)
const storageUpdatedAtLabel = computed(() => {
  const ts = Number(storageStatus.value.updatedAt)
  if (!ts) return '暂无'
  return new Date(ts).toLocaleString()
})

const custom = ref(operation.custom.map((c) => ({ ...c })))
const initialShortcutStorage = getEffectiveShortcutOverrides({ setting, nativeId })
const hotkeyOverrides = ref(initialShortcutStorage.hotkeyOverrides)
const shortcutStorageMode = ref(initialShortcutStorage.storageMode)
const shortcutSyncDialogVisible = ref(false)
const shortcutSyncDocument = ref(normalizeShortcutSyncDocument(setting?.userConfig?.shortcutSync))
const shortcutDeviceAlias = ref(shortcutSyncDocument.value.devices?.[nativeId]?.alias || nativeId)
const shortcutRuntimeSourceDraft = ref(getShortcutRuntimeSource(setting, nativeId))
const initialCommandMacroStorage = getEffectiveCommandMacros({ warn: () => {} })
const commandMacros = ref(initialCommandMacroStorage.macros)
const commandMacroStorageMode = ref(initialCommandMacroStorage.storageMode)
const initialHoverPreviewConfig = getHoverPreviewConfig(setting)
const hoverPreviewEnabled = ref(initialHoverPreviewConfig.enabled)
const hoverPreviewDelay = ref(initialHoverPreviewConfig.delay)
const initialLineJoinConfig = getLineJoinConfig(setting)
const lineJoinSeparator = ref(initialLineJoinConfig.separator)
const lineJoinSurround = ref(initialLineJoinConfig.surround)
const lineJoinSurroundPair = computed(() => resolveLineJoinSurroundPair(lineJoinSurround.value))
const lineJoinSurroundPreview = computed(() => {
  const pair = lineJoinSurroundPair.value
  return `${pair.open}文本${pair.close}`
})
const lineJoinSurroundHint = computed(() => {
  const pair = lineJoinSurroundPair.value
  return pair.open === pair.close
    ? `${pair.open} 作为一对对称包围符使用`
    : `自动匹配为 ${pair.open} ... ${pair.close}`
})
const themePreference = ref(normalizeThemePreference(setting?.userConfig?.appearance?.theme))
const themeOptions = [
  { value: THEME_LIGHT, label: '亮色' },
  { value: THEME_DARK, label: '暗色' },
  { value: THEME_SYSTEM, label: '跟随系统' }
]

const settingTabs = ['basic', 'shortcut', 'feature', 'feature-config']
const SETTING_TAB_STATE_KEY = 'ui.setting.activeTab'
const getUToolsRuntime = () => {
  if (typeof utools !== 'undefined') return utools
  return window?.utools || window?.exports?.utools || null
}
const getPersistedSettingTab = () => {
  try {
    const saved = getUToolsRuntime()?.dbStorage?.getItem?.(SETTING_TAB_STATE_KEY)
    return settingTabs.includes(saved) ? saved : 'basic'
  } catch (_) {
    return 'basic'
  }
}
const persistSettingTab = (tab) => {
  if (!settingTabs.includes(tab)) return
  try {
    getUToolsRuntime()?.dbStorage?.setItem?.(SETTING_TAB_STATE_KEY, tab)
  } catch (_) {}
}
const activeTab = ref(getPersistedSettingTab())
const settingRootRef = ref(null)
const shortcutQuery = ref('')
const shortcutQueryInput = ref('')
const featureQuery = ref('')
const featureListRows = ref([])
const shortcutScope = ref('all')
const shortcutScopeOptions = [
  { label: '全部', value: 'all' },
  { label: '主界面', value: 'main' },
  { label: '弹窗', value: 'dialog' },
  { label: '已改', value: 'user' },
  { label: '风险', value: 'risk' }
]
const shortcutSearchInputRef = ref(null)
const shortcutScopeSelectRef = ref(null)
let shortcutScopePopperKeyHandler = null
const currentShortcutScopeLabel = computed(
  () => shortcutScopeOptions.find((opt) => opt.value === shortcutScope.value)?.label || '全部'
)
const shortcutRecordVisible = ref(false)
const shortcutRecordRow = ref(null)
const shortcutRecordBaselineIds = ref([])
const shortcutRecordActiveIds = ref([])
const shortcutRecordPendingIds = ref([])
const shortcutRecordCapturedId = ref('')
const shortcutRecordDefaultIds = ref([])
const shortcutRecordDirectInput = ref('')
const shortcutRecordEditingIndex = ref(-1)
const shortcutRecordEditingValue = ref('')
const shortcutRecorderRef = ref(null)
const commandMacroDialogVisible = ref(false)
const commandMacroDraftDialogVisible = ref(false)
const contextMenuDialogVisible = ref(false)
const commandMacroDraftMode = ref('add')
const commandMacroEditId = ref('')
const commandMacroRuntimeSnapshot = ref(getCommandMacroRuntimeSnapshot())
const commandMacroDraftForm = ref({
  title: '',
  shortcutId: '',
  when: 'mainFocus',
  steps: [{ command: '', delayMs: 0 }]
})
const whenEditVisible = ref(false)
const whenEditRow = ref(null)
const whenEditBaseline = ref('')
const whenEditInput = ref('')
const whenEditError = ref('')
const whenEditConflictLabel = ref('')
const whenEditMode = ref('builder')
const whenBuilderOperator = ref('&&')
const whenBuilderStates = ref({})
const whenBuilderDisabledKeys = computed(() =>
  getWhenBuilderDisabledKeys(whenBuilderStates.value, whenBuilderOperator.value)
)
const shortcutKeyToCommands = computed(() => {
  const map = {}
  shortcutCommandRows.value.forEach(row => {
    const keys = row.shortcutIds || [row.shortcutId]
    keys.filter(Boolean).forEach(sid => {
      if (!map[sid]) {
        map[sid] = []
      }
      map[sid].push({
        commandId: row.commandId,
        commandTitle: row.commandTitle,
        scopeLabel: row.scopeLabel
      })
    })
  })
  return map
})
const getShortcutTooltipContent = (shortcutId) => {
  const commands = shortcutKeyToCommands.value[shortcutId]
  if (!commands || commands.length <= 1) return null
  return commands.map(c => `${c.commandTitle || c.commandId} (${c.scopeLabel})`).join('\n')
}
const SETTING_SHORTCUT_RECORD_LAYER = 'setting-shortcut-record'
const shortcutReservationRows = getShortcutReservationRows()
const shortcutRecordMergedIds = computed(() =>
  dedupeShortcutIds([...shortcutRecordActiveIds.value, ...shortcutRecordPendingIds.value])
)
const showShortcutRecordDefaultRestore = computed(() => {
  const defaults = dedupeShortcutIds(shortcutRecordDefaultIds.value)
  if (!defaults.length) return false
  return !shortcutIdsEqual(shortcutRecordMergedIds.value, defaults)
})
const canSubmitShortcutRecord = computed(() => shortcutRecordMergedIds.value.length > 0)
const SETTING_WHEN_EDIT_LAYER = 'setting-when-edit'
const whenEditDefaultWhen = computed(() => whenEditRow.value?.defaultWhen || '')
const showWhenEditDefaultRestore = computed(() => {
  if (!whenEditRow.value) return false
  return whenEditInput.value.trim() !== String(whenEditDefaultWhen.value || '').trim()
})

function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  if (target.isContentEditable) return true
  return Boolean(
    target.closest(
      'input, textarea, [contenteditable="true"], .el-input, .el-textarea, .el-select, .el-input-number'
    )
  )
}

function focusSettingSurface(event) {
  if (event?.target && isEditableTarget(event.target)) return
  settingRootRef.value?.focus?.({ preventScroll: true })
}

function isSettingOverlayOpen() {
  return Boolean(
    shortcutRecordVisible.value ||
    whenEditVisible.value ||
    customDialogVisible.value ||
    commandMacroDraftDialogVisible.value ||
    commandMacroDialogVisible.value ||
    contextMenuDialogVisible.value ||
    shortcutSyncDialogVisible.value ||
    isSettingMessageBoxOpen()
  )
}

function shouldAllowSettingArrowTabSwitch(e) {
  if (isSettingOverlayOpen()) return false
  if (!isEditableTarget(e.target)) return true
  const input = e.target?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=button])')
  if (!input || document.activeElement !== input) return false
  const start = input.selectionStart
  const end = input.selectionEnd
  if (start == null || end == null) return false
  if (start !== end) return false
  if (e.key === 'ArrowLeft') return start === 0
  if (e.key === 'ArrowRight') return start >= (input.value?.length || 0)
  return false
}

function switchSettingTabByOffset(delta) {
  const index = settingTabs.indexOf(activeTab.value)
  if (index === -1 || settingTabs.length === 0) return false
  const nextIndex = (index + delta + settingTabs.length) % settingTabs.length
  activeTab.value = settingTabs[nextIndex]
  return true
}

function scrollSettingBy(delta) {
  window.scrollBy({ top: delta, behavior: 'smooth' })
  return true
}

function sortShownByOrder(shownIds, order) {
  const orderMap = new Map(order.map((id, idx) => [id, idx]))
  return (Array.isArray(shownIds) ? shownIds.filter((id) => orderMap.has(id)) : []).sort(
    (a, b) => orderMap.get(a) - orderMap.get(b)
  )
}

const defaultOperationIds = defaultOperation.map((o) => o.id)

function buildFeatureOrder(savedOrder, customIds) {
  const allowed = new Set([...defaultOperationIds, ...customIds])
  const base = Array.isArray(savedOrder) ? savedOrder.filter((id) => allowed.has(id)) : []
  const rest = [...defaultOperationIds, ...customIds].filter((id) => !base.includes(id))
  return [...base, ...rest]
}

const featureOrder = ref(buildFeatureOrder(setting.operation?.order, custom.value.map((c) => c.id)))
const shown = ref(sortShownByOrder(operation.shown, featureOrder.value))
const commandMacroColumns = [
  { key: 'title', label: '组合命令', minWidth: 220 },
  { key: 'shortcutDisplay', label: '快捷键', width: 112 },
  { key: 'runtimeLabel', label: '状态', width: 96, align: 'center' },
  { key: 'stepCount', label: '步骤', width: 72, align: 'center' },
  { key: 'steps', label: '步骤摘要', minWidth: 260 },
  { key: 'storageLabel', label: '来源', width: 110, align: 'center' }
]
const contextMenuActionColumns = [
  { key: 'drag', label: '', width: 44, align: 'center' },
  { key: 'currentIndex', label: '序号', width: 70, align: 'center' },
  { key: 'title', label: '右键动作', minWidth: 240 },
  { key: 'shortcut', label: 'Command 快捷键', minWidth: 160 },
  { key: 'sourceLabel', label: '来源', width: 88, align: 'center' }
]

const effectiveShortcutCommandResult = computed(() =>
  getEffectiveShortcutCommandRows({
    setting: {
      ...setting,
      hotkeyOverrides: hotkeyOverrides.value,
      userConfig: {
        ...(setting.userConfig || {}),
        shortcutSync: shortcutSyncDocument.value
      }
    },
    nativeId,
    getFeatureLabel
  })
)

const shortcutCommandRows = computed(() => effectiveShortcutCommandResult.value.rows)
const shortcutCommandStorageMode = computed(() => effectiveShortcutCommandResult.value.storageMode)
const macroConflictRows = computed(() =>
  commandMacros.value
    .filter((macro) => macro?.shortcutId)
    .map((macro) => ({
      id: macro.id || `macro:${macro.shortcutId}`,
      commandId: macro.id || '',
      commandTitle: macro.title || macro.id || '未命名组合命令',
      shortcutId: macro.shortcutId || '',
      key: macro.shortcutId || '',
      when: macro.when || 'mainFocus',
      source: 'user',
      sourceLabel: '组合',
      disabled: macro.enabled === false,
      scopeLabel: '组合命令',
      type: 'macro'
    }))
)
const shortcutConflictRows = computed(() => [...shortcutCommandRows.value, ...macroConflictRows.value])

const shortcutHelpContent = computed(() =>
  [
    `以 command 形式展示实际生效的快捷键；输入关键词后按 ${formatShortcutDisplay('cr')} 搜索，${formatShortcutDisplay('c-f')} 可快速定位到搜索框。`,
    '支持多键绑定、禁用 action 触发、恢复默认和编辑 When 条件；冲突键录入时直接拒绝。'
  ].join(' ')
)

const shortcutStorageLabel = computed(() =>
  shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_UTOOLS_SYNC
    ? '快捷键配置存储：uTools 同步'
    : shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_SQLITE
    ? '快捷键配置存储：SQLite'
    : '快捷键配置存储：设置 fallback'
)

const shortcutStorageSourceLabel = computed(() => {
  if (shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_UTOOLS_SYNC) return 'uTools 同步'
  return shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_SQLITE ? 'SQLite' : 'Fallback'
})

const shortcutRuntimeSource = computed(() =>
  getShortcutRuntimeSource(
    {
      ...setting,
      userConfig: {
        ...(setting.userConfig || {}),
        shortcutSync: shortcutSyncDocument.value
      }
    },
    nativeId
  )
)

const shortcutRuntimeSourceLabel = computed(() =>
  shortcutRuntimeSource.value === SHORTCUT_RUNTIME_SOURCE_PUBLIC ? '公共配置' : '本机配置'
)

const localShortcutProfileId = computed(() => getLocalShortcutProfileId(nativeId))
const localShortcutProfileCount = computed(() =>
  Object.keys(shortcutSyncDocument.value.profiles?.[localShortcutProfileId.value]?.hotkeyOverrides || {}).length
)
const publicShortcutProfileCount = computed(() =>
  Object.keys(shortcutSyncDocument.value.profiles?.public?.hotkeyOverrides || {}).length
)
const shortcutSyncDeviceCount = computed(() => Object.keys(shortcutSyncDocument.value.devices || {}).length)
const shortcutSyncDeviceRows = computed(() => {
  const devices = shortcutSyncDocument.value.devices || {}
  const rows = Object.values(devices).map((device) => {
    const runtimeSource =
      shortcutSyncDocument.value.runtimeSourceByDevice?.[device.nativeId] ||
      device.runtimeSource ||
      SHORTCUT_RUNTIME_SOURCE_LOCAL
    const updatedAt = Number(device.updatedAt || device.lastUploadedAt) || 0
    return {
      nativeId: device.nativeId,
      alias: device.alias || device.nativeId,
      runtimeLabel: runtimeSource === SHORTCUT_RUNTIME_SOURCE_PUBLIC ? '公共配置' : '本机配置',
      updatedLabel: updatedAt ? new Date(updatedAt).toLocaleString() : '暂无时间',
      isCurrent: device.nativeId === nativeId
    }
  })
  if (!rows.some((row) => row.nativeId === nativeId)) {
    rows.push({
      nativeId,
      alias: shortcutDeviceAlias.value || nativeId,
      runtimeLabel: shortcutRuntimeSourceLabel.value,
      updatedLabel: '待上传',
      isCurrent: true
    })
  }
  return rows.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.alias.localeCompare(b.alias))
})

const shortcutStorageHint = computed(() =>
  shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_UTOOLS_SYNC
    ? '当前快捷键改动会保存到 setting.hotkeyOverrides，并按 uTools 数据同步形态参与运行时热更新。'
    : shortcutCommandStorageMode.value === SHORTCUT_STORAGE_MODE_SQLITE
    ? '当前快捷键改动会优先写入 SQLite override 表，并同步 setting 作为兼容副本。'
    : '当前快捷键改动会保存到 setting.hotkeyOverrides；SQLite 不可用或写入失败时使用该 fallback。'
)

function getShortcutSaveMessage(result, actionLabel = '保存') {
  const storageLabel = result?.storageMode === SHORTCUT_STORAGE_MODE_UTOOLS_SYNC
    ? 'uTools 同步配置'
    : result?.sqliteSaved ? 'SQLite' : '设置 fallback'
  return `${actionLabel}成功，快捷键已写入${storageLabel}，配置已热更新`
}

function showShortcutSaveMessage(result, actionLabel = '保存') {
  const message = getShortcutSaveMessage(result, actionLabel)
  if (
    result?.storageMode === SHORTCUT_STORAGE_MODE_UTOOLS_SYNC ||
    result?.sqliteSaved ||
    shortcutStorageMode.value === SHORTCUT_STORAGE_MODE_SQLITE
  ) {
    ElMessage.success(message)
  } else {
    ElMessage.warning(message)
  }
}

const filteredShortcutCommandRows = computed(() => {
  return filterShortcutCommandRows(shortcutCommandRows.value, {
    keyword: shortcutQuery.value,
    scope: shortcutScope.value,
    formatShortcut: formatShortcutDisplay
  })
})
const shortcutModifiedCount = computed(
  () => shortcutCommandRows.value.filter((row) => row.source === 'user' || row.source === 'removed').length
)
const commandMacroStorageHint = computed(() =>
  commandMacroStorageMode.value === COMMAND_MACRO_STORAGE_MODE_SQLITE
    ? '组合命令已可从 SQLite commandMacros repository 读写；配置快捷键后会在运行时注册执行。'
    : '组合命令当前使用内存草稿 fallback；SQLite 不可用或读取失败时不会阻断命令快捷键配置。'
)
const commandMacroSummary = computed(() =>
  `组合命令 ${commandMacros.value.length} 个，${commandMacroStorageMode.value === COMMAND_MACRO_STORAGE_MODE_SQLITE ? 'SQLite 已接入' : '内存草稿模式'}；已接入快捷键运行时执行。`
)
const contextMenuDrawerOrder = ref(
  Array.isArray(utools.dbStorage.getItem('drawer.order'))
    ? utools.dbStorage.getItem('drawer.order')
    : []
)
const contextMenuOperations = computed(() => [
  ...defaultOperation,
  ...custom.value
])
const contextMenuActionRows = computed(() =>
  buildContextMenuActionRows({
    operations: contextMenuOperations.value,
    drawerOrder: contextMenuDrawerOrder.value,
    shortcutRows: shortcutCommandRows.value,
    formatShortcut: formatShortcutDisplay
  })
)
const contextMenuActionSummary = computed(() => getContextMenuActionSummary(contextMenuActionRows.value))
const commandSystemConfigSummary = computed(
  () => `当前 ${shortcutCommandRows.value.length} 条 command keybinding，${shortcutModifiedCount.value} 条已修改或禁用。`
)
const featureConfigCommandHelp = computed(() =>
  [
    commandSystemConfigSummary.value,
    commandMacroSummary.value,
    contextMenuActionSummary.value,
    '本地 keybinding 优先 SQLite；不可用时回退 setting.hotkeyOverrides。'
  ].join(' ')
)
const commandMacroRows = computed(() => {
  const storageLabel = commandMacroStorageMode.value === COMMAND_MACRO_STORAGE_MODE_SQLITE ? 'SQLite' : '草稿'
  const runtimeMap = new Map(commandMacroRuntimeSnapshot.value.map((state) => [state.macroId, state]))
  return commandMacros.value.map((macro) => {
    const steps = Array.isArray(macro.steps) ? macro.steps : []
    const runtime = runtimeMap.get(macro.id)
    const runtimeStatus = runtime?.status || 'idle'
    const stepIds = steps.map((step) => step.command).filter(Boolean)
    const stepSummary = steps.length
      ? steps.slice(0, 3).map((step) => `${step.command || 'empty'}${step.delayMs ? ` +${step.delayMs}ms` : ''}`).join(' -> ')
      : '无步骤'
    const suffix = stepIds.length > 3 ? ` +${stepIds.length - 3}` : ''
    return {
      id: macro.id || '',
      title: macro.title || macro.id || '未命名组合命令',
      shortcutDisplay: macro.shortcutId ? formatShortcutDisplay(macro.shortcutId) : '未绑定',
      runtimeStatus,
      runtimeLabel: getCommandMacroRuntimeLabel(runtime),
      stepCount: steps.length,
      stepSummary: `${stepSummary}${suffix}`,
      stepHint: steps.map((step) => `${step.command || 'empty'} (${step.delayMs || 0}ms)`).join(' -> ') || '无步骤',
      storageLabel,
      canCancel: runtimeStatus === 'running' || runtimeStatus === 'cancelling',
      raw: macro
    }
  })
})
const macroCommandOptions = computed(() =>
  COMMANDS.filter((command) => command.risk !== 'data-write' && command.category !== 'macro')
    .map((command) => ({
      id: command.id,
      title: command.title || command.id
    }))
)

function refreshCommandMacroState() {
  const result = getEffectiveCommandMacros({ warn: () => {} })
  commandMacros.value = result.macros
  commandMacroStorageMode.value = result.storageMode
}

function refreshCommandMacroRuntime(event) {
  commandMacroRuntimeSnapshot.value = Array.isArray(event?.detail)
    ? event.detail
    : getCommandMacroRuntimeSnapshot()
}

function getCommandMacroRuntimeLabel(runtime) {
  const status = runtime?.status || 'idle'
  const labels = {
    idle: '空闲',
    running: runtime?.currentStep >= 0 ? `执行 ${runtime.currentStep + 1}/${runtime.totalSteps || '?'}` : '执行中',
    cancelling: '取消中',
    cancelled: '已取消',
    failed: '失败',
    completed: '完成'
  }
  return labels[status] || status
}

function openCommandMacroDraftAdd() {
  commandMacroDraftMode.value = 'add'
  commandMacroEditId.value = ''
  commandMacroDraftForm.value = {
    title: '',
    shortcutId: '',
    when: 'mainFocus',
    steps: [{ command: '', delayMs: 0 }]
  }
  commandMacroDraftDialogVisible.value = true
}

function openCommandMacroDraftEdit(macro) {
  const steps = Array.isArray(macro?.steps) ? macro.steps : []
  commandMacroDraftMode.value = 'edit'
  commandMacroEditId.value = macro?.id || ''
  commandMacroDraftForm.value = {
    title: macro?.title || '',
    shortcutId: macro?.shortcutId || '',
    when: macro?.when || 'mainFocus',
    steps: steps.length
      ? steps.map((step) => ({ command: step.command || '', delayMs: step.delayMs || 0 }))
      : [{ command: '', delayMs: 0 }]
  }
  commandMacroDraftDialogVisible.value = true
}

function addCommandMacroDraftStep() {
  if (commandMacroDraftForm.value.steps.length >= COMMAND_MACRO_MAX_STEPS) return
  commandMacroDraftForm.value.steps.push({ command: '', delayMs: 0 })
}

function removeCommandMacroDraftStep(index) {
  if (commandMacroDraftForm.value.steps.length <= 1) return
  commandMacroDraftForm.value.steps.splice(index, 1)
}

function buildCommandMacroDraftPayload() {
  const title = commandMacroDraftForm.value.title.trim()
  const shortcutId = normalizeShortcutId(commandMacroDraftForm.value.shortcutId || '')
  const when = (commandMacroDraftForm.value.when || '').trim() || 'mainFocus'
  const steps = commandMacroDraftForm.value.steps
    .filter((step) => step.command)
    .map((step) => ({ command: step.command, delayMs: step.delayMs || 0 }))
  return {
    id: commandMacroDraftMode.value === 'edit' && commandMacroEditId.value
      ? commandMacroEditId.value
      : `macro.${Date.now()}`,
    title: title || '未命名组合命令',
    shortcutId,
    when,
    steps
  }
}

function persistCommandMacrosDrafts(nextMacros, successMessage) {
  const result = saveCommandMacros(nextMacros, {
    warn: () => {}
  })
  if (!result.ok) {
    const message = result.errors?.[0]?.errors?.[0]?.message || '组合命令校验失败'
    ElMessage.error(message)
    return false
  }
  commandMacros.value = result.macros
  commandMacroStorageMode.value = result.storageMode
  refreshCommandMacroState()
  ElMessage.success(successMessage || (result.sqliteSaved ? '组合命令已写入 SQLite' : '组合命令已保存在内存模式'))
  return true
}

async function submitCommandMacroDraft() {
  const draft = buildCommandMacroDraftPayload()
  if (!draft.steps.length) {
    ElMessage.error('请至少选择一个 command')
    return
  }
  if (!draft.shortcutId || !isRecordableShortcutId(draft.shortcutId)) {
    ElMessage.error('请填写有效快捷键')
    return
  }
  try {
    if (draft.when) parseWhenExpression(draft.when)
  } catch (err) {
    ElMessage.error(`When 表达式无效：${err?.message || err}`)
    return
  }
  const conflicts = getShortcutCommandRowConflicts(
    {
      id: draft.id,
      shortcutId: draft.shortcutId,
      when: draft.when
    },
    shortcutConflictRows.value,
    {
      shortcutId: draft.shortcutId,
      when: draft.when
    }
  )
  if (conflicts.length) {
    const ok = await confirmShortcutConflictRows(conflicts, draft.shortcutId)
    if (!ok) return
  }
  const nextMacros = commandMacroDraftMode.value === 'edit'
    ? commandMacros.value.map((macro) => (macro.id === draft.id ? draft : macro))
    : [...commandMacros.value, draft]
  if (!persistCommandMacrosDrafts(
    nextMacros,
    commandMacroDraftMode.value === 'edit' ? '组合命令已更新' : '组合命令草稿已保存'
  )) return
  commandMacroDraftDialogVisible.value = false
  commandMacroDialogVisible.value = true
}

async function deleteCommandMacroDraft(macro) {
  if (!macro?.id) return
  try {
    await ElMessageBox.confirm(`确定删除组合命令“${macro.title || macro.id}”吗？`, '删除组合命令', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    persistCommandMacrosDrafts(
      commandMacros.value.filter((item) => item.id !== macro.id),
      '组合命令已删除'
    )
  } catch (_) {}
}

function cancelCommandMacroRuntime(row) {
  if (!row?.id) return
  if (requestCancelCommandMacroRun(row.id)) {
    ElMessage.warning(`已请求取消组合命令：${row.title || row.id}`)
  }
}

function applyShortcutSearch() {
  shortcutQuery.value = shortcutQueryInput.value.trim()
}

function focusShortcutSearch() {
  nextTick(() => {
    shortcutSearchInputRef.value?.focus?.()
  })
}

function getRecordShortcutContext() {
  const row = shortcutRecordRow.value
  return {
    commandId: row?.commandId || '',
    when: row?.when || ''
  }
}

function getShortcutConflictRowsWithWhen(row, nextShortcutId, nextWhen) {
  return getShortcutCommandRowConflicts(row, shortcutConflictRows.value, {
    shortcutId: nextShortcutId,
    when: nextWhen
  })
}

async function confirmShortcutConflictRows(conflicts, nextShortcutId) {
  if (!conflicts.length) return true
  const names = conflicts
    .slice(0, 5)
    .map((item) => `${formatShortcutDisplay(item.shortcutId)} / ${item.commandTitle} / ${item.scopeLabel} / ${getWhenBuilderSummary(item.when)}`)
    .join('；')
  try {
    await ElMessageBox.confirm(
      `该快捷键可能与 ${conflicts.length} 个命令冲突：${names}。仍要保存这个绑定吗？`,
      '快捷键冲突提醒',
      {
        confirmButtonText: '仍然保存',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    return true
  } catch (_) {
    return false
  }
}

function setShortcutOverride(row, overrideValue) {
  hotkeyOverrides.value = applyShortcutOverrideValue(hotkeyOverrides.value, row, overrideValue)
}

function measureShortcutScopeLabelWidth(label) {
  if (typeof document === 'undefined' || !label) return 56
  const el = document.createElement('span')
  el.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;font-size:12px;font-weight:600;white-space:nowrap;'
  el.textContent = label
  document.body.appendChild(el)
  const width = el.offsetWidth + 28
  document.body.removeChild(el)
  return Math.max(width, 56)
}

function syncShortcutScopePopperWidth(focusLabel) {
  const popperEl = document.querySelector('.shortcut-scope-popper')
  if (!popperEl) return
  const labels = focusLabel ? [focusLabel] : shortcutScopeOptions.map((opt) => opt.label)
  const maxWidth = Math.max(...labels.map((label) => measureShortcutScopeLabelWidth(label)))
  popperEl.style.minWidth = `${maxWidth}px`
  popperEl.style.width = 'max-content'
}

function detachShortcutScopePopperKeyHandler() {
  if (!shortcutScopePopperKeyHandler) return
  document.removeEventListener('keydown', shortcutScopePopperKeyHandler, true)
  shortcutScopePopperKeyHandler = null
}

function handleShortcutScopeVisible(visible) {
  if (!visible) {
    detachShortcutScopePopperKeyHandler()
    return
  }
  nextTick(() => {
    syncShortcutScopePopperWidth()
    detachShortcutScopePopperKeyHandler()
    shortcutScopePopperKeyHandler = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      requestAnimationFrame(() => {
        const activeItem = document.querySelector(
          '.shortcut-scope-popper .el-select-dropdown__item.is-hovering, .shortcut-scope-popper .el-select-dropdown__item.hover'
        )
        const label = activeItem?.textContent?.trim()
        if (label) syncShortcutScopePopperWidth(label)
      })
    }
    document.addEventListener('keydown', shortcutScopePopperKeyHandler, true)
  })
}

function isSettingMessageBoxOpen() {
  return Boolean(document.querySelector('.el-overlay .el-message-box'))
}

function closeTopSettingOverlay() {
  if (shortcutRecordVisible.value) {
    requestCloseShortcutRecord()
    return true
  }
  if (whenEditVisible.value) {
    requestCloseWhenEdit()
    return true
  }
  if (customDialogVisible.value) {
    customDialogVisible.value = false
    return true
  }
  if (commandMacroDraftDialogVisible.value) {
    commandMacroDraftDialogVisible.value = false
    return true
  }
  if (commandMacroDialogVisible.value) {
    commandMacroDialogVisible.value = false
    return true
  }
  if (contextMenuDialogVisible.value) {
    contextMenuDialogVisible.value = false
    return true
  }
  if (shortcutSyncDialogVisible.value) {
    shortcutSyncDialogVisible.value = false
    return true
  }
  return false
}

function openShortcutEdit(row) {
  whenEditVisible.value = false
  shortcutRecordRow.value = row
  const activeIds = dedupeShortcutIds(row.shortcutIds || [row.shortcutId])
  shortcutRecordActiveIds.value = [...activeIds]
  shortcutRecordPendingIds.value = []
  shortcutRecordCapturedId.value = ''
  shortcutRecordBaselineIds.value = [...activeIds]
  shortcutRecordDefaultIds.value = dedupeShortcutIds(row.defaultShortcutIds || [row.defaultShortcutId])
  shortcutRecordVisible.value = true
}

function syncShortcutDrawerPosition(event) {
  const cell = event.currentTarget
  const item = cell?.closest?.('.shortcut-list-item')
  const anchor = cell?.querySelector?.('.shortcut-id-anchor')
  if (!cell || !item || !anchor) return
  const anchorRect = anchor.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const left = Math.max(0, anchorRect.right - itemRect.left + 4)
  const maxWidth = Math.max(48, itemRect.width - left - 108)
  item.style.setProperty('--shortcut-drawer-left', `${left}px`)
  item.style.setProperty('--shortcut-drawer-max', `${maxWidth}px`)
}

function resetShortcutDrawerPosition(event) {
  const item = event.currentTarget?.closest?.('.shortcut-list-item')
  if (!item) return
  item.style.removeProperty('--shortcut-drawer-left')
  item.style.removeProperty('--shortcut-drawer-max')
}

function focusShortcutRecorder() {
  nextTick(() => {
    shortcutRecorderRef.value?.focus?.()
  })
}

function resetShortcutRecorder() {
  shortcutRecordRow.value = null
  shortcutRecordBaselineIds.value = []
  shortcutRecordActiveIds.value = []
  shortcutRecordPendingIds.value = []
  shortcutRecordCapturedId.value = ''
  shortcutRecordDirectInput.value = ''
  shortcutRecordDefaultIds.value = []
}

function restoreShortcutRecordToDefault() {
  shortcutRecordActiveIds.value = [...dedupeShortcutIds(shortcutRecordDefaultIds.value)]
  shortcutRecordPendingIds.value = []
  shortcutRecordCapturedId.value = ''
  shortcutRecordDirectInput.value = ''
  shortcutRecordEditingIndex.value = -1
  shortcutRecordEditingValue.value = ''
  focusShortcutRecorder()
}

function removeShortcutRecordActiveId(index) {
  shortcutRecordActiveIds.value = shortcutRecordActiveIds.value.filter((_, idx) => idx !== index)
}

function removeShortcutRecordPendingId(index) {
  shortcutRecordPendingIds.value = shortcutRecordPendingIds.value.filter((_, idx) => idx !== index)
}

function promoteShortcutRecordCaptured() {
  const captured = normalizeShortcutId(shortcutRecordCapturedId.value)
  if (!captured) return
  const context = getRecordShortcutContext()
  if (!isRecordableShortcutId(captured, context)) {
    ElMessage.warning('该快捷键不可绑定')
    return
  }
  if (!shortcutRecordPendingIds.value.includes(captured)) {
    shortcutRecordPendingIds.value = [...shortcutRecordPendingIds.value, captured]
  }
  shortcutRecordCapturedId.value = ''
  focusShortcutRecorder()
}

function handleDirectInputSubmit() {
  const input = shortcutRecordDirectInput.value.trim()
  if (!input) return
  const normalized = normalizeShortcutId(input)
  if (!normalized) {
    ElMessage.warning('无效的快捷键格式')
    return
  }
  if (!shortcutRecordPendingIds.value.includes(normalized)) {
    shortcutRecordPendingIds.value = [...shortcutRecordPendingIds.value, normalized]
  }
  shortcutRecordDirectInput.value = ''
}

function startEditingShortcut(index, sid) {
  shortcutRecordEditingIndex.value = index
  shortcutRecordEditingValue.value = sid
}

function finishEditingShortcut(index) {
  const newValue = shortcutRecordEditingValue.value.trim()
  if (!newValue) {
    cancelEditingShortcut()
    return
  }
  const normalized = normalizeShortcutId(newValue)
  if (!normalized) {
    ElMessage.warning('无效的快捷键格式')
    cancelEditingShortcut()
    return
  }
  const context = getRecordShortcutContext()
  if (!isRecordableShortcutId(normalized, context)) {
    ElMessage.warning('该快捷键不可绑定')
    cancelEditingShortcut()
    return
  }
  const updatedList = [...shortcutRecordPendingIds.value]
  updatedList[index] = normalized
  shortcutRecordPendingIds.value = updatedList
  cancelEditingShortcut()
}

function cancelEditingShortcut() {
  shortcutRecordEditingIndex.value = -1
  shortcutRecordEditingValue.value = ''
}

function isShortcutRecordDirty() {
  const currentIds = shortcutRecordCapturedId.value
    ? dedupeShortcutIds([...shortcutRecordMergedIds.value, shortcutRecordCapturedId.value])
    : shortcutRecordMergedIds.value
  return !shortcutIdsEqual(currentIds, shortcutRecordBaselineIds.value)
}

function isWhenEditDirty() {
  return whenEditInput.value.trim() !== whenEditBaseline.value.trim()
}

async function promptSaveUnsavedChanges(title) {
  try {
    await ElMessageBox.confirm('内容已修改，是否保存后再关闭？', title, {
      confirmButtonText: '保存',
      cancelButtonText: '不保存',
      type: 'warning',
      distinguishCancelAndClose: true
    })
    return 'save'
  } catch (action) {
    if (action === 'cancel') return 'discard'
    return 'abort'
  }
}

async function applyShortcutRecord() {
  const row = shortcutRecordRow.value
  const nextShortcutIds = dedupeShortcutIds(shortcutRecordMergedIds.value)
  if (!row || !nextShortcutIds.length) {
    ElMessage.error('请至少保留一个有效快捷键')
    return false
  }
  setShortcutOverride(
    row,
    buildShortcutOverrideValue(row, { shortcutIds: nextShortcutIds })
  )
  ElMessage.success('快捷键已更新，点击顶栏保存后生效')
  return true
}

async function requestCloseShortcutRecord() {
  if (!shortcutRecordVisible.value) return
  if (!isShortcutRecordDirty()) {
    shortcutRecordVisible.value = false
    return
  }
  const action = await promptSaveUnsavedChanges('录制快捷键')
  if (action === 'abort') return
  if (action === 'discard') {
    shortcutRecordVisible.value = false
    return
  }
  if (await applyShortcutRecord()) shortcutRecordVisible.value = false
}

function handleShortcutRecordBeforeClose(done) {
  if (!isShortcutRecordDirty()) {
    done()
    return
  }
  promptSaveUnsavedChanges('录制快捷键').then(async (action) => {
    if (action === 'discard') {
      done()
      return
    }
    if (action === 'abort') return
    if (await applyShortcutRecord()) done()
  })
}

async function applyWhenEdit() {
  const row = whenEditRow.value
  const nextWhen = whenEditInput.value.trim()
  if (!row) return false
  validateWhenEdit()
  if (whenEditError.value) return false
  const conflicts = getShortcutConflictRowsWithWhen(row, row.shortcutId, nextWhen)
  if (conflicts.length) {
    const ok = await confirmShortcutConflictRows(conflicts, row.shortcutId)
    if (!ok) return false
  }
  setShortcutOverride(row, buildShortcutOverrideValue(row, { when: nextWhen }))
  ElMessage.success('When 已更新，点击保存后生效')
  return true
}

async function requestCloseWhenEdit() {
  if (!whenEditVisible.value) return
  if (!isWhenEditDirty()) {
    whenEditVisible.value = false
    return
  }
  const action = await promptSaveUnsavedChanges('编辑 When 条件')
  if (action === 'abort') return
  if (action === 'discard') {
    whenEditVisible.value = false
    return
  }
  if (await applyWhenEdit()) whenEditVisible.value = false
}

function handleWhenEditBeforeClose(done) {
  if (!isWhenEditDirty()) {
    done()
    return
  }
  promptSaveUnsavedChanges('编辑 When 条件').then(async (action) => {
    if (action === 'discard') {
      done()
      return
    }
    if (action === 'abort') return
    if (await applyWhenEdit()) done()
  })
}

function handleShortcutRecordKeydown(e) {
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    requestCloseShortcutRecord()
    return
  }
  const nextShortcutId = eventLikeToShortcutId(e)
  const normalized = normalizeShortcutId(nextShortcutId)
  if (!normalized) return
  const context = getRecordShortcutContext()
  if (!isRecordableShortcutId(normalized, context)) {
    return
  }
  shortcutRecordCapturedId.value = nextShortcutId
}

async function submitShortcutRecord() {
  if (await applyShortcutRecord()) shortcutRecordVisible.value = false
}

function openWhenEdit(row) {
  shortcutRecordVisible.value = false
  whenEditRow.value = row
  whenEditBaseline.value = row.when || ''
  whenEditInput.value = whenEditBaseline.value
  syncWhenBuilderFromInput()
  whenEditVisible.value = true
  validateWhenEdit()
}

function resetWhenEditor() {
  whenEditRow.value = null
  whenEditBaseline.value = ''
  whenEditInput.value = ''
  whenEditError.value = ''
  whenEditConflictLabel.value = ''
  whenEditMode.value = 'builder'
  whenBuilderOperator.value = '&&'
  whenBuilderStates.value = {}
}

function syncWhenBuilderFromInput() {
  const parsed = parseWhenToSelection(whenEditInput.value)
  whenBuilderOperator.value = parsed.selection.operator || '&&'
  whenBuilderStates.value = { ...(parsed.selection.states || {}) }
  whenEditMode.value = parsed.mode === 'builder' ? 'builder' : 'text'
}

function syncWhenInputFromBuilder() {
  whenEditInput.value = buildWhenExpression({
    operator: whenBuilderOperator.value,
    states: whenBuilderStates.value
  })
  validateWhenEdit()
}

function setWhenBuilderState(key, state) {
  if (whenBuilderDisabledKeys.value.has(key)) return
  const next = { ...whenBuilderStates.value }
  if (!state || next[key] === state) delete next[key]
  else next[key] = state
  whenBuilderStates.value = next
  syncWhenInputFromBuilder()
}

function setWhenBuilderOperator(operator) {
  whenBuilderOperator.value = operator === '||' ? '||' : '&&'
  syncWhenInputFromBuilder()
}

function switchWhenEditMode(mode) {
  if (mode === 'builder') {
    syncWhenBuilderFromInput()
    if (whenEditMode.value !== 'builder') {
      ElMessage.warning('当前 When 较复杂，已保留文本模式')
    }
    return
  }
  whenEditMode.value = 'text'
}

function validateWhenEdit() {
  const row = whenEditRow.value
  whenEditError.value = ''
  whenEditConflictLabel.value = ''
  try {
    if (whenEditInput.value.trim()) parseWhenExpression(whenEditInput.value)
  } catch (err) {
    whenEditError.value = `When 表达式无效：${err?.message || err}`
    return
  }
  if (!row) return
  const conflicts = getShortcutConflictRowsWithWhen(row, row.shortcutId, whenEditInput.value.trim())
  if (conflicts.length) {
    whenEditConflictLabel.value = `可能与 ${conflicts.length} 个同快捷键命令冲突`
  }
}

function applyWhenEditPreset(nextWhen) {
  whenEditInput.value = nextWhen
  syncWhenBuilderFromInput()
  validateWhenEdit()
}

function restoreWhenEditToDefault() {
  applyWhenEditPreset(String(whenEditDefaultWhen.value || '').trim())
}

async function submitWhenEdit() {
  if (await applyWhenEdit()) whenEditVisible.value = false
}

async function disableShortcut(row) {
  try {
    const keys = (row.shortcutIds || [row.shortcutId]).map(formatShortcutDisplay).filter(Boolean).join(' / ')
    await ElMessageBox.confirm(
      `确定禁用「${row.commandTitle}」的快捷键触发吗？已绑定的 ${keys || '快捷键'} 将保留，按下不再执行。`,
      '禁用快捷键触发',
      {
        confirmButtonText: '禁用',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    hotkeyOverrides.value = disableCommandShortcutOverride(hotkeyOverrides.value, row)
    ElMessage.success('快捷键触发已禁用，点击顶栏保存后生效')
  } catch (_) {}
}

async function enableShortcut(row) {
  hotkeyOverrides.value = enableCommandShortcutOverride(hotkeyOverrides.value, row)
  ElMessage.success('快捷键触发已启用，点击顶栏保存后生效')
}

function restoreShortcutDefault(row) {
  setShortcutOverride(row, undefined)
  ElMessage.success('已恢复默认，点击保存后生效')
}

const customDialogVisible = ref(false)
const customDialogMode = ref('add')
const customFormRef = ref(null)
const customForm = ref({
  id: '',
  title: '',
  icon: '📌',
  matchStr: '["text"]',
  command: ''
})
const customFormRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  icon: [{ required: true, message: '请输入图标', trigger: 'blur' }],
  command: [{ required: true, message: '请输入命令', trigger: 'blur' }]
}
const customEditId = ref('')

const featureRows = computed(() => {
  const defaults = defaultOperation.map((o) => ({
    id: o.id,
    title: o.title,
    icon: o.icon,
    typeLabel: '默认',
    isCustom: false,
    matchDisplay: '',
    commandDisplay: '',
    shortcutSummary: getOperationShortcutSummary(o.id, shortcutCommandRows.value, formatShortcutDisplay),
    raw: o
  }))
  const customs = custom.value.map((o) => ({
    id: o.id,
    title: o.title,
    icon: o.icon,
    typeLabel: '自定义',
    isCustom: true,
    matchDisplay: Array.isArray(o.match) ? o.match.join(', ') : '',
    commandDisplay: o.command || '',
    shortcutSummary: {
      count: 0,
      activeCount: 0,
      label: '无直接快捷键',
      query: '',
      hint: '自定义功能暂未接入 command 快捷键'
    },
    raw: o
  }))
  const map = new Map([...defaults, ...customs].map((item) => [item.id, item]))
  return featureOrder.value
    .map((id, idx) => {
      const item = map.get(id)
      if (!item) return null
      return { ...item, index: idx + 1 }
    })
    .filter(Boolean)
})

const filteredFeatureRows = computed(() => {
  const keyword = featureQuery.value.trim().toLowerCase()
  if (!keyword) return featureRows.value
  return featureRows.value.filter((row) => {
    return [
      row.title,
      row.typeLabel,
      row.commandDisplay,
      row.shortcutSummary?.label,
      row.shortcutSummary?.hint,
      row.shortcutSummary?.query,
      row.id
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(keyword))
  })
})
const isFeatureFilterActive = computed(() => Boolean(featureQuery.value.trim()))

watch(
  () => (isFeatureFilterActive.value ? null : featureRows.value),
  (rows) => {
    if (rows) featureListRows.value = rows.map((row) => ({ ...row }))
  },
  { immediate: true, deep: true }
)

function normalizeHoverPreviewDelay(value = hoverPreviewDelay.value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 500
  return Math.round(numeric)
}

function ensureHoverPreviewDelay() {
  hoverPreviewDelay.value = normalizeHoverPreviewDelay()
}

function toggleHoverPreview() {
  if (!hoverPreviewEnabled.value) {
    ensureHoverPreviewDelay()
  }
  hoverPreviewEnabled.value = !hoverPreviewEnabled.value
}

function setThemePreference(nextTheme) {
  const theme = normalizeThemePreference(nextTheme)
  themePreference.value = theme
  const saved = saveSetting({
    ...setting,
    userConfig: {
      ...(setting.userConfig || {}),
      appearance: {
        ...(setting.userConfig?.appearance || {}),
        theme
      }
    }
  })
  themePreference.value = normalizeThemePreference(saved?.userConfig?.appearance?.theme)
  applyThemePreference(themePreference.value)
  const label = themeOptions.find((option) => option.value === themePreference.value)?.label || '亮色'
  ElMessage.success(`已切换为${label}`)
}

function buildShortcutSyncSetting(nextSetting = setting, nextDoc = shortcutSyncDocument.value) {
  return {
    ...nextSetting,
    userConfig: {
      ...(nextSetting.userConfig || {}),
      shortcutSync: normalizeShortcutSyncDocument(nextDoc)
    }
  }
}

function refreshShortcutSyncState(nextSetting = setting) {
  shortcutSyncDocument.value = normalizeShortcutSyncDocument(nextSetting?.userConfig?.shortcutSync)
  shortcutRuntimeSourceDraft.value = getShortcutRuntimeSource(nextSetting, nativeId)
  shortcutDeviceAlias.value = shortcutSyncDocument.value.devices?.[nativeId]?.alias || nativeId
}

function saveShortcutSyncSetting(nextSetting) {
  const saved = saveSetting(nextSetting)
  refreshShortcutSyncState(saved)
  return saved
}

function ensureShortcutSyncLocalProfile() {
  return ensureShortcutSyncDocument(buildShortcutSyncSetting(), {
    nativeId,
    alias: shortcutDeviceAlias.value,
    localOverrides: hotkeyOverrides.value
  })
}

async function promoteShortcutLocalToPublic() {
  try {
    await ElMessageBox.confirm('将本机快捷键配置设为公共配置，选择公共配置的其它机器会使用这份配置。确定继续？', '推为公共配置', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const ensured = ensureShortcutSyncLocalProfile()
    const saved = saveShortcutSyncSetting(promoteLocalShortcutProfileToPublic(ensured, { nativeId }))
    shortcutSyncDocument.value = normalizeShortcutSyncDocument(saved.userConfig?.shortcutSync)
    emitShortcutBindingsUpdated()
    ElMessage.success('已推为公共配置')
  } catch (_) {}
}

function applyShortcutRuntimeSource() {
  const ensured = ensureShortcutSyncLocalProfile()
  const saved = saveShortcutSyncSetting(setShortcutRuntimeSource(ensured, nativeId, shortcutRuntimeSourceDraft.value))
  const { hotkeyOverrides: nextOverrides, storageMode } = getEffectiveShortcutOverrides({ setting: saved, nativeId })
  hotkeyOverrides.value = nextOverrides
  shortcutStorageMode.value = storageMode
  emitShortcutBindingsUpdated()
  ElMessage.success(`已切换为${shortcutRuntimeSourceLabel.value}`)
}

function saveShortcutDeviceAlias() {
  const ensured = ensureShortcutSyncLocalProfile()
  saveShortcutSyncSetting(updateShortcutDeviceAlias(ensured, { nativeId, alias: shortcutDeviceAlias.value }))
  ElMessage.success('本机别名已保存')
}

const orderedOperations = computed(() =>
  featureRows.value.map((row) => ({ id: row.id, title: row.title, icon: row.icon, index: row.index }))
)

const allOperations = computed(() => orderedOperations.value)

function syncShownOrder() {
  const sorted = sortShownByOrder(shown.value, featureOrder.value)
  const changed = sorted.length !== shown.value.length || sorted.some((id, idx) => id !== shown.value[idx])
  if (changed) shown.value = sorted
}

function allowFeatureDrag(evt) {
  if (isFeatureFilterActive.value) return false
  return true
}

function handleFeatureDragEnd({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return
  featureOrder.value = rows.map((row) => row.id)
  custom.value = rows.filter((row) => row.isCustom).map((row) => row.raw)
  syncShownOrder()
}

function handleFeatureListDragEnd() {
  if (isFeatureFilterActive.value) return
  handleFeatureDragEnd({ rows: featureListRows.value })
}

function openCustomAdd() {
  customDialogMode.value = 'add'
  customForm.value = {
    id: '',
    title: '',
    icon: '📌',
    matchStr: '["text"]',
    command: ''
  }
  customEditId.value = ''
  customDialogVisible.value = true
}

function openCustomEdit(item) {
  customDialogMode.value = 'edit'
  customEditId.value = item.id
  customForm.value = {
    id: item.id,
    title: item.title,
    icon: item.icon,
    matchStr: Array.isArray(item.match) ? JSON.stringify(item.match, null, 2) : '[]',
    command: item.command || ''
  }
  customDialogVisible.value = true
}

function openFeatureShortcut(row) {
  const query = row?.shortcutSummary?.query || row?.id || ''
  activeTab.value = 'shortcut'
  shortcutQueryInput.value = query
  shortcutQuery.value = query
  focusShortcutSearch()
}

function openShortcutSystemConfig() {
  activeTab.value = 'shortcut'
  shortcutScope.value = 'all'
  shortcutQueryInput.value = ''
  shortcutQuery.value = ''
  focusShortcutSearch()
}

function openContextMenuShortcut(row) {
  const query = row?.shortcutSummary?.query || row?.commandId || row?.id || ''
  contextMenuDialogVisible.value = false
  activeTab.value = 'shortcut'
  shortcutScope.value = 'all'
  shortcutQueryInput.value = query
  shortcutQuery.value = query
  focusShortcutSearch()
}

function allowContextMenuActionDrag(evt) {
  return evt?.draggedContext?.element?.orderable !== false
}

function handleContextMenuActionDragEnd({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return
  contextMenuDrawerOrder.value = buildContextMenuDrawerOrderFromRows(rows)
  utools.dbStorage.setItem('drawer.order', contextMenuDrawerOrder.value)
  ElMessage.success('右键菜单顺序已更新')
}

function restoreContextMenuOrder() {
  contextMenuDrawerOrder.value = []
  utools.dbStorage.setItem('drawer.order', [])
  ElMessage.success('右键菜单已恢复默认顺序')
}

function parseMatch(str) {
  if (!str || typeof str !== 'string') return []
  const s = str.trim()
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch (_) {
    return []
  }
}

function submitCustomForm() {
  customFormRef.value?.validate?.((valid) => {
    if (!valid) return
    const match = parseMatch(customForm.value.matchStr)
    const payload = {
      id: customForm.value.id || `custom.${Date.now()}`,
      title: customForm.value.title.trim(),
      icon: (customForm.value.icon || '📌').trim(),
      match,
      command: (customForm.value.command || '').trim()
    }
    if (customDialogMode.value === 'add') {
      custom.value.push(payload)
    } else {
      const idx = custom.value.findIndex((c) => c.id === customEditId.value)
      if (idx !== -1) custom.value.splice(idx, 1, payload)
    }
    customDialogVisible.value = false
    ElMessage.success('已更新，保存后生效')
  })
}

function deleteCustom(item) {
  ElMessageBox.confirm(`确定删除「${item.title}」吗？`, '删除', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(() => {
      custom.value = custom.value.filter((c) => c.id !== item.id)
      if (shown.value.includes(item.id)) {
        shown.value = shown.value.filter((id) => id !== item.id)
      }
      ElMessage.success('已删除，保存后生效')
    })
    .catch(() => {})
}

watch(
  () => custom.value.map((c) => c.id),
  (ids) => {
    featureOrder.value = buildFeatureOrder(featureOrder.value, ids)
    syncShownOrder()
  }
)

watch(
  () => featureOrder.value,
  () => {
    syncShownOrder()
  },
  { deep: true }
)

function validateCustom() {
  for (const c of custom.value) {
    if (!c.id || !c.title || !c.icon) {
      ElMessage.error('自定义功能项须包含 id、标题、图标')
      return false
    }
  }
  return true
}

function validateFeatureConfig() {
  if (hoverPreviewEnabled.value) {
    const delay = Number(hoverPreviewDelay.value)
    if (!Number.isFinite(delay) || delay < 0) {
      ElMessage.error('预览触发时间需为不小于 0 的数字')
      return false
    }
    hoverPreviewDelay.value = Math.round(delay)
  }
  lineJoinSeparator.value = normalizeLineJoinSeparator(lineJoinSeparator.value)
  lineJoinSurround.value = normalizeLineJoinSurround(lineJoinSurround.value)
  return true
}

function openUtoolsHotkeySetting(label) {
  if (typeof utools !== 'undefined' && typeof utools?.redirectHotKeySetting === 'function') {
    utools.redirectHotKeySetting(label)
    return
  }
  ElMessage.info(`当前环境不支持跳转，请在 uTools 全局功能中搜索“${label}”并绑定快捷键`)
}

async function handleRetryStorageMigration() {
  if (typeof window.retryStorageMigration !== 'function') {
    ElMessage.error('当前环境不支持手动迁移重试')
    return
  }
  isRetryingMigration.value = true
  try {
    await window.retryStorageMigration()
    refreshStorageStatus()
    ElMessage.success('迁移重试成功，已切换到 SQLite')
  } catch (err) {
    refreshStorageStatus()
    ElMessage.error(`迁移重试失败：${err?.message || err}`)
  } finally {
    isRetryingMigration.value = false
  }
}

const handleSaveBtnClick = () => {
  if (path.value === '') {
    ElMessage.error('数据库路径不能为空')
    return
  }
  if (path.value.indexOf('_utools_clipboard_manager_storage') === -1) {
    ElMessage.error('数据库路径不正确')
    return
  }
  if (!validateCustom()) return
  if (!validateFeatureConfig()) return

  const payload = {
    database: {
      path: { ...database.path, [nativeId]: path.value },
      maxsize: maxsize.value === unlimitedVal ? null : maxsize.value,
      maxage: maxage.value === unlimitedVal ? null : maxage.value
    },
    operation: {
      shown: shown.value,
      custom: custom.value,
      order: featureOrder.value
    },
      hotkeyOverrides: hotkeyOverrides.value,
      userConfig: {
        ...(setting.userConfig || {}),
        shortcut: {
          syncWithUTools: false
        },
        shortcutSync: shortcutSyncDocument.value,
        preview: {
          ...(setting.userConfig?.preview || {}),
          hover: {
            enabled: hoverPreviewEnabled.value,
            delay: hoverPreviewEnabled.value ? normalizeHoverPreviewDelay() : normalizeHoverPreviewDelay()
          }
        },
        lineJoin: {
          ...(setting.userConfig?.lineJoin || {}),
          separator: normalizeLineJoinSeparator(lineJoinSeparator.value),
          surround: normalizeLineJoinSurround(lineJoinSurround.value)
        },
        appearance: {
          ...(setting.userConfig?.appearance || {}),
          theme: normalizeThemePreference(themePreference.value)
        }
      }
    }
  const shortcutSaveResult = saveShortcutSettingsPayload(payload, {
    overrides: hotkeyOverrides.value,
    nativeId,
    saveSetting
  })
  shortcutStorageMode.value = shortcutSaveResult.storageMode
  hotkeyOverrides.value = shortcutSaveResult.hotkeyOverrides
  shortcutSyncDocument.value = normalizeShortcutSyncDocument(shortcutSaveResult.setting?.userConfig?.shortcutSync)
  const savedLineJoinConfig = getLineJoinConfig(shortcutSaveResult.setting)
  lineJoinSeparator.value = savedLineJoinConfig.separator
  lineJoinSurround.value = savedLineJoinConfig.surround
  showShortcutSaveMessage(shortcutSaveResult, '保存')
}

const handlePathBtnClick = (param) => {
  if (param === 'modify') {
    const file = document.getElementById('database-path')
    file.click()
    file.onchange = (e) => {
      const { files } = e.target
      if (files.length > 0) {
        path.value = files[0].path
      }
      handleSaveBtnClick()
    }
  } else if (param === 'open') {
    utools.shellShowItemInFolder(path.value)
  }
}

const keyDownHandler = (e) => {
  if (e.__hotkeyHandled) return
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (isSettingMessageBoxOpen()) return
    if (closeTopSettingOverlay()) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!isEditableTarget(e.target)) {
      emit('back')
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  if (
    shortcutRecordVisible.value ||
    whenEditVisible.value ||
    customDialogVisible.value ||
    commandMacroDraftDialogVisible.value
  ) {
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!shouldAllowSettingArrowTabSwitch(e)) return
    const delta = e.key === 'ArrowLeft' ? -1 : 1
    if (switchSettingTabByOffset(delta)) {
      settingRootRef.value?.focus?.({ preventScroll: true })
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  if (isEditableTarget(e.target)) return
  const isSearchShortcut = (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'f'
  if (isSearchShortcut && activeTab.value === 'shortcut') {
    e.preventDefault()
    e.stopPropagation()
    focusShortcutSearch()
    return
  }
}

onMounted(() => {
  window.addEventListener(STORAGE_STATUS_EVENT, refreshStorageStatus)
  window.addEventListener(COMMAND_MACRO_RUNTIME_EVENT, refreshCommandMacroRuntime)
  refreshStorageStatus()
  refreshCommandMacroRuntime()
  if (storageStatus.value.noticeUnread) {
    storageStatus.value = markStorageNoticeRead()
  }
  disposeSettingCommandHandlers = registerCommandFeaturePairs([
    { featureId: 'setting-scroll-up', commandId: 'setting.scroll.up', handler: () => scrollSettingBy(-120) },
    { featureId: 'setting-scroll-down', commandId: 'setting.scroll.down', handler: () => scrollSettingBy(120) },
    {
      featureId: 'setting-tab-prev',
      commandId: 'setting.tab.prev',
      handler: (e) => shouldAllowSettingArrowTabSwitch(e) && switchSettingTabByOffset(-1)
    },
    {
      featureId: 'setting-tab-next',
      commandId: 'setting.tab.next',
      handler: (e) => shouldAllowSettingArrowTabSwitch(e) && switchSettingTabByOffset(1)
    }
  ])
  registerFeature('setting-overlay-block', () => ({ handled: true, preventDefault: false, stopPropagation: true }))
  activateLayer('setting')
  document.addEventListener('keydown', keyDownHandler, true)
  nextTick(() => {
    settingRootRef.value?.focus?.({ preventScroll: true })
  })
})

watch(activeTab, (tab) => {
  persistSettingTab(tab)
})

watch(shortcutRecordVisible, (visible) => {
  if (visible) activateLayer(SETTING_SHORTCUT_RECORD_LAYER)
  else deactivateLayer(SETTING_SHORTCUT_RECORD_LAYER)
})

watch(whenEditVisible, (visible) => {
  if (visible) activateLayer(SETTING_WHEN_EDIT_LAYER)
  else deactivateLayer(SETTING_WHEN_EDIT_LAYER)
})

watch(hoverPreviewEnabled, (enabled) => {
  if (enabled) {
    ensureHoverPreviewDelay()
  }
})

onUnmounted(() => {
  window.removeEventListener(STORAGE_STATUS_EVENT, refreshStorageStatus)
  window.removeEventListener(COMMAND_MACRO_RUNTIME_EVENT, refreshCommandMacroRuntime)
  document.removeEventListener('keydown', keyDownHandler, true)
  detachShortcutScopePopperKeyHandler()
  disposeSettingCommandHandlers?.()
  disposeSettingCommandHandlers = null
  unregisterFeature('setting-overlay-block')
  deactivateLayer('setting')
})
</script>

<style lang="less" scoped>
.setting {
  min-height: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  outline: none;
  background:
    radial-gradient(circle at top left, var(--primary-soft-bg), transparent 280px),
    linear-gradient(180deg, var(--text-bg-color-lighter) 0%, var(--bg-color) 100%);
}

.setting-card-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  --setting-tab-font: 12px;
  --setting-tab-h: calc(var(--setting-tab-font) + 2px);
}
.setting-header-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  position: sticky;
  top: 0;
  z-index: 10;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  background: var(--surface-glass-strong);
}
.setting-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}
.sub-tab-nav {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 2px;
  padding: 1px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--button-surface-gradient);
  box-shadow:
    0 4px 14px rgba(15, 23, 42, 0.05),
    inset 0 1px 0 var(--inset-highlight);
  overflow-x: auto;
  overflow-y: hidden;
  flex: 0 0 auto;
  min-width: 0;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.sub-tab-btn {
  position: relative;
  font-size: var(--setting-tab-font);
  font-weight: 600;
  line-height: 1;
  min-height: var(--setting-tab-h);
  height: var(--setting-tab-h);
  min-width: 0;
  padding: 0 8px;
  border-color: transparent;
  background: transparent;
  color: var(--text-color);
  border-radius: 8px;
  box-shadow: none;
  &.is-current {
    border-color: color-mix(in srgb, var(--primary-color) 35%, transparent);
    background: var(--surface-active-gradient);
    color: var(--primary-color);
    box-shadow:
      0 4px 12px color-mix(in srgb, var(--primary-color) 15%, transparent),
      0 0 0 1px color-mix(in srgb, var(--primary-color) 12%, transparent) inset;
  }
  &.is-current::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 2px;
    height: 2.5px;
    border-radius: 999px;
    background: currentColor;
    opacity: 1;
  }
}
.sub-tab-content {
  padding: 0;
  min-height: 0;
}
.sub-tab-content--fill {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.setting-card-content-item {
  display: block;
  margin: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}
.setting-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.setting-section-head-main {
  min-width: 0;
}
.setting-section-subtitle {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-lighter);
}
.shortcut-count {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-color-lighter);
}
.shortcut-storage-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  margin-top: 8px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--success-border);
  background: var(--success-bg);
  color: var(--success-color);
  font-size: 12px;
  font-weight: 600;
  &.fallback {
    color: var(--text-color-lighter);
    border-color: var(--border-color);
    background: var(--bg-soft-color);
    .shortcut-storage-dot {
      background: var(--text-color-lighter);
      box-shadow: none;
    }
  }
}
.shortcut-storage-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #1c7152;
  box-shadow: 0 0 0 3px rgba(28, 113, 82, 0.12);
}
.shortcut-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.shortcut-summary-card {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  box-shadow: 0 14px 28px var(--shadow-color);
  strong {
    display: block;
    margin-top: 4px;
    font-size: 15px;
    color: var(--text-color);
  }
  p {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-color-lighter);
  }
}
.shortcut-summary-label {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--primary-color);
  background: var(--bg-soft-color);
}
.setting-section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color);
  letter-spacing: 0.01em;
}
.setting-search-row {
  margin-top: 14px;
}
.filter-chip-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-elevated-color);
  color: var(--text-color-lighter);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
  &:hover {
    color: var(--text-color);
    border-color: var(--border-color-strong);
    background: var(--nav-hover-bg-color);
  }
  &.active {
    color: var(--primary-color);
    border-color: color-mix(in srgb, var(--primary-color) 26%, transparent);
    background: var(--bg-soft-color);
    font-weight: 600;
  }
}
.filter-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-color-lighter);
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  color: var(--text-color);
}
.setting-label {
  min-width: 92px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}
.setting-unit {
  font-size: 13px;
  color: var(--text-color-lighter);
}
.setting-static-value {
  display: inline-flex;
  align-items: center;
  max-width: min(520px, 58vw);
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--bg-soft-color);
  border: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.setting-static-value--danger {
  color: var(--danger-color);
  border-color: var(--danger-border);
  background: var(--danger-bg);
}
.storage-progress {
  flex: 1;
  min-width: 180px;
  max-width: 520px;
}
.setting-row--hint {
  margin-top: -4px;
}
.setting-storage-compact {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
}
.setting-panel {
  padding: 0;
  border-radius: 0;
  border: 1px solid var(--border-color);
}
.setting-panel--config {
  background: var(--surface-glass);
}
.setting-panel--status {
  background: var(--surface-row-gradient);
  border-color: var(--border-color);
}
.setting-row--compact {
  margin: 0;
  & + & {
    margin-top: 6px;
  }
}
.setting-row--split {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.setting-field-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.setting-panel-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-bottom: 8px;
}
.setting-status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--success-border);
  background: var(--success-bg);
  color: var(--success-color);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  &.is-fallback {
    color: var(--danger-color);
    border-color: var(--danger-border);
    background: var(--danger-bg);
  }
  &.is-danger {
    color: var(--danger-color);
    border-color: var(--danger-border);
    background: var(--danger-bg);
  }
}
.setting-status-time {
  font-size: 11px;
  color: var(--text-color-lighter);
  white-space: nowrap;
}
.setting-path-strip {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.setting-path-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.setting-path-tag {
  flex: 0 0 auto;
  min-width: 44px;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-color);
  letter-spacing: 0.02em;
}
.setting-path-value {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--surface-glass);
  border: 1px solid var(--border-color);
  font-size: 11px;
  line-height: 20px;
  color: var(--text-color-lighter);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.setting-static-value--compact {
  min-height: 24px;
  padding: 2px 8px;
  font-size: 11px;
  max-width: min(560px, 72vw);
}
.setting-storage-compact .setting-label {
  min-width: 72px;
  font-size: 12px;
}
.setting-storage-compact .setting-section-action {
  min-height: 30px;
  padding: 0 12px;
}
.setting-storage-compact .number-select :deep(.el-select__wrapper) {
  min-height: 24px;
  padding: 0 4px;
}
.setting-storage-compact .number-select :deep(.el-select__wrapper .el-select__selected-item) {
  overflow: visible;
  flex: 1 1 auto;
  min-width: 0;
}
.setting-storage-compact .number-select :deep(.el-select__wrapper .el-select__selection) {
  overflow: visible;
  width: auto;
  flex: 1 1 auto;
  min-width: 0;
}
.setting-storage-compact .number-select :deep(.el-input__wrapper) {
  min-height: 24px;
  padding: 0 4px;
}
.setting-storage-compact .number-select :deep(.el-input__inner) {
  padding: 0;
  text-overflow: clip;
  overflow: visible;
}
.setting-storage-compact .number-select :deep(.el-input__suffix) {
  flex-shrink: 0;
  width: 16px;
  margin-left: 0;
}
.setting-storage-compact .number-select :deep(.el-select__suffix) {
  margin-left: 28px;
  padding-left: 0;
  flex: 0 0 auto;
  position: relative;
}
.setting-storage-compact .number-select {
  width: 180px;
}
.setting-inline-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-lighter);
}
.path {
  flex: 1;
}
.number-select {
  width: 110px;
}
.operation-select {
  min-width: 260px;
}
.operation-select--popover {
  width: 100%;
}

.shortcut-key-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  max-width: 100%;
  padding: 3px 8px;
  background: var(--bg-soft-color);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shortcut-desc-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 100%;
}
.shortcut-command-cell {
  min-width: 0;
}
.shortcut-command-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.shortcut-command-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-color);
}
.shortcut-command-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-color-lighter);
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.shortcut-risk-tag,
.shortcut-source-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.shortcut-risk-tag {
  color: var(--danger-color);
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
}
.shortcut-source-tag {
  color: var(--text-color-lighter);
  background: var(--bg-soft-color);
  border: 1px solid var(--border-color);
  &.user {
    color: var(--primary-color);
    border-color: color-mix(in srgb, var(--primary-color) 26%, transparent);
    background: var(--primary-soft-bg);
  }
}
.shortcut-when-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: var(--text-color-lighter);
}
.shortcut-record-dialog :deep(.el-dialog__body) {
  padding: 14px 18px 12px;
  background: var(--bg-elevated-color);
}
.shortcut-record-head {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
}
.shortcut-record-head--command {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.shortcut-record-head-main {
  min-width: 0;
  flex: 1;
}
.shortcut-record-head-defaults {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}
.shortcut-record-command {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shortcut-record-command-id {
  margin-top: 2px;
  font-size: 11px;
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  color: var(--text-color-lighter);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shortcut-record-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 132px;
}
.shortcut-record-panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
  min-height: 132px;
  padding: 10px 12px;
  border: 1px solid var(--border-color-strong);
  border-radius: 12px;
  background: var(--bg-soft-color);
}
.shortcut-record-key-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.shortcut-record-key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.shortcut-record-key-remove {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger-color) 10%, transparent);
  color: var(--danger-color);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.shortcut-record-key-empty {
  font-size: 12px;
  color: var(--text-color-lighter);
  text-align: center;
  padding: 16px 0;
}
.shortcut-record-capture-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-color-strong);
  border-radius: 10px;
  background: var(--bg-soft-color);
  outline: none;
}
.shortcut-record-direct-input-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-elevated-color);
}
.shortcut-record-direct-input-row .el-input {
  flex: 1;
}
.shortcut-record-capture-hint {
  font-size: 12px;
  color: var(--text-color-lighter);
}
.shortcut-record-capture-staging {
  display: flex;
  align-items: center;
  gap: 8px;
}
.shortcut-record-capture-confirm {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: rgba(53, 95, 157, 0.12);
  color: var(--primary-color);
  font-size: 16px;
  cursor: pointer;
}
.shortcut-kbd-sep {
  color: var(--text-color-lighter);
  font-size: 11px;
}
.shortcut-reservation-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  th, td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    vertical-align: top;
  }
  th {
    font-weight: 700;
    color: var(--text-color-lighter);
  }
}
.shortcut-record-panel-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-color-lighter);
}
.shortcut-record-panel--current {
  background: var(--bg-elevated-color);
}
.shortcut-recorder {
  outline: none;
  cursor: default;
  &:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(53, 95, 157, 0.14);
  }
}
.shortcut-recorder-key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  color: var(--primary-color);
  font-size: 18px;
  font-weight: 700;
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.shortcut-recorder-key--current {
    color: var(--text-color);
    font-size: 16px;
    font-weight: 600;
  }
  &.is-waiting {
    color: var(--text-color-lighter);
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
  }
}
.shortcut-record-panel-default {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}
.shortcut-record-default-label {
  font-size: 12px;
  color: var(--text-color-lighter);
}
.shortcut-record-default-value {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  color: var(--text-color-lighter);
  font-size: 13px;
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
}
.shortcut-record-default-reset {
  padding: 3px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  color: var(--text-color-lighter);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  &:hover {
    color: var(--primary-color);
    border-color: var(--primary-color);
  }
}
.shortcut-recorder-manual {
  margin-top: 12px;
}
.shortcut-recorder-reserved {
  margin-bottom: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  background: var(--bg-soft-color);
  color: var(--text-color-lighter);
  font-size: 11px;
  text-align: center;
  cursor: help;
}
.when-edit-dialog :deep(.el-dialog__body) {
  padding: 14px 16px 12px;
  max-height: min(72vh, 580px);
  overflow-y: auto;
  background: var(--bg-elevated-color);
}
.when-editor-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color-strong);
  background: var(--bg-elevated-color);
}
.when-editor-head {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-soft-color);
}
.when-editor-mode-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  background: var(--bg-soft-color);
  border: 1px solid var(--border-color);
}
.when-editor-summary {
  min-width: 0;
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--primary-color);
  font-size: 10px;
  font-weight: 600;
  background: rgba(53, 95, 157, 0.1);
  border: 1px solid rgba(53, 95, 157, 0.14);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when-editor-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-color);
}
.when-editor-meta {
  margin-top: 3px;
  font-size: 10px;
  color: var(--text-color-lighter);
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.88;
}
.when-editor-status {
  min-height: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-color-lighter);
  background: rgba(28, 113, 82, 0.08);
  border: 1px solid rgba(28, 113, 82, 0.14);
  &.error {
    color: var(--danger-color);
    background: var(--danger-bg);
    border-color: var(--danger-border);
  }
}
.when-editor-presets {
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}
.when-editor-default {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px dashed var(--border-color);
  background: var(--bg-soft-color);
}
.when-editor-default-label {
  font-size: 11px;
  color: var(--text-color-lighter);
}
.when-editor-default-value {
  min-width: 0;
  max-width: 60%;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  color: var(--text-color-lighter);
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
  &:hover {
    color: var(--text-color);
    border-color: var(--primary-color);
  }
}
.when-editor-default-hint {
  font-size: 11px;
  color: var(--text-color-lighter);
}
.when-editor-presets-label {
  display: block;
  margin-bottom: 5px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-color-lighter);
  letter-spacing: 0.04em;
}
.when-editor-presets-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.filter-chip--when {
  min-height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  border-color: var(--border-color);
  background: var(--bg-elevated-color);
  &:hover {
    border-color: var(--border-color-strong);
    background: var(--nav-hover-bg-color);
  }
  &.active {
    color: #fff;
    border-color: transparent;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-color-lighter));
    box-shadow: 0 2px 10px rgba(53, 95, 157, 0.28);
  }
}
.when-builder {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-soft-color);
}
.when-builder-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.when-builder-toolbar-label {
  color: var(--text-color);
  font-size: 11px;
  font-weight: 700;
}
.when-operator-segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: 999px;
  background: var(--bg-elevated-color);
  border: 1px solid var(--border-color);
}
.when-builder-groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-height: min(52vh, 420px);
  overflow-y: auto;
  padding-right: 2px;
  scrollbar-width: thin;
}
.when-builder-group {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-elevated-color);
}
.when-builder-group--surface {
  border-color: rgba(53, 95, 157, 0.3);
  background: linear-gradient(160deg, rgba(53, 95, 157, 0.12), var(--bg-elevated-color));
}
.when-builder-group--state {
  border-color: rgba(31, 154, 114, 0.3);
  background: linear-gradient(160deg, rgba(31, 154, 114, 0.12), var(--bg-elevated-color));
}
.when-builder-group--overlay {
  border-color: rgba(217, 119, 6, 0.3);
  background: linear-gradient(160deg, rgba(217, 119, 6, 0.12), var(--bg-elevated-color));
}
.when-builder-group-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
}
.when-builder-group--surface .when-builder-group-title {
  color: var(--primary-color);
}
.when-builder-group--state .when-builder-group-title {
  color: #1f9a72;
}
.when-builder-group--overlay .when-builder-group-title {
  color: #d97706;
}
.when-builder-options {
  display: grid;
  gap: 6px;
}
.when-builder-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-soft-color);
  transition: border-color 0.14s ease, background-color 0.14s ease;
  &:hover:not(.is-disabled) {
    border-color: var(--border-color-strong);
    background: var(--nav-hover-bg-color);
  }
  &.is-set-include {
    border-color: rgba(31, 154, 114, 0.35);
    background: rgba(31, 154, 114, 0.14);
  }
  &.is-set-exclude {
    border-color: rgba(217, 119, 6, 0.35);
    background: rgba(217, 119, 6, 0.14);
  }
  &.is-disabled {
    opacity: 0.42;
    cursor: not-allowed;
    background: var(--bg-soft-color);
    border-style: dashed;
    border-color: var(--border-color);
  }
}
.when-builder-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-color);
  font-size: 11px;
  font-weight: 600;
}
.when-builder-option-actions {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 1px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.05);
  border: 1px solid rgba(53, 95, 157, 0.1);
  gap: 1px;
}
.when-state-btn {
  min-width: 30px;
  width: 30px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-color-lighter);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.14s ease;
  &:hover:not(.active-include):not(.active-exclude):not(:disabled) {
    background: rgba(53, 95, 157, 0.1);
    color: var(--text-color);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  &.active-include {
    color: #fff;
    background: linear-gradient(180deg, #34c38f, #1f9a72);
    box-shadow: 0 1px 6px rgba(31, 154, 114, 0.32);
  }
  &.active-exclude {
    color: #fff;
    background: linear-gradient(180deg, #f5a623, #e07a1e);
    box-shadow: 0 1px 6px rgba(224, 122, 30, 0.32);
  }
}
@media (max-width: 680px) {
  .when-builder-groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .when-builder-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
:global(html[data-theme='dark']) .when-builder-option {
  background: var(--bg-soft-color);
}
:global(html[data-theme='dark']) .when-builder-group--surface {
  background: linear-gradient(160deg, rgba(107, 143, 214, 0.16), var(--bg-elevated-color));
}
:global(html[data-theme='dark']) .when-builder-group--state {
  background: linear-gradient(160deg, rgba(31, 154, 114, 0.14), var(--bg-elevated-color));
}
:global(html[data-theme='dark']) .when-builder-group--overlay {
  background: linear-gradient(160deg, rgba(217, 119, 6, 0.14), var(--bg-elevated-color));
}
.drag-handle {
  cursor: grab;
  color: var(--text-color-lighter);
  font-size: 14px;
  user-select: none;
}
.feature-icon {
  font-size: 18px;
}
.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}
.setting-feature-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  padding: 0;
}
.feature-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border-radius: 0;
  margin-bottom: -1px;
  background: var(--surface-row-gradient);
  border: 1px solid var(--border-color);
  box-shadow: inset 0 1px 0 var(--inset-highlight);
}
.feature-strip--single {
  flex-wrap: nowrap;
}
.feature-strip-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--surface-glass);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color-lighter);
  white-space: nowrap;
  cursor: default;
}
.feature-strip-chip--home {
  border-color: rgba(53, 95, 157, 0.22);
  color: var(--primary-color);
  background: rgba(53, 95, 157, 0.08);
  cursor: pointer;
}
.feature-strip-chip--filter {
  border-color: var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning-color);
}
.feature-strip-chip--add {
  width: 24px;
  min-width: 24px;
  padding: 0;
  border-color: rgba(53, 95, 157, 0.28);
  background: var(--button-surface-gradient);
  color: var(--primary-color);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.feature-search-wrap {
  flex: 1 1 auto;
  min-width: 72px;
  max-width: none;
}
.setting-feature-shell .feature-search-wrap :deep(.el-input__wrapper) {
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  box-shadow: none;
}
.setting-feature-shell .feature-search-wrap :deep(.el-input__inner) {
  font-size: 11px;
}
.setting-help-btn--compact {
  width: 22px;
  min-width: 22px;
  height: 22px;
  padding: 0;
  font-size: 11px;
}
.feature-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  border-radius: 0;
  border-top: none;
  background: var(--surface-panel-gradient);
  border: 1px solid var(--border-color);
  scrollbar-width: thin;
}
.feature-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100%;
}
.feature-list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0;
  border-radius: 0;
  border: 1px solid transparent;
  background: var(--surface-glass);
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
  &:hover {
    border-color: rgba(53, 95, 157, 0.16);
    background: var(--surface-glass-strong);
    box-shadow: 0 6px 16px rgba(53, 95, 157, 0.08);
  }
  &.custom {
    border-left: 2px solid rgba(53, 95, 157, 0.35);
  }
}
.feature-list-grip {
  flex: 0 0 auto;
  width: 16px;
  text-align: center;
  color: var(--text-color-lighter);
  font-size: 11px;
  opacity: 0.35;
  cursor: grab;
  user-select: none;
  transition: opacity 0.16s ease, color 0.16s ease;
}
.feature-list-item:hover .feature-list-grip {
  opacity: 1;
  color: var(--primary-color);
}
.feature-list-grip--disabled {
  opacity: 0.15;
  cursor: not-allowed;
}
.feature-list-icon {
  flex: 0 0 auto;
  font-size: 15px;
  line-height: 1;
}
.feature-list-main {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
}
.feature-list-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feature-list-badge {
  flex: 0 0 auto;
  min-height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-soft-color);
  font-size: 9px;
  font-weight: 700;
  color: var(--text-color-lighter);
  &.custom {
    color: var(--primary-color);
    border-color: rgba(53, 95, 157, 0.2);
    background: rgba(53, 95, 157, 0.08);
  }
}
.feature-kbd {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  max-width: 132px;
  min-height: 20px;
  padding: 0 7px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 6px;
  background: linear-gradient(180deg, #f8fafc 0%, #e8eef5 100%);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.feature-kbd:hover {
  border-color: rgba(53, 95, 157, 0.28);
  color: var(--primary-color);
}
.feature-kbd--muted {
  cursor: default;
  color: var(--text-color-lighter);
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.feature-list-ops {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.16s ease;
}
.feature-list-item:hover .feature-list-ops {
  opacity: 1;
}
.feature-list-op {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.feature-list-op:hover {
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
}
.feature-list-op--danger {
  color: var(--danger-color);
}
.feature-list-op--danger:hover {
  background: color-mix(in srgb, var(--danger-color) 10%, transparent);
}
.feature-list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-lighter);
}
.feature-shortcut-link {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid rgba(53, 95, 157, 0.2);
  background: rgba(53, 95, 157, 0.08);
  color: var(--primary-color);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.feature-shortcut-link:hover {
  border-color: rgba(53, 95, 157, 0.35);
  background: rgba(53, 95, 157, 0.12);
}
.feature-select-popover-body {
  display: grid;
  gap: 8px;
}
@media (max-width: 900px) {
  .feature-search-wrap {
    max-width: none;
    flex-basis: 88px;
  }
}
.setting-shortcut-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  padding: 2px;
}
.shortcut-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border-radius: 0;
  margin-bottom: -3px;
  background: var(--surface-row-gradient);
  border: 2px solid var(--border-color);
  box-shadow: inset 0 1px 0 var(--inset-highlight);
}
.shortcut-strip--single {
  flex-wrap: nowrap;
}
.shortcut-system-notice {
  padding: 4px 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-color-lighter);
  background: rgba(53, 95, 157, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(53, 95, 157, 0.10);
}
.shortcut-strip-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  min-height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(28, 113, 82, 0.18);
  background: rgba(28, 113, 82, 0.08);
  white-space: nowrap;
  &.is-fallback {
    border-color: rgba(153, 99, 20, 0.24);
    background: rgba(153, 99, 20, 0.10);
    .shortcut-strip-meta-label {
      color: var(--warning-color);
    }
  }
}
.shortcut-strip-meta-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--success-color);
  letter-spacing: 0.02em;
}
.shortcut-strip-meta-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-color-lighter);
  &::before {
    content: '·';
    margin-right: 4px;
    color: rgba(53, 95, 157, 0.35);
  }
}
.shortcut-search-wrap {
  flex: 1 1 auto;
  min-width: 108px;
  max-width: none;
}
.shortcut-strip-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.setting-shortcut-shell .shortcut-search-wrap :deep(.el-input__wrapper) {
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(53, 95, 157, 0.12) inset;
}
.setting-shortcut-shell .shortcut-search-wrap :deep(.el-input__inner) {
  font-size: 11px;
}
.shortcut-scope-select {
  width: auto;
  min-width: 4em;
  max-width: 7em;
  flex: 0 0 auto;
}
.setting-shortcut-shell .shortcut-scope-select :deep(.el-select__wrapper) {
  min-height: 22px;
  padding: 0 4px 0 8px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(53, 95, 157, 0.12) inset;
  justify-content: flex-start;
}
.setting-shortcut-shell .shortcut-scope-select :deep(.el-select__selected-item) {
  font-size: 10px;
  font-weight: 600;
  overflow: visible;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
.setting-shortcut-shell .shortcut-scope-select :deep(.el-select__selection) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: visible;
  width: auto;
}
.setting-shortcut-shell .shortcut-scope-select :deep(.el-select__suffix) {
  margin-left: 16px;
  padding-left: 2px;
  flex: 0 0 auto;
  position: relative;
}
.shortcut-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  border-radius: 0;
  border-top: none;
  background: var(--surface-panel-gradient);
  border: 1px solid var(--border-color);
  scrollbar-width: thin;
}
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100%;
}
.shortcut-list--grid {
  --shortcut-cols: minmax(0, 0.78fr) minmax(60px, 0.52fr) minmax(50px, 0.40fr) minmax(36px, 0.28fr) minmax(36px, 0.28fr) 100px;
}
.shortcut-list-head,
.shortcut-list-item {
  display: grid;
  grid-template-columns: var(--shortcut-cols);
  column-gap: 5px;
  align-items: center;
}
.shortcut-list-head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0;
  margin-bottom: 0;
  border-bottom: 1px solid rgba(53, 95, 157, 0.10);
  background: var(--bg-soft-color);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-color-lighter);
  letter-spacing: 0.02em;
}
.shortcut-list-item {
  position: relative;
  overflow: hidden;
  min-height: 28px;
  padding: 0;
  border-radius: 0;
  border: 1px solid transparent;
  background: var(--surface-glass);
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
  &:hover {
    border-color: color-mix(in srgb, var(--primary-color) 16%, transparent);
    background: var(--surface-glass-strong);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--primary-color) 8%, transparent);
  }
  &.is-disabled {
    opacity: 0.55;
  }
  &.is-risk {
    border-left: 2px solid color-mix(in srgb, var(--danger-color) 35%, transparent);
  }
  &:has(.shortcut-id-cell:hover) {
    z-index: 2;
  }
}
.shortcut-col {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shortcut-col--id {
  font-size: 10px;
  color: var(--text-color-lighter);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.shortcut-id-cell {
  align-self: stretch;
  display: flex;
  align-items: center;
  min-height: 100%;
  overflow: visible;
}
.shortcut-id-anchor {
  position: relative;
  display: inline-block;
  max-width: 100%;
  cursor: default;
  vertical-align: middle;
  &:hover .shortcut-id-value {
    color: var(--primary-color);
  }
}
.shortcut-id-value {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.18s ease;
}
.shortcut-id-drawer {
  grid-column: 1 / -1;
  grid-row: 1;
  position: absolute;
  left: var(--shortcut-drawer-left, 0);
  top: 42%;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: var(--shortcut-drawer-max, 100%);
  height: 26px;
  transform: translateY(-50%);
  padding: 0 12px 0 16px;
  border-radius: 0 8px 8px 0;
  border: 1px solid rgba(53, 95, 157, 0.14);
  background: var(--surface-glass-strong);
  box-shadow: 4px 0 18px rgba(53, 95, 157, 0.10);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.18s ease, visibility 0.18s ease;
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, rgba(53, 95, 157, 0.45), rgba(53, 95, 157, 0.18));
  }
}
.shortcut-list-item:has(.shortcut-id-cell:hover) .shortcut-id-drawer {
  opacity: 1;
  visibility: visible;
}
.shortcut-id-drawer-label {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-color-lighter);
  text-transform: uppercase;
}
.shortcut-id-drawer-title {
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shortcut-col--scope {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
}
.shortcut-col--kbd {
  display: flex;
  justify-content: center;
  overflow: visible;
  .feature-kbd {
    max-width: 100%;
  }
}
.shortcut-col--when {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--text-color-lighter);
  text-align: center;
}
.shortcut-col--source {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-color-lighter);
  text-align: center;
  &.user {
    color: var(--primary-color);
  }
}
.shortcut-col--ops {
  display: flex;
  justify-content: flex-end;
  overflow: visible;
  min-width: 100px;
}
.shortcut-list-badge {
  flex: 0 0 auto;
  min-height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-soft-color);
  font-size: 9px;
  font-weight: 700;
  color: var(--text-color-lighter);
  white-space: nowrap;
}
.shortcut-list-badge--risk {
  color: var(--danger-color);
  border-color: var(--danger-border);
  background: var(--danger-bg);
}
.shortcut-list-ops {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.shortcut-list-op {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.shortcut-list-op:hover {
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
}
.shortcut-list-op--danger {
  color: var(--danger-color);
}
.shortcut-list-op--danger:hover {
  background: color-mix(in srgb, var(--danger-color) 10%, transparent);
}
.shortcut-list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 20px 12px;
  font-size: 12px;
  color: var(--text-color-lighter);
}
@media (max-width: 900px) {
  .shortcut-search-wrap {
    flex-basis: 120px;
    width: auto;
    max-width: none;
  }
  .shortcut-list--grid {
    --shortcut-cols: minmax(0, 0.7fr) minmax(52px, 0.48fr) minmax(48px, 0.38fr) 100px;
  }
  .shortcut-list-head .shortcut-col--when,
  .shortcut-list-head .shortcut-col--source,
  .shortcut-col--when,
  .shortcut-col--source {
    display: none;
  }
}
.feature-config-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.setting-feature-config-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.feature-config-panel--compact {
  gap: 0;
}
.feature-config-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: nowrap;
  width: 100%;
  padding: 18px 20px;
  border: 1px solid var(--border-color-strong);
  border-radius: 20px;
  background: var(--surface-panel-gradient);
  box-shadow:
    0 18px 36px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 var(--inset-highlight);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
  &:hover {
    border-color: var(--border-color-strong);
    box-shadow: 0 22px 42px var(--shadow-color);
  }
}
.feature-config-row--compact {
  padding: 0;
  gap: 8px;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border-color: var(--border-color);
  background: var(--surface-row-gradient);
  box-shadow: inset 0 1px 0 var(--inset-highlight);
  &:hover {
    box-shadow: inset 0 1px 0 var(--inset-highlight);
  }
}
.feature-config-meta-inline {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: wrap;
  strong {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color);
  }
}
.feature-config-control--compact {
  gap: 5px;
  flex-wrap: nowrap;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
}
.feature-config-control--line-join {
  flex-wrap: wrap;
  row-gap: 5px;
  overflow: visible;
}
.feature-config-row--compact .feature-config-title-row strong {
  font-size: 12px;
  font-weight: 600;
}
.feature-config-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 9px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--surface-glass);
  color: var(--text-color-lighter);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.14s ease;
  &:hover {
    border-color: color-mix(in srgb, var(--primary-color) 28%, transparent);
    color: var(--primary-color);
    background: var(--primary-soft-bg);
  }
}
.feature-config-chip--primary {
  border-color: color-mix(in srgb, var(--primary-color) 24%, transparent);
  color: var(--primary-color);
  background: var(--primary-soft-bg);
}
.theme-mode-chip.is-active {
  border-color: color-mix(in srgb, var(--primary-color) 38%, transparent);
  color: var(--primary-color);
  background: var(--primary-soft-bg-strong);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 18%, transparent);
}
.feature-config-status-mini {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--success-border);
  background: var(--success-bg);
  color: var(--success-color);
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
  &.fallback {
    border-color: var(--warning-border);
    background: var(--warning-bg);
    color: var(--warning-color);
  }
}
.shortcut-sync-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.shortcut-sync-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.shortcut-sync-label {
  flex: 0 0 72px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}
.shortcut-sync-profiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.shortcut-sync-profile,
.shortcut-sync-device-row {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-soft-color);
}
.shortcut-sync-profile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  strong {
    font-size: 12px;
    color: var(--text-color);
  }
  span {
    font-size: 12px;
    color: var(--text-color-lighter);
  }
}
.shortcut-sync-device-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
}
.shortcut-sync-device-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
}
.shortcut-sync-device-main,
.shortcut-sync-device-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.shortcut-sync-device-main {
  flex: 1 1 auto;
  strong {
    font-size: 12px;
    color: var(--text-color);
  }
  span {
    font-size: 11px;
    color: var(--text-color-lighter);
  }
}
.shortcut-sync-device-meta {
  flex: 0 0 auto;
  align-items: flex-end;
  span {
    font-size: 11px;
    color: var(--text-color-lighter);
  }
}
.feature-config-meta {
  flex: 0 0 auto;
  min-width: 0;
}
.feature-config-title-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  strong {
    display: block;
    font-size: 15px;
    color: var(--text-color);
  }
}
.feature-config-desc {
  margin: 8px 0 0;
  max-width: 360px;
  color: var(--text-color-lighter);
  font-size: 12px;
  line-height: 1.5;
}
.feature-config-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.setting-section-action {
  flex: 0 0 auto;
  white-space: nowrap;
}
.feature-config-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: nowrap;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: auto;
}
.feature-config-actions {
  flex-wrap: wrap;
}
.feature-config-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--success-border);
  border-radius: 999px;
  background: var(--success-bg);
  color: var(--success-color);
  font-size: 12px;
  font-weight: 700;
  &.fallback {
    border-color: var(--warning-border);
    background: var(--warning-bg);
    color: var(--warning-color);
  }
}
.command-macro-dialog :deep(.el-dialog__body) {
  padding: 16px 20px 18px;
}
.command-macro-cell {
  min-width: 0;
}
.command-macro-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-color);
}
.context-menu-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  margin-right: 6px;
}
.command-macro-meta,
.command-macro-dialog-note {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-color-lighter);
}
.command-macro-meta,
.command-macro-steps {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-macro-steps {
  font-family: 'SFMono-Regular', 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: var(--text-color-lighter);
}
.command-macro-step-list {
  display: grid;
  gap: 10px;
  width: 100%;
}
.command-macro-step-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 96px 44px;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.command-macro-delay-input {
  width: 96px;
  height: 32px;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0 8px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 12px;
  outline: none;
}
.command-macro-delay-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 14%, transparent);
}
.command-macro-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--bg-soft-color);
  color: var(--text-color-lighter);
  font-size: 12px;
  font-weight: 700;
}
.feature-config-inline-row {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: 0 1 auto;
  width: 152px;
  justify-content: flex-end;
}
.feature-toggle-group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.feature-toggle-group.is-fixed-right {
  min-width: 96px;
  justify-content: flex-end;
}
.feature-config-row--compact .feature-config-input.inline {
  padding: 3px 8px 3px 9px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(53, 95, 157, 0.12) inset;
}
.feature-config-row--compact .feature-config-inline-label {
  font-size: 10px;
  margin-right: 5px;
}
.feature-config-row--compact .feature-config-native-input {
  width: 44px;
  font-size: 11px;
}
.feature-config-row--compact .feature-config-input--line-join .feature-config-native-input {
  width: 72px;
}
.feature-config-row--compact .feature-config-input--line-surround .feature-config-native-input {
  width: 36px;
  text-align: center;
}
.line-surround-preview {
  flex: 0 1 auto;
  max-width: 126px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-color-lighter);
  font-size: 10px;
  line-height: 18px;
}
.feature-config-row--compact .feature-config-unit {
  font-size: 10px;
}
.toggle-pill--compact {
  min-width: 56px;
  height: 26px;
  gap: 5px;
  padding: 0 7px 0 6px;
  font-size: 11px;
  box-shadow: 0 4px 10px var(--shadow-color), inset 0 1px 0 var(--inset-highlight);
  &:hover {
    transform: none;
  }
}
.toggle-pill--compact .toggle-pill-track {
  width: 28px;
  height: 16px;
}
.toggle-pill--compact .toggle-pill-knob {
  width: 12px;
  height: 12px;
}
.toggle-pill--compact.is-off .toggle-pill-knob {
  transform: translateX(12px);
}
.toggle-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 84px;
  height: 38px;
  padding: 0 10px 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: #fff;
  box-shadow:
    0 12px 20px rgba(15, 23, 42, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
  &.is-on {
    background: linear-gradient(180deg, #42c86f 0%, #249e4f 100%);
  }
  &.is-off {
    background: linear-gradient(180deg, #f15a5a 0%, #cb3030 100%);
  }
  &:hover {
    transform: translateY(-1px);
  }
}
.toggle-pill-track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
}
.toggle-pill-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease;
}
.toggle-pill.is-off .toggle-pill-knob {
  transform: translateX(16px);
}
.toggle-pill-text {
  min-width: 20px;
  text-align: center;
}
.feature-config-input {
  display: inline-flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  &.inline {
    padding: 7px 10px 7px 12px;
    border: 1px solid var(--border-color-strong);
    border-radius: 14px;
    background: var(--button-surface-gradient);
    box-shadow:
      inset 0 1px 0 var(--inset-highlight),
      0 10px 18px rgba(15, 23, 42, 0.04);
  }
  &.is-hidden {
    visibility: hidden;
    pointer-events: none;
  }
}
.feature-config-inline-label {
  font-size: 12px;
  color: var(--text-color);
  margin-right: 8px;
  font-weight: 600;
  white-space: nowrap;
}
.feature-config-unit {
  font-size: 12px;
  color: var(--text-color-lighter);
  margin-left: 8px;
  min-width: 20px;
}
.feature-config-native-input {
  width: 88px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-color-strong);
  border-radius: 12px;
  background: var(--bg-elevated-color);
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
  &:hover {
    border-color: color-mix(in srgb, var(--primary-color) 24%, transparent);
  }
  &:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
}
.table-action-empty {
  color: var(--text-color-lighter);
}
.setting :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.setting :deep(.el-divider) {
  border-color: var(--border-color);
  margin: 18px 0 22px;
}
.setting :deep(.el-input),
.setting :deep(.el-select),
.setting :deep(.el-textarea),
.setting :deep(.el-input-number) {
  --el-border-radius-base: 14px;
  --el-border-radius-small: 12px;
}
.setting :deep(.el-input__wrapper),
.setting :deep(.el-select__wrapper),
.setting :deep(.el-textarea__inner),
.setting :deep(.el-input-number) {
  background: var(--bg-elevated-color);
  box-shadow:
    0 0 0 1px var(--border-color-strong) inset,
    0 2px 4px var(--shadow-color);
  border-radius: 14px;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}
.setting :deep(.el-input__wrapper:hover),
.setting :deep(.el-select__wrapper:hover),
.setting :deep(.el-textarea__inner:hover),
.setting :deep(.el-input-number:hover) {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--primary-color) 24%, transparent) inset,
    0 4px 10px color-mix(in srgb, var(--primary-color) 6%, transparent);
}
.setting :deep(.el-input__wrapper.is-focus),
.setting :deep(.el-select__wrapper.is-focused),
.setting :deep(.el-textarea__inner:focus),
.setting :deep(.el-input-number.is-controls-right .el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px var(--primary-color) inset,
    0 0 0 4px color-mix(in srgb, var(--primary-color) 10%, transparent);
}
.setting :deep(.el-input__inner),
.setting :deep(.el-textarea__inner),
.setting :deep(.el-input-number .el-input__inner) {
  color: var(--text-color);
  font-weight: 500;
}
.setting :deep(.el-input__inner::placeholder),
.setting :deep(.el-textarea__inner::placeholder) {
  color: var(--text-color-lighter);
}
.setting :deep(.el-card) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  background: var(--surface-glass-strong);
  border-color: var(--border-color-strong);
  border-radius: 0;
  box-shadow: inset 0 1px 0 var(--inset-highlight);
}
.setting-card {
  flex: 1;
  min-height: 0;
}
.setting-header-actions :deep(.el-button.setting-header-btn) {
  min-height: var(--setting-tab-h);
  height: var(--setting-tab-h);
  line-height: 1;
  padding: 0 11px;
  border-radius: 6px;
  font-size: var(--setting-tab-font);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.setting-header-actions :deep(.el-button.setting-header-btn--primary) {
  box-shadow: 0 4px 12px rgba(53, 95, 157, 0.18);
}
.sub-tab-nav :deep(.el-button.sub-tab-btn) {
  min-height: var(--setting-tab-h);
  height: var(--setting-tab-h);
  line-height: 1;
  padding: 0 8px;
  border-radius: 6px;
  font-size: var(--setting-tab-font);
  box-shadow: none;
}
.setting :deep(.el-button:not(.is-link)) {
  min-height: 40px;
  padding: 0 18px;
  border-radius: 14px;
  border-color: var(--border-color-strong);
  background: var(--button-surface-gradient);
  color: var(--text-color);
  transition: all 0.18s ease;
}
.setting :deep(.el-button:not(.is-link):hover) {
  border-color: var(--border-color-strong);
  background: var(--nav-hover-bg-color);
  color: var(--text-color);
}
.setting :deep(.el-button.is-plain) {
  background: var(--bg-elevated-color);
}
.setting :deep(.el-button--primary) {
  border-color: var(--primary-color);
  background: linear-gradient(180deg, var(--primary-color-lighter) 0%, var(--primary-color) 100%);
  color: #fff;
  box-shadow: 0 12px 24px color-mix(in srgb, var(--primary-color) 18%, transparent);
}
.setting :deep(.el-button--primary:hover) {
  border-color: var(--primary-color-lighter);
  background: var(--primary-color-lighter);
  color: #fff;
}
.setting :deep(.el-button.is-link) {
  color: var(--primary-color);
}
.setting :deep(.el-button.is-link:hover) {
  color: var(--primary-color-lighter);
}
.setting :deep(.el-pagination) {
  --el-pagination-bg-color: var(--bg-elevated-color);
  --el-pagination-text-color: var(--text-color-lighter);
  --el-pagination-button-color: var(--text-color);
  --el-pagination-button-disabled-color: var(--text-color-lighter);
  --el-pagination-button-disabled-bg-color: var(--bg-soft-color);
  --el-pagination-hover-color: var(--primary-color);
}
.setting :deep(.el-pagination .btn-prev),
.setting :deep(.el-pagination .btn-next),
.setting :deep(.el-pagination .el-pager li) {
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
}
.setting :deep(.el-pagination .el-pager li:hover),
.setting :deep(.el-pagination .btn-prev:hover),
.setting :deep(.el-pagination .btn-next:hover) {
  border-color: var(--border-color-strong);
  background: var(--nav-hover-bg-color);
}
.setting :deep(.el-pagination .el-pager li.is-active) {
  border-color: var(--primary-color);
  background: rgba(53, 95, 157, 0.12);
  color: var(--primary-color);
}
.setting :deep(.el-dialog) {
  border-radius: 22px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated-color);
  box-shadow: 0 28px 60px var(--shadow-color);
}
.setting :deep(.el-dialog__header) {
  padding: 20px 24px 0;
}
.setting :deep(.el-dialog__title) {
  color: var(--text-color);
  font-weight: 600;
}
.setting :deep(.el-dialog__footer) {
  padding: 8px 24px 24px;
}
.feature-dialog :deep(.el-dialog__body) {
  padding: 24px 32px 12px;
}
.feature-form {
  max-width: 760px;
  margin: 0 auto;
}
.feature-form :deep(.el-form-item) {
  margin-bottom: 18px;
}
.feature-form :deep(.el-textarea__inner) {
  min-height: 200px;
}

@media (max-width: 640px) {
  .shortcut-summary {
    grid-template-columns: 1fr;
  }
  .feature-config-row {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .feature-config-control {
    width: 100%;
    justify-content: flex-start;
    margin-left: 0;
    flex-wrap: wrap;
  }
  .feature-config-inline-row {
    width: auto;
  }
}
</style>
