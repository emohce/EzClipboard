/**
 * Central hotkey registry: feature handlers + bindings (shortcut + layer/state -> features).
 * Single dispatch: normalize -> find binding by layer priority -> run features in order.
 */

import { eventToShortcutId, getShortcutLookupIds } from "./shortcutKey.js";
import { normalizeShortcutId } from "./shortcutKey.js";
import { getActiveLayers, getCurrentLayer, getLayerPriorityStack } from "./hotkeyLayers.js";
import { getCommandAwareBindings } from "./hotkeyBindings.js";
import { buildHotkeyContextSnapshot, isEditableHotkeyTarget } from "./hotkeyContext.js";
import { resolveKeybinding } from "./keybindingResolver.js";

const MAIN_LAYER = "main";

/** Mac 上 Cmd 与 Ctrl 同根：匹配时把 meta 当作 ctrl，使现有 ctrl 绑定对 Cmd 生效 */
function isMac() {
  if (typeof window !== "undefined" && window.exports?.utools?.isMacOs?.())
    return true;
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform))
    return true;
  return false;
}

/** 用于查找的 shortcutId：Mac 上 meta 视为 ctrl，与 hotkeyBindings 中 ctrl 绑定统一 */
function shortcutIdForLookup(shortcutId) {
  if (!shortcutId || !isMac()) return shortcutId;
  return normalizeShortcutId(
    shortcutId
    .split("+")
    .map((p) => (p === "meta" ? "ctrl" : p))
    .join("+")
  );
}

const features = new Map();
const commands = new Map();
let bindings = [];
let bindingsVersion = null;
let commandAwareBindingsCache = [];
const mainStateRef = { current: "normal" };
let ignoreRepeat = true;

/**
 * @param {string} featureId
 * @param {(e: KeyboardEvent, ctx: object) => boolean | object} handler
 * Return true if handled (prevents default + stops propagation).
 * Or return an object:
 * {
 *   handled: true,
 *   preventDefault: false,
 *   stopPropagation: false,
 *   stopImmediatePropagation: false,
 *   markHandled: true
 * }
 */
export function registerFeature(featureId, handler) {
  if (!featureId || typeof handler !== "function") return;
  features.set(featureId, { handler });
}

export function unregisterFeature(featureId) {
  features.delete(featureId);
}

export function registerCommand(commandId, handler) {
  if (!commandId || typeof handler !== "function") return;
  commands.set(commandId, { handler });
}

export function unregisterCommand(commandId) {
  commands.delete(commandId);
}

export function hasCommandHandler(commandId) {
  return Boolean(commandId && commands.get(commandId)?.handler);
}

export async function runRegisteredCommand(commandId, args = {}, ctx = {}) {
  const commandEntry = commandId ? commands.get(commandId) : null;
  if (!commandEntry?.handler) {
    return { handled: false, status: "failed", error: "missing-handler" };
  }
  const result = await commandEntry.handler(ctx.event || null, {
    ...ctx,
    args,
    commandId,
  });
  const options = normalizeHandlerResult(result);
  return {
    handled: Boolean(options),
    status: options ? "completed" : "failed",
    error: options ? "" : "unhandled",
  };
}

export function registerCommandFeaturePair(featureId, commandId, handler) {
  if (!featureId || !commandId || typeof handler !== "function") return () => {};
  registerFeature(featureId, handler);
  registerCommand(commandId, handler);
  return () => {
    unregisterCommand(commandId);
    unregisterFeature(featureId);
  };
}

export function registerCommandFeaturePairs(pairs) {
  const disposers = (pairs || [])
    .filter((pair) => pair?.featureId && pair?.commandId && typeof pair.handler === "function")
    .map((pair) => registerCommandFeaturePair(pair.featureId, pair.commandId, pair.handler))
    .filter(Boolean);
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * @param {Array<{ layer: string, shortcutId: string, state?: string, features: string[] }>} list
 */
export function setBindings(list, version = null) {
  bindingsVersion = version;
  bindings = (list || []).map((b) => ({
    ...b,
    layer: b.layer,
    shortcutId: normalizeShortcutId(b.shortcutId),
    state: b.state,
    features: Array.isArray(b.features) ? b.features : [b.features].filter(Boolean),
  }));
  // bindings 只在此处写入，因此 command-aware 视图可以在这里一次性构建。
  // 修复前 dispatch 每次按键都重建全部绑定（长按方向键 = 每秒数千次对象分配）。
  commandAwareBindingsCache = getCommandAwareBindings(bindings);
}

export function getBindings() {
  return bindings;
}

export function getBindingsVersion() {
  return bindingsVersion;
}

export function setMainState(state) {
  mainStateRef.current = state || "normal";
}

export function getMainState() {
  return mainStateRef.current;
}

export function setIgnoreRepeat(value) {
  ignoreRepeat = Boolean(value);
}

/**
 * Resolve current layer for lookup: stack top or MAIN_LAYER when no overlay.
 */
function getEffectiveLayer() {
  const top = getCurrentLayer();
  return top || MAIN_LAYER;
}

/**
 * Layers to check in priority order: derived from static priority table.
 */
function getLayerPriorityOrder(activeLayers) {
  return getLayerPriorityStack(activeLayers)
}

/**
 * @param {string} layer
 * @param {string} state
 * @param {string} shortcutId
 * @returns {{ layer: string, shortcutId: string, state?: string, features: string[] } | null}
 */
function findBinding(layer, state, shortcutId) {
  for (const b of bindings) {
    if (b.layer !== layer) continue;
    if (b.shortcutId !== shortcutId) continue;
    if (b.state != null && b.state !== state) continue;
    return b;
  }
  if (layer !== MAIN_LAYER) {
    for (const b of bindings) {
      if (b.layer !== layer || b.shortcutId !== "*") continue;
      if (b.state != null && b.state !== state) continue;
      return b;
    }
  }
  return null;
}

export function resolveLegacyBinding(shortcutId, options = {}) {
  const {
    currentLayer = getCurrentLayer(),
    mainState = mainStateRef.current,
    bindingList = bindings,
    activeLayers,
  } = options;
  const layerSnapshot =
    activeLayers != null
      ? activeLayers
      : currentLayer
        ? [...getActiveLayers(), currentLayer]
        : getActiveLayers();
  const order = getLayerPriorityStack(layerSnapshot);

  for (const L of order) {
    for (const b of bindingList || []) {
      if (b.layer !== L) continue;
      if (b.shortcutId !== shortcutId) continue;
      if (b.state != null && b.state !== mainState) continue;
      return { binding: b, layer: L };
    }
    if (L !== MAIN_LAYER) {
      for (const b of bindingList || []) {
        if (b.layer !== L || b.shortcutId !== "*") continue;
        if (b.state != null && b.state !== mainState) continue;
        return { binding: b, layer: L };
      }
    }
  }

  return { binding: null, layer: null };
}

function featureList(binding) {
  return Array.isArray(binding?.features) ? binding.features : [binding?.features].filter(Boolean);
}

function commandList(binding) {
  return Array.isArray(binding?.commands) ? binding.commands : [binding?.commands].filter(Boolean);
}

function normalizeHandlerResult(result) {
  if (result === false || result == null) return null;
  if (result === true) {
    return {
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: false,
      markHandled: true,
    };
  }
  if (result && typeof result === "object") {
    if (result.handled === false) return null;
    return {
      preventDefault: result.preventDefault !== false,
      stopPropagation: result.stopPropagation !== false,
      stopImmediatePropagation: result.stopImmediatePropagation === true,
      markHandled: result.markHandled !== false,
    };
  }
  return {
    preventDefault: true,
    stopPropagation: true,
    stopImmediatePropagation: false,
    markHandled: true,
  };
}

function getExecutableEntries(binding) {
  const commandIds = commandList(binding);
  const featureIds = featureList(binding);
  const count = Math.max(commandIds.length, featureIds.length);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const commandId = commandIds[index];
    const featureId = featureIds[index];
    const commandEntry = commandId ? commands.get(commandId) : null;
    if (commandEntry?.handler) {
      entries.push({ type: "command", id: commandId, featureId, handler: commandEntry.handler });
    } else if (featureId) {
      const featureEntry = features.get(featureId);
      if (featureEntry?.handler) {
        entries.push({ type: "feature", id: featureId, commandId, handler: featureEntry.handler });
      }
    }
  }
  return entries;
}

export function previewKeybindingResolution(shortcutId, options = {}) {
  const {
    currentLayer = getCurrentLayer(),
    activeLayers = getActiveLayers(),
    mainState = mainStateRef.current,
    target = null,
    bindingList = bindings,
    contextExtra = {},
  } = options;
  const context = buildHotkeyContextSnapshot({
    currentLayer,
    activeLayers,
    mainState,
    target,
    extra: contextExtra,
  });
  const legacy = resolveLegacyBinding(shortcutId, {
    currentLayer,
    mainState,
    bindingList,
    activeLayers,
  });
  const commandBinding = resolveKeybinding(
    getCommandAwareBindings(bindingList),
    shortcutId,
    context,
    getLayerPriorityOrder(activeLayers)
  );
  const legacyFeatures = featureList(legacy.binding);
  const commandFeatures = featureList(commandBinding);

  return {
    context,
    legacy,
    commandBinding,
    matches:
      legacyFeatures.length === commandFeatures.length &&
      legacyFeatures.every((featureId, index) => featureId === commandFeatures[index]),
  };
}

/**
 * @param {KeyboardEvent} e
 * @returns {boolean} true if a binding matched and at least one feature handled the event
 */
const SETTING_LAYER = "setting";

export function dispatch(e) {
  if (e.__hotkeyHandled) return true;
  const REPEAT_ALLOWED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);
  if (ignoreRepeat && e.repeat && !REPEAT_ALLOWED_KEYS.has(e.key)) return false;

  if (e.isComposing) return false;

  // Element Plus MessageBox 打开时，Esc 只关闭当前弹窗，避免穿透到插件宿主退出。
  const messageBox =
    typeof document !== "undefined"
      ? document.querySelector(".el-overlay .el-message-box")
      : null;
  if (messageBox) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.__hotkeyHandled = true;
      messageBox.querySelector(".el-message-box__headerbtn")?.click?.();
      return true;
    }
    return false;
  }

  const shortcutId = eventToShortcutId(e);
  if (!shortcutId) return false;
  const lookupIds = getShortcutLookupIds(shortcutId).map(shortcutIdForLookup).filter(Boolean);
  const lookupId = lookupIds[0] || "";
  const currentLayer = getCurrentLayer();
  const state = mainStateRef.current;

  // 设置页：Del/Backspace 不进入其他层，保留正常文本编辑行为
  if (
    currentLayer === SETTING_LAYER &&
    (shortcutId === "del" || shortcutId === "backspace")
  ) {
    return false;
  }

  // 设置页输入控件聚焦时，不把按键继续分发给主界面热键，避免 cr/c-数字等误触发。
  if (currentLayer === SETTING_LAYER && isEditableHotkeyTarget(e.target)) {
    return false;
  }

  if (typeof window !== "undefined" && window.__EZCLIPBOARD_HOTKEY_SHADOW__ === true) {
    const preview = lookupIds
      .map((id) => previewKeybindingResolution(id, {
        currentLayer,
        activeLayers: getActiveLayers(),
        mainState: state,
        target: e.target,
        bindingList: bindings,
      }))
      .find((item) => item.commandBinding || item.legacy.binding) ||
      previewKeybindingResolution(lookupId, {
        currentLayer,
        activeLayers: getActiveLayers(),
        mainState: state,
        target: e.target,
        bindingList: bindings,
      });
    if (!preview.matches) {
      console.warn("[EzClipboard] hotkey shadow mismatch", {
        shortcutId: lookupId,
        legacy: preview.legacy.binding,
        commandBinding: preview.commandBinding,
        context: preview.context,
      });
    }
  }

  const activeLayers = getActiveLayers();
  const context = buildHotkeyContextSnapshot({
    currentLayer,
    activeLayers,
    mainState: state,
    target: e.target,
  });
  const commandAwareBindings = commandAwareBindingsCache;
  let binding = null;
  for (const id of lookupIds.length ? lookupIds : [lookupId]) {
    binding = resolveKeybinding(commandAwareBindings, id, context, getLayerPriorityOrder(activeLayers));
    if (binding) break;
  }
  if (!binding) return false;
  if (binding.commandEnabled === false || binding.enabled === false) return false;

  const ctx = { layer: binding.layer, state, commandBinding: binding, context };
  let handled = false;
  let handleOptions = null;
  for (const entry of getExecutableEntries(binding)) {
    const result = entry.handler(e, { ...ctx, commandId: entry.commandId || entry.id, featureId: entry.featureId || entry.id });
    const options = normalizeHandlerResult(result);
    if (options) {
      handled = true;
      handleOptions = options;
      break;
    }
  }
  if (handled) {
    const opts = handleOptions || {
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: false,
      markHandled: true,
    };
    if (opts.preventDefault) e.preventDefault();
    if (opts.stopImmediatePropagation) e.stopImmediatePropagation();
    else if (opts.stopPropagation) e.stopPropagation();
    if (opts.markHandled) e.__hotkeyHandled = true;
  }
  return handled;
}

export function getRegistry() {
  return {
    commands,
    features,
    bindings,
    setBindings,
    registerCommand,
    hasCommandHandler,
    runRegisteredCommand,
    registerCommandFeaturePair,
    registerCommandFeaturePairs,
    registerFeature,
    unregisterCommand,
    unregisterFeature,
    dispatch,
    setMainState,
    getMainState,
  };
}
