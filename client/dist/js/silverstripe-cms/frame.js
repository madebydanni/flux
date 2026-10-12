/******/ (function() { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./client/channels/FrameChannel.ts":
/*!*****************************************!*\
  !*** ./client/channels/FrameChannel.ts ***!
  \*****************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
const logger_1 = __webpack_require__(/*! ../core/logger */ "./client/core/logger.ts");
/**
 * Establish port-based messaging channel with the parent frame.
 * Message handler can be passed to constructor or set via onReceivedMessage property.
 *
 * @example client/cms-live-updates/frame.ts
 */
class FrameChannel {
  constructor(onReceivedMessage) {
    this.channel = null;
    this.messageHandler = event => this.setupMessageEvents(event);
    window.addEventListener("message", this.messageHandler);
    this.onReceivedMessage = onReceivedMessage || this.defaultMessageHandler.bind(this);
    if (window.parent !== window) {
      logger_1.logger.log("[channel] frame posting FRAME_READY →", window.location.href);
      window.parent.postMessage({
        type: 'FRAME_READY'
      }, window.location.origin);
    } else {
      console.warn("[channel] frame has no parent — not in an iframe, FRAME_READY not sent");
    }
  }
  setupMessageEvents(event) {
    if (event.origin !== window.location.origin) {
      logger_1.logger.error("Origin mismatch:", event.origin, "vs", window.location.origin);
      return;
    }
    if (event.data.action === "Host:Create") {
      logger_1.logger.log("[channel] frame received Host:Create — port connected");
      if (!event.ports || event.ports.length === 0) {
        console.warn("[channel] Host:Create arrived with NO ports — channel dead");
        return;
      }
      this.channel = event.ports[0];
      this.channel.onmessage = event => {
        logger_1.logger.log("[channel] frame port message:", event.data?.type);
        this.onReceivedMessage(event);
      };
      this.channel.start();
    }
  }
  /**
   * Fallback used when no custom `onReceivedMessage` handler was supplied.
   *
   * @param event
   */
  defaultMessageHandler(event) {
    logger_1.logger.log('Message called doing nothing', event);
  }
}
exports["default"] = FrameChannel;

/***/ }),

/***/ "./client/cms-live-updates/FluxBootstrap.ts":
/*!**************************************************!*\
  !*** ./client/cms-live-updates/FluxBootstrap.ts ***!
  \**************************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";


/**
 * Bridges the v2 `window.FluxBootstrap` payload into the v1 `window.FluxConfig`
 * shape that FluxLiveState / FluxDirectiveManager already consume.
 *
 * @todo need to merge in the various states from config to livestate into a single var
 */
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.adaptContextToFluxConfig = adaptContextToFluxConfig;
exports.applyContext = applyContext;
exports.applyInlineHostBootstrap = applyInlineHostBootstrap;
exports.currentContextHint = currentContextHint;
exports.applyPjaxBootstrapFromDom = applyPjaxBootstrapFromDom;
exports.fetchFluxContext = fetchFluxContext;
exports.fetchContextPayload = fetchContextPayload;
const logger_1 = __webpack_require__(/*! ../core/logger */ "./client/core/logger.ts");
/**
 * Convert a v2 context payload into the legacy FluxConfig shape.
 *
 * Preserves in-flight ChangeSet only when the same record is still being
 * edited (same page id + class). Switching records resets ChangeSet so we
 * don't misapply edits from page A onto a different record that happens to
 * share a class name.
 */
function adaptContextToFluxConfig(context) {
  const fields = {};
  const relationFields = {};
  for (const [className, slice] of Object.entries(context.schema)) {
    fields[className] = slice.Fields ?? {};
    relationFields[className] = slice.RelationFields ?? {};
  }
  const previous = window.FluxConfig;
  const previousPage = previous?.Segments?.find(s => s.Type === "Page");
  const nextPage = context.segments.find(s => s.Type === "Page");
  const sameRecord = !!previousPage && !!nextPage && String(previousPage.ID) === String(nextPage.ID) && previousPage.ClassName === nextPage.ClassName;
  let changeSet = {};
  if (sameRecord) {
    changeSet = previous?.ChangeSet ?? {};
  } else if (previous?.ChangeSet && Object.keys(previous.ChangeSet).length > 0) {
    logger_1.logger.error("Discarding pending changes: context switched records", {
      from: previousPage ? `${previousPage.ClassName}#${previousPage.ID}` : null,
      to: nextPage ? `${nextPage.ClassName}#${nextPage.ID}` : null,
      discarded: Object.keys(previous.ChangeSet)
    });
  }
  return {
    Segments: context.segments,
    Fields: fields,
    RelationFields: relationFields,
    ChangeSet: changeSet,
    Events: []
  };
}
function applyContext(context) {
  window.FluxConfig = adaptContextToFluxConfig(context);
  window.FluxScope = context.scope;
  logger_1.logger.log("Applied Flux context:", context.scope);
}
/**
 * Read the most-specific FluxBootstrap script tag in the document.
 * When nested items are edited, both LeftAndMain and GridFieldDetailForm add a
 * `<script id="flux-bootstrap-data">` — the inner one (later in DOM order) takes precedence.
 */
function readBootstrapScriptTag() {
  const nodes = document.querySelectorAll('script#flux-bootstrap-data');
  if (nodes.length === 0) return null;
  // Walk in reverse so the deepest (innermost form) wins.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const txt = nodes[i].textContent;
    if (!txt) continue;
    try {
      return JSON.parse(txt);
    } catch {
      // try the next one
    }
  }
  return null;
}
/**
 * Host entry: read the inline bootstrap injected by the LeftAndMain or
 * GridFieldDetailForm extension. Returns the FluxConfig that was set,
 * or null if no context was present.
 */
function applyBootstrapPayload(payload) {
  if (payload.csrf) window.FluxCsrf = payload.csrf;
  if (payload.contextHint !== undefined) window.FluxContextHint = payload.contextHint;
  if (payload.inlineEditorEnabled !== undefined) window.FluxInlineEditorEnabled = payload.inlineEditorEnabled;
  if (payload.liveUpdateInPreviewMode !== undefined) window.FluxLiveUpdateInPreviewMode = payload.liveUpdateInPreviewMode;
  applyContext(payload.context);
}
function applyInlineHostBootstrap() {
  const bootstrap = readBootstrapScriptTag() ?? window.FluxBootstrap ?? null;
  if (!bootstrap?.context) return null;
  applyBootstrapPayload(bootstrap);
  return window.FluxConfig ?? null;
}
/** Most-recent hint captured from a host-side bootstrap, for the host to ship to the frame. */
function currentContextHint() {
  return window.FluxContextHint ?? null;
}
/**
 * Host PJAX hook: read the FluxBootstrap from the most-specific
 * #flux-bootstrap-data <script> tag in the swapped form HTML. Standard CMS PJAX
 * requests only fetch CurrentForm/Content/Breadcrumbs, so the bootstrap is included inside the form HTML.
 */
function applyPjaxBootstrapFromDom() {
  const payload = readBootstrapScriptTag();
  if (!payload?.context) return false;
  applyBootstrapPayload(payload);
  return true;
}
/**
 * Preview-frame entry: fetch /flux/context with the params handed in by
 * the host (via the contextHint MessageChannel message). The frame can't
 * know which record/item is being edited on its own — only the CMS does.
 *
 * Resolves to the FluxConfig once applied.
 */
async function fetchFluxContext(hint) {
  const context = await fetchContextPayload(hint);
  if (!context) return null;
  applyContext(context);
  return window.FluxConfig ?? null;
}
/**
 * Fetch the context payload without applying it. Lets callers decide whether
 * to apply — the frame's boot fetch must not overwrite a more-specific scope the
 * host may have sent while the fetch was still running.
 */
async function fetchContextPayload(hint) {
  const params = new URLSearchParams();
  params.set("class", hint.class);
  params.set("id", String(hint.id));
  if (hint.itemID) params.set("itemID", String(hint.itemID));
  if (hint.relation) params.set("relation", hint.relation);
  try {
    const response = await fetch(`/flux/context?${params.toString()}`, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      logger_1.logger.warn("Flux context fetch failed:", response.status);
      return null;
    }
    return await response.json();
  } catch (error) {
    logger_1.logger.warn("Flux context fetch error:", error);
    return null;
  }
}

/***/ }),

/***/ "./client/cms-live-updates/directives/FluxDirectives.ts":
/*!**************************************************************!*\
  !*** ./client/cms-live-updates/directives/FluxDirectives.ts ***!
  \**************************************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.fromElement = fromElement;
exports.fromAttributes = fromAttributes;
exports.getElementValue = getElementValue;
exports.parse = parse;
exports.applyConfig = applyConfig;
const logger_1 = __webpack_require__(/*! ../../core/logger */ "./client/core/logger.ts");
function fromElement(el) {
  const key = el.getAttribute('fx-key');
  if (!key) return null;
  return {
    element: el,
    key,
    event: el.getAttribute('fx-event'),
    owner: el.getAttribute('fx-owner'),
    type: el.getAttribute('fx-type'),
    proxySelector: el.getAttribute('fx-proxy'),
    proxyType: el.getAttribute('fx-proxy-type'),
    collectSelector: el.getAttribute('fx-collect')
  };
}
/**
 * Same directive, built from an attribute map rather than the element — for
 * fields whose attributes only exist in the form schema (see FluxFormSchema).
 */
function fromAttributes(el, attributes) {
  const key = attributes['fx-key'];
  if (!key) return null;
  return {
    element: el,
    key,
    event: attributes['fx-event'] ?? null,
    owner: attributes['fx-owner'] ?? null,
    type: attributes['fx-type'] ?? null,
    proxySelector: attributes['fx-proxy'] ?? null,
    proxyType: attributes['fx-proxy-type'] ?? null,
    collectSelector: attributes['fx-collect'] ?? null
  };
}
function getElementValue(el) {
  return el.value ?? el.getAttribute('value') ?? '';
}
function parse(root = document) {
  return Array.from(root.querySelectorAll('[fx-key]')).map(el => fromElement(el)).filter(d => d !== null);
}
function applyConfig(config) {
  const {
    Segments,
    Fields,
    RelationFields
  } = config;
  if (!Segments) return;
  for (const segment of Segments) {
    applySegmentFields(segment, Fields?.[segment.ClassName]);
    applySegmentRelations(segment, RelationFields?.[segment.ClassName]);
    applyOwnerEditLink(segment);
  }
}
function applyOwnerEditLink(segment) {
  const editLink = segment.editLink;
  if (!editLink || !segment.owner) return;
  let ownerEl = null;
  try {
    ownerEl = document.querySelector(segment.owner);
  } catch {
    return;
  }
  if (ownerEl) {
    ownerEl.setAttribute("fx-edit-link", editLink);
  }
}
function applySegmentFields(segment, segmentFields) {
  if (!segmentFields) return;
  for (const [, field] of Object.entries(segmentFields)) {
    const bindParts = String(field.bind).split(',').map(part => part.trim());
    const selector = bindParts.map(part => segment.owner ? `${segment.owner} ${part}` : part).join(', ');
    let elements = null;
    try {
      elements = document.querySelectorAll(selector);
    } catch {
      logger_1.logger.warn(`Flux: invalid selector for ${field.key}: ${selector} (relation-item fields are stamped via relation config)`);
      continue;
    }
    if (!elements.length) {
      logger_1.logger.warn(`Flux: Cannot find element for: ${field.key} with selector: ${selector}`);
      continue;
    }
    elements.forEach(element => {
      element.setAttribute('fx-key', field.key);
      element.setAttribute('fx-type', field.type);
      if (segment.owner) element.setAttribute('fx-owner', segment.owner);
    });
  }
}
function applySegmentRelations(_segment, segmentRelationFields) {
  if (!segmentRelationFields) return;
  for (const [relationName, relationField] of Object.entries(segmentRelationFields)) {
    if (relationField.idMap) {
      applyRelationById(relationName, relationField);
    } else {
      applyRelationByIndex(relationName, relationField);
    }
    applyRelationDropZone(relationName, relationField);
  }
}
function applyRelationDropZone(relationName, relationField) {
  if (!relationField.sortable || !relationField.dropZone) return;
  let zone = null;
  try {
    zone = document.querySelector(relationField.dropZone);
  } catch {
    logger_1.logger.warn(`Flux: invalid dropZone selector for ${relationName}: ${relationField.dropZone}`);
    return;
  }
  if (!zone) {
    logger_1.logger.warn(`Flux: dropZone element not found for ${relationName}: ${relationField.dropZone}`);
    return;
  }
  zone.setAttribute('fx-sortable', '');
  zone.setAttribute('fx-grid-name', relationName);
  zone.setAttribute('fx-grid-item-selector', relationField.selector);
  if (relationField.sortField) {
    zone.setAttribute('fx-grid-sort-field', relationField.sortField);
  }
}
function applyRelationById(relationName, relationField) {
  for (const [id, selector] of Object.entries(relationField.idMap)) {
    const el = document.querySelector(selector);
    if (!el) {
      logger_1.logger.warn(`Flux: Cannot find element for ${relationName} ID ${id} with selector: ${selector}`);
      continue;
    }
    applyRelationAttributes(el, id, relationName, relationField);
  }
}
function applyRelationByIndex(relationName, relationField) {
  if (!relationField.selector) {
    logger_1.logger.warn(`Flux: RelationField ${relationName} is missing a selector`);
    return;
  }
  const els = Array.from(document.querySelectorAll(relationField.selector));
  els.forEach((el, index) => {
    const id = relationField.ids?.[index];
    if (id === undefined) {
      logger_1.logger.warn(`Flux: no record ID for ${relationName}[${index}] — DOM and relation may be out of sync`);
      return;
    }
    applyRelationAttributes(el, String(id), relationName, relationField);
  });
}
function applyRelationAttributes(el, owner, relationName, relationField) {
  el.setAttribute('fx-type', 'GridField');
  el.setAttribute('fx-key', relationName);
  el.setAttribute('fx-grid-actions', JSON.stringify(relationField.actions));
  el.setAttribute('fx-owner', owner);
  if (!relationField.Fields) return;
  for (const [fieldName, fieldConfig] of Object.entries(relationField.Fields)) {
    if (!fieldConfig.bind) {
      logger_1.logger.warn(`Flux: No selector for ${relationName}.${fieldName}`);
      continue;
    }
    const childEl = el.querySelector(fieldConfig.bind);
    if (!childEl) {
      logger_1.logger.warn(`Flux: Cannot find element for ${relationName}.${fieldName} with selector: ${fieldConfig.bind}`);
      continue;
    }
    childEl.setAttribute('fx-key', fieldName);
    childEl.setAttribute('fx-type', fieldConfig.type);
    childEl.setAttribute('fx-owner', owner);
  }
}

/***/ }),

/***/ "./client/cms-live-updates/frame.ts":
/*!******************************************!*\
  !*** ./client/cms-live-updates/frame.ts ***!
  \******************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";


var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
const FrameChannel_1 = __importDefault(__webpack_require__(/*! ../channels/FrameChannel */ "./client/channels/FrameChannel.ts"));
// @ts-expect-error -- idiomorph ships no type declarations
const idiomorph_1 = __importDefault(__webpack_require__(/*! idiomorph */ "./node_modules/idiomorph/dist/idiomorph.cjs.js"));
const logger_1 = __webpack_require__(/*! ../core/logger */ "./client/core/logger.ts");
const FluxDirectives_1 = __webpack_require__(/*! ./directives/FluxDirectives */ "./client/cms-live-updates/directives/FluxDirectives.ts");
const FluxBootstrap_1 = __webpack_require__(/*! ./FluxBootstrap */ "./client/cms-live-updates/FluxBootstrap.ts");
const beforeNodeMorphed = oldNode => oldNode.tagName !== 'SCRIPT';
function fxSelector(msg) {
  if (msg.owner) {
    return `[fx-owner="${msg.owner}"][fx-key="${msg.key}"]`;
  }
  return `[fx-key="${msg.key}"]:not([fx-owner])`;
}
const frame = new FrameChannel_1.default();
// we re-apply the fx-* directives after morphing the DOM
function afterMorph() {
  if (!window.FluxConfig) {
    logger_1.logger.warn("afterMorph: no FluxConfig yet — fx-* not re-applied.");
    return;
  }
  (0, FluxDirectives_1.applyConfig)(window.FluxConfig);
}
/**
 * Find all fx-key elements for the message. Warns if none are found and
 * skips updates that would overwrite a field the user is actively editing.
 */
function findFxTargets(msg, kind) {
  const selector = fxSelector(msg);
  const elements = Array.from(document.querySelectorAll(selector));
  if (!elements.length) {
    logger_1.logger.warn(`[findFxDirective] ${kind} DROPPED: no element matched ${selector}`, msg);
    return [];
  }
  return elements;
}
function handlePageTemplateUpdate(msg) {
  logger_1.logger.log('Morphing document with new HTML...');
  logger_1.logger.time('morph');
  const newDoc = new DOMParser().parseFromString(msg.html, 'text/html');
  idiomorph_1.default.morph(document.documentElement, newDoc.documentElement, {
    head: {
      style: 'morph'
    },
    callbacks: {
      beforeNodeMorphed
    }
  });
  logger_1.logger.log('[morphing] Document morphed successfully');
  logger_1.logger.timeEnd('morph');
  afterMorph();
}
function handleBlockUpdate(msg) {
  const ownerElement = document.querySelector(msg.targetOwner);
  if (!ownerElement) {
    logger_1.logger.error(`Block owner element not found: ${msg.targetOwner} — block showing previous content`);
    return;
  }
  logger_1.logger.log(`Morphing block: ${msg.targetOwner}`);
  logger_1.logger.time('blockMorph');
  idiomorph_1.default.morph(ownerElement, msg.html, {
    morphStyle: 'innerHTML',
    callbacks: {
      beforeNodeMorphed
    }
  });
  logger_1.logger.log('Block morphed successfully');
  logger_1.logger.timeEnd('blockMorph');
  afterMorph();
}
function handlePatchTemplateUpdate(msg) {
  const selector = fxSelector(msg);
  const elements = document.querySelectorAll(selector);
  if (!elements.length) {
    logger_1.logger.warn(`[patchTemplateUpdate]: element not found for ${selector}`);
    return;
  }
  elements.forEach(element => {
    element.innerHTML = msg.value;
  });
  logger_1.logger.log(`[patchTemplateUpdate] Patched element ${selector}`);
}
function handleRichTextUpdate(msg) {
  const elements = findFxTargets(msg, msg.type);
  if (!elements.length) return;
  elements.forEach(element => {
    idiomorph_1.default.morph(element, msg.value, {
      morphStyle: 'innerHTML',
      callbacks: {
        beforeNodeMorphed
      }
    });
  });
  logger_1.logger.log(`Morphed ${msg.type} [fx-key="${msg.key}"]`);
}
function handleTextUpdate(msg) {
  logger_1.logger.log(`[textUpdate] frame received: key="${msg.key}" owner="${msg.owner}" selector="${fxSelector(msg)}"`);
  const elements = findFxTargets(msg, 'textUpdate');
  if (!elements.length) return;
  elements.forEach(element => {
    element.textContent = msg.value;
  });
  logger_1.logger.log(`[textUpdate] frame applied to [fx-key="${msg.key}"]`);
}
const handlers = {
  pageTemplateUpdate: handlePageTemplateUpdate,
  blockUpdate: handleBlockUpdate,
  patchTemplateUpdate: handlePatchTemplateUpdate,
  richTextUpdate: handleRichTextUpdate,
  richTextPatch: handleRichTextUpdate,
  textUpdate: handleTextUpdate
};
function updateElement(msg) {
  logger_1.logger.log('Flux message received:', msg);
  const handler = handlers[msg.type];
  if (!handler) {
    logger_1.logger.warn('Unknown message type or missing data:', msg);
    return;
  }
  handler(msg);
}
// The host's pushes carry the authoritative scope (it knows whether a block or
// relation item is being edited). Once one lands, the frame's own boot fetch
// (page-scoped, see bootstrapFrameContext) must not clobber it.
let hostContextApplied = false;
frame.onReceivedMessage = async event => {
  if (event.data.type === 'contextHint') {
    // Host telling us which slice of /flux/context to load. Fetch + apply.
    logger_1.logger.log('contextHint from host:', event.data);
    hostContextApplied = true;
    await (0, FluxBootstrap_1.fetchFluxContext)(event.data);
    if (window.FluxConfig) {
      (0, FluxDirectives_1.applyConfig)(window.FluxConfig);
    }
    return;
  }
  if (event.data.type === 'configUpdate') {
    // Direct push from host (used when we already have a config in hand
    // and want to skip the extra round-trip — chunked save flow, etc.).
    hostContextApplied = true;
    window.FluxConfig = event.data.config;
    logger_1.logger.log('FluxConfig pushed from host:', window.FluxConfig);
    (0, FluxDirectives_1.applyConfig)(window.FluxConfig);
    return;
  }
  if (event.data.type === 'modeChange') {
    window.FluxMode = event.data.mode;
    logger_1.logger.log('CMS mode:', event.data.mode);
    return;
  }
  updateElement(event.data);
};
function bootstrapFrameContext() {
  const context = window.FluxFrameContext;
  if (!context) return;
  if (hostContextApplied) {
    logger_1.logger.log('Inline frame context present, but host scope already applied — keeping host scope.');
    return;
  }
  (0, FluxBootstrap_1.applyContext)(context);
  if (window.FluxConfig) {
    (0, FluxDirectives_1.applyConfig)(window.FluxConfig);
  }
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrapFrameContext, {
    once: true
  });
} else {
  bootstrapFrameContext();
}

/***/ }),

/***/ "./client/core/logger.ts":
/*!*******************************!*\
  !*** ./client/core/logger.ts ***!
  \*******************************/
/***/ (function(__unused_webpack_module, exports) {

"use strict";


// Logger only outputs in development.
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.logger = void 0;
const isDev = "development" === 'development';
const noop = () => {};
function bind(method) {
  return isDev ? console[method].bind(console) : noop;
}
exports.logger = {
  log: bind('log'),
  warn: bind('warn'),
  error: bind('error'),
  table: bind('table'),
  time: bind('time'),
  timeEnd: bind('timeEnd'),
  timeLog: bind('timeLog')
};

/***/ }),

/***/ "./node_modules/idiomorph/dist/idiomorph.cjs.js":
/*!******************************************************!*\
  !*** ./node_modules/idiomorph/dist/idiomorph.cjs.js ***!
  \******************************************************/
/***/ (function(module) {

/**
 * @typedef {object} ConfigHead
 *
 * @property {'merge' | 'append' | 'morph' | 'none'} [style]
 * @property {boolean} [block]
 * @property {boolean} [ignore]
 * @property {function(Element): boolean} [shouldPreserve]
 * @property {function(Element): boolean} [shouldReAppend]
 * @property {function(Element): boolean} [shouldRemove]
 * @property {function(Element, {added: Node[], kept: Element[], removed: Element[]}): void} [afterHeadMorphed]
 */

/**
 * @typedef {object} ConfigCallbacks
 *
 * @property {function(Node): boolean} [beforeNodeAdded]
 * @property {function(Node): void} [afterNodeAdded]
 * @property {function(Element, Node): boolean} [beforeNodeMorphed]
 * @property {function(Element, Node): void} [afterNodeMorphed]
 * @property {function(Element): boolean} [beforeNodeRemoved]
 * @property {function(Element): void} [afterNodeRemoved]
 * @property {function(string, Element, "update" | "remove"): boolean} [beforeAttributeUpdated]
 */

/**
 * @typedef {object} Config
 *
 * @property {'outerHTML' | 'innerHTML'} [morphStyle]
 * @property {boolean} [ignoreActive]
 * @property {boolean} [ignoreActiveValue]
 * @property {boolean} [restoreFocus]
 * @property {ConfigCallbacks} [callbacks]
 * @property {ConfigHead} [head]
 */

/**
 * @typedef {function} NoOp
 *
 * @returns {void}
 */

/**
 * @typedef {object} ConfigHeadInternal
 *
 * @property {'merge' | 'append' | 'morph' | 'none'} style
 * @property {boolean} [block]
 * @property {boolean} [ignore]
 * @property {(function(Element): boolean) | NoOp} shouldPreserve
 * @property {(function(Element): boolean) | NoOp} shouldReAppend
 * @property {(function(Element): boolean) | NoOp} shouldRemove
 * @property {(function(Element, {added: Node[], kept: Element[], removed: Element[]}): void) | NoOp} afterHeadMorphed
 */

/**
 * @typedef {object} ConfigCallbacksInternal
 *
 * @property {(function(Node): boolean) | NoOp} beforeNodeAdded
 * @property {(function(Node): void) | NoOp} afterNodeAdded
 * @property {(function(Node, Node): boolean) | NoOp} beforeNodeMorphed
 * @property {(function(Node, Node): void) | NoOp} afterNodeMorphed
 * @property {(function(Node): boolean) | NoOp} beforeNodeRemoved
 * @property {(function(Node): void) | NoOp} afterNodeRemoved
 * @property {(function(string, Element, "update" | "remove"): boolean) | NoOp} beforeAttributeUpdated
 */

/**
 * @typedef {object} ConfigInternal
 *
 * @property {'outerHTML' | 'innerHTML'} morphStyle
 * @property {boolean} [ignoreActive]
 * @property {boolean} [ignoreActiveValue]
 * @property {boolean} [restoreFocus]
 * @property {ConfigCallbacksInternal} callbacks
 * @property {ConfigHeadInternal} head
 */

/**
 * @typedef {Object} IdSets
 * @property {Set<string>} persistentIds
 * @property {Map<Node, Set<string>>} idMap
 */

/**
 * @typedef {Function} Morph
 *
 * @param {Element | Document} oldNode
 * @param {Element | Node | HTMLCollection | Node[] | string | null} newContent
 * @param {Config} [config]
 * @returns {undefined | Node[]}
 */

// base IIFE to define idiomorph
/**
 *
 * @type {{defaults: ConfigInternal, morph: Morph}}
 */
var Idiomorph = (function () {
  "use strict";

  /**
   * @typedef {object} MorphContext
   *
   * @property {Element} target
   * @property {Element} newContent
   * @property {ConfigInternal} config
   * @property {ConfigInternal['morphStyle']} morphStyle
   * @property {ConfigInternal['ignoreActive']} ignoreActive
   * @property {ConfigInternal['ignoreActiveValue']} ignoreActiveValue
   * @property {ConfigInternal['restoreFocus']} restoreFocus
   * @property {Map<Node, Set<string>>} idMap
   * @property {Set<string>} persistentIds
   * @property {ConfigInternal['callbacks']} callbacks
   * @property {ConfigInternal['head']} head
   * @property {HTMLDivElement} pantry
   * @property {Element[]} activeElementAndParents
   */

  //=============================================================================
  // AND NOW IT BEGINS...
  //=============================================================================

  const noOp = () => {};
  /**
   * Default configuration values, updatable by users now
   * @type {ConfigInternal}
   */
  const defaults = {
    morphStyle: "outerHTML",
    callbacks: {
      beforeNodeAdded: noOp,
      afterNodeAdded: noOp,
      beforeNodeMorphed: noOp,
      afterNodeMorphed: noOp,
      beforeNodeRemoved: noOp,
      afterNodeRemoved: noOp,
      beforeAttributeUpdated: noOp,
    },
    head: {
      style: "merge",
      shouldPreserve: (elt) => elt.getAttribute("im-preserve") === "true",
      shouldReAppend: (elt) => elt.getAttribute("im-re-append") === "true",
      shouldRemove: noOp,
      afterHeadMorphed: noOp,
    },
    restoreFocus: true,
  };

  /**
   * Core idiomorph function for morphing one DOM tree to another
   *
   * @param {Element | Document} oldNode
   * @param {Element | Node | HTMLCollection | Node[] | string | null} newContent
   * @param {Config} [config]
   * @returns {Promise<Node[]> | Node[]}
   */
  function morph(oldNode, newContent, config = {}) {
    oldNode = normalizeElement(oldNode);
    const newNode = normalizeParent(newContent);
    const ctx = createMorphContext(oldNode, newNode, config);

    const morphedNodes = saveAndRestoreFocus(ctx, () => {
      return withHeadBlocking(
        ctx,
        oldNode,
        newNode,
        /** @param {MorphContext} ctx */ (ctx) => {
          if (ctx.morphStyle === "innerHTML") {
            morphChildren(ctx, oldNode, newNode);
            return Array.from(oldNode.childNodes);
          } else {
            return morphOuterHTML(ctx, oldNode, newNode);
          }
        },
      );
    });

    ctx.pantry.remove();
    return morphedNodes;
  }

  /**
   * Morph just the outerHTML of the oldNode to the newContent
   * We have to be careful because the oldNode could have siblings which need to be untouched
   * @param {MorphContext} ctx
   * @param {Element} oldNode
   * @param {Element} newNode
   * @returns {Node[]}
   */
  function morphOuterHTML(ctx, oldNode, newNode) {
    const oldParent = normalizeParent(oldNode);
    morphChildren(
      ctx,
      oldParent,
      newNode,
      // these two optional params are the secret sauce
      oldNode, // start point for iteration
      oldNode.nextSibling, // end point for iteration
    );
    // this is safe even with siblings, because normalizeParent returns a SlicedParentNode if needed.
    return Array.from(oldParent.childNodes);
  }

  /**
   * @param {MorphContext} ctx
   * @param {Function} fn
   * @returns {Promise<Node[]> | Node[]}
   */
  function saveAndRestoreFocus(ctx, fn) {
    if (!ctx.config.restoreFocus) return fn();
    let activeElement =
      /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (
        document.activeElement
      );

    // don't bother if the active element is not an input or textarea
    if (
      !(
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement
      )
    ) {
      return fn();
    }

    const { id: activeElementId, selectionStart, selectionEnd } = activeElement;

    const results = fn();

    if (
      activeElementId &&
      activeElementId !== document.activeElement?.getAttribute("id")
    ) {
      activeElement = ctx.target.querySelector(`[id="${activeElementId}"]`);
      activeElement?.focus();
    }
    if (activeElement && !activeElement.selectionEnd && selectionEnd) {
      activeElement.setSelectionRange(selectionStart, selectionEnd);
    }

    return results;
  }

  const morphChildren = (function () {
    /**
     * This is the core algorithm for matching up children.  The idea is to use id sets to try to match up
     * nodes as faithfully as possible.  We greedily match, which allows us to keep the algorithm fast, but
     * by using id sets, we are able to better match up with content deeper in the DOM.
     *
     * Basic algorithm:
     * - for each node in the new content:
     *   - search self and siblings for an id set match, falling back to a soft match
     *   - if match found
     *     - remove any nodes up to the match:
     *       - pantry persistent nodes
     *       - delete the rest
     *     - morph the match
     *   - elsif no match found, and node is persistent
     *     - find its match by querying the old root (future) and pantry (past)
     *     - move it and its children here
     *     - morph it
     *   - else
     *     - create a new node from scratch as a last result
     *
     * @param {MorphContext} ctx the merge context
     * @param {Element} oldParent the old content that we are merging the new content into
     * @param {Element} newParent the parent element of the new content
     * @param {Node|null} [insertionPoint] the point in the DOM we start morphing at (defaults to first child)
     * @param {Node|null} [endPoint] the point in the DOM we stop morphing at (defaults to after last child)
     */
    function morphChildren(
      ctx,
      oldParent,
      newParent,
      insertionPoint = null,
      endPoint = null,
    ) {
      // normalize
      if (
        oldParent instanceof HTMLTemplateElement &&
        newParent instanceof HTMLTemplateElement
      ) {
        // @ts-ignore we can pretend the DocumentFragment is an Element
        oldParent = oldParent.content;
        // @ts-ignore ditto
        newParent = newParent.content;
      }
      insertionPoint ||= oldParent.firstChild;

      // run through all the new content
      for (const newChild of newParent.childNodes) {
        // once we reach the end of the old parent content skip to the end and insert the rest
        if (insertionPoint && insertionPoint != endPoint) {
          const bestMatch = findBestMatch(
            ctx,
            newChild,
            insertionPoint,
            endPoint,
          );
          if (bestMatch) {
            // if the node to morph is not at the insertion point then remove/move up to it
            if (bestMatch !== insertionPoint) {
              removeNodesBetween(ctx, insertionPoint, bestMatch);
            }
            morphNode(bestMatch, newChild, ctx);
            insertionPoint = bestMatch.nextSibling;
            continue;
          }
        }

        // if the matching node is elsewhere in the original content
        if (newChild instanceof Element) {
          // we can pretend the id is non-null because the next `.has` line will reject it if not
          const newChildId = /** @type {String} */ (
            newChild.getAttribute("id")
          );
          if (ctx.persistentIds.has(newChildId)) {
            // move it and all its children here and morph
            const movedChild = moveBeforeById(
              oldParent,
              newChildId,
              insertionPoint,
              ctx,
            );
            morphNode(movedChild, newChild, ctx);
            insertionPoint = movedChild.nextSibling;
            continue;
          }
        }

        // last resort: insert the new node from scratch
        const insertedNode = createNode(
          oldParent,
          newChild,
          insertionPoint,
          ctx,
        );
        // could be null if beforeNodeAdded prevented insertion
        if (insertedNode) {
          insertionPoint = insertedNode.nextSibling;
        }
      }

      // remove any remaining old nodes that didn't match up with new content
      while (insertionPoint && insertionPoint != endPoint) {
        const tempNode = insertionPoint;
        insertionPoint = insertionPoint.nextSibling;
        removeNode(ctx, tempNode);
      }
    }

    /**
     * This performs the action of inserting a new node while handling situations where the node contains
     * elements with persistent ids and possible state info we can still preserve by moving in and then morphing
     *
     * @param {Element} oldParent
     * @param {Node} newChild
     * @param {Node|null} insertionPoint
     * @param {MorphContext} ctx
     * @returns {Node|null}
     */
    function createNode(oldParent, newChild, insertionPoint, ctx) {
      if (ctx.callbacks.beforeNodeAdded(newChild) === false) return null;
      if (ctx.idMap.has(newChild)) {
        // node has children with ids with possible state so create a dummy elt of same type and apply full morph algorithm
        const newEmptyChild = document.createElement(
          /** @type {Element} */ (newChild).tagName,
        );
        oldParent.insertBefore(newEmptyChild, insertionPoint);
        morphNode(newEmptyChild, newChild, ctx);
        ctx.callbacks.afterNodeAdded(newEmptyChild);
        return newEmptyChild;
      } else {
        // optimisation: no id state to preserve so we can just insert a clone of the newChild and its descendants
        const newClonedChild = document.importNode(newChild, true); // importNode to not mutate newParent
        oldParent.insertBefore(newClonedChild, insertionPoint);
        ctx.callbacks.afterNodeAdded(newClonedChild);
        return newClonedChild;
      }
    }

    //=============================================================================
    // Matching Functions
    //=============================================================================
    const findBestMatch = (function () {
      /**
       * Scans forward from the startPoint to the endPoint looking for a match
       * for the node. It looks for an id set match first, then a soft match.
       * We abort softmatching if we find two future soft matches, to reduce churn.
       * @param {Node} node
       * @param {MorphContext} ctx
       * @param {Node | null} startPoint
       * @param {Node | null} endPoint
       * @returns {Node | null}
       */
      function findBestMatch(ctx, node, startPoint, endPoint) {
        let softMatch = null;
        let nextSibling = node.nextSibling;
        let siblingSoftMatchCount = 0;

        let cursor = startPoint;
        while (cursor && cursor != endPoint) {
          // soft matching is a prerequisite for id set matching
          if (isSoftMatch(cursor, node)) {
            if (isIdSetMatch(ctx, cursor, node)) {
              return cursor; // found an id set match, we're done!
            }

            // we haven't yet saved a soft match fallback
            if (softMatch === null) {
              // the current soft match will hard match something else in the future, leave it
              if (!ctx.idMap.has(cursor)) {
                // save this as the fallback if we get through the loop without finding a hard match
                softMatch = cursor;
              }
            }
          }
          if (
            softMatch === null &&
            nextSibling &&
            isSoftMatch(cursor, nextSibling)
          ) {
            // The next new node has a soft match with this node, so
            // increment the count of future soft matches
            siblingSoftMatchCount++;
            nextSibling = nextSibling.nextSibling;

            // If there are two future soft matches, block soft matching for this node to allow
            // future siblings to soft match. This is to reduce churn in the DOM when an element
            // is prepended.
            if (siblingSoftMatchCount >= 2) {
              softMatch = undefined;
            }
          }

          // if the current node contains active element, stop looking for better future matches,
          // because if one is found, this node will be moved to the pantry, reparenting it and thus losing focus
          // @ts-ignore pretend cursor is Element rather than Node, we're just testing for array inclusion
          if (ctx.activeElementAndParents.includes(cursor)) break;

          cursor = cursor.nextSibling;
        }

        return softMatch || null;
      }

      /**
       *
       * @param {MorphContext} ctx
       * @param {Node} oldNode
       * @param {Node} newNode
       * @returns {boolean}
       */
      function isIdSetMatch(ctx, oldNode, newNode) {
        let oldSet = ctx.idMap.get(oldNode);
        let newSet = ctx.idMap.get(newNode);

        if (!newSet || !oldSet) return false;

        for (const id of oldSet) {
          // a potential match is an id in the new and old nodes that
          // has not already been merged into the DOM
          // But the newNode content we call this on has not been
          // merged yet and we don't allow duplicate IDs so it is simple
          if (newSet.has(id)) {
            return true;
          }
        }
        return false;
      }

      /**
       *
       * @param {Node} oldNode
       * @param {Node} newNode
       * @returns {boolean}
       */
      function isSoftMatch(oldNode, newNode) {
        // ok to cast: if one is not element, `id` and `tagName` will be undefined and we'll just compare that.
        const oldElt = /** @type {Element} */ (oldNode);
        const newElt = /** @type {Element} */ (newNode);

        return (
          oldElt.nodeType === newElt.nodeType &&
          oldElt.tagName === newElt.tagName &&
          // If oldElt has an `id` with possible state and it doesn't match newElt.id then avoid morphing.
          // We'll still match an anonymous node with an IDed newElt, though, because if it got this far,
          // its not persistent, and new nodes can't have any hidden state.
          // We can't use .id because of form input shadowing, and we can't count on .getAttribute's presence because it could be a document-fragment
          (!oldElt.getAttribute?.("id") ||
            oldElt.getAttribute?.("id") === newElt.getAttribute?.("id"))
        );
      }

      return findBestMatch;
    })();

    //=============================================================================
    // DOM Manipulation Functions
    //=============================================================================

    /**
     * Gets rid of an unwanted DOM node; strategy depends on nature of its reuse:
     * - Persistent nodes will be moved to the pantry for later reuse
     * - Other nodes will have their hooks called, and then are removed
     * @param {MorphContext} ctx
     * @param {Node} node
     */
    function removeNode(ctx, node) {
      // are we going to id set match this later?
      if (ctx.idMap.has(node)) {
        // skip callbacks and move to pantry
        moveBefore(ctx.pantry, node, null);
      } else {
        // remove for realsies
        if (ctx.callbacks.beforeNodeRemoved(node) === false) return;
        node.parentNode?.removeChild(node);
        ctx.callbacks.afterNodeRemoved(node);
      }
    }

    /**
     * Remove nodes between the start and end nodes
     * @param {MorphContext} ctx
     * @param {Node} startInclusive
     * @param {Node} endExclusive
     * @returns {Node|null}
     */
    function removeNodesBetween(ctx, startInclusive, endExclusive) {
      /** @type {Node | null} */
      let cursor = startInclusive;
      // remove nodes until the endExclusive node
      while (cursor && cursor !== endExclusive) {
        let tempNode = /** @type {Node} */ (cursor);
        cursor = cursor.nextSibling;
        removeNode(ctx, tempNode);
      }
      return cursor;
    }

    /**
     * Search for an element by id within the document and pantry, and move it using moveBefore.
     *
     * @param {Element} parentNode - The parent node to which the element will be moved.
     * @param {string} id - The ID of the element to be moved.
     * @param {Node | null} after - The reference node to insert the element before.
     *                              If `null`, the element is appended as the last child.
     * @param {MorphContext} ctx
     * @returns {Element} The found element
     */
    function moveBeforeById(parentNode, id, after, ctx) {
      const target =
        /** @type {Element} - will always be found */
        (
          // ctx.target.id unsafe because of form input shadowing
          // ctx.target could be a document fragment which doesn't have `getAttribute`
          (ctx.target.getAttribute?.("id") === id && ctx.target) ||
            ctx.target.querySelector(`[id="${id}"]`) ||
            ctx.pantry.querySelector(`[id="${id}"]`)
        );
      removeElementFromAncestorsIdMaps(target, ctx);
      moveBefore(parentNode, target, after);
      return target;
    }

    /**
     * Removes an element from its ancestors' id maps. This is needed when an element is moved from the
     * "future" via `moveBeforeId`. Otherwise, its erstwhile ancestors could be mistakenly moved to the
     * pantry rather than being deleted, preventing their removal hooks from being called.
     *
     * @param {Element} element - element to remove from its ancestors' id maps
     * @param {MorphContext} ctx
     */
    function removeElementFromAncestorsIdMaps(element, ctx) {
      // we know id is non-null String, because this function is only called on elements with ids
      const id = /** @type {String} */ (element.getAttribute("id"));
      /** @ts-ignore - safe to loop in this way **/
      while ((element = element.parentNode)) {
        let idSet = ctx.idMap.get(element);
        if (idSet) {
          idSet.delete(id);
          if (!idSet.size) {
            ctx.idMap.delete(element);
          }
        }
      }
    }

    /**
     * Moves an element before another element within the same parent.
     * Uses the proposed `moveBefore` API if available (and working), otherwise falls back to `insertBefore`.
     * This is essentialy a forward-compat wrapper.
     *
     * @param {Element} parentNode - The parent node containing the after element.
     * @param {Node} element - The element to be moved.
     * @param {Node | null} after - The reference node to insert `element` before.
     *                              If `null`, `element` is appended as the last child.
     */
    function moveBefore(parentNode, element, after) {
      // @ts-ignore - use proposed moveBefore feature
      if (parentNode.moveBefore) {
        try {
          // @ts-ignore - use proposed moveBefore feature
          parentNode.moveBefore(element, after);
        } catch (e) {
          // fall back to insertBefore as some browsers may fail on moveBefore when trying to move Dom disconnected nodes to pantry
          parentNode.insertBefore(element, after);
        }
      } else {
        parentNode.insertBefore(element, after);
      }
    }

    return morphChildren;
  })();

  //=============================================================================
  // Single Node Morphing Code
  //=============================================================================
  const morphNode = (function () {
    /**
     * @param {Node} oldNode root node to merge content into
     * @param {Node} newContent new content to merge
     * @param {MorphContext} ctx the merge context
     * @returns {Node | null} the element that ended up in the DOM
     */
    function morphNode(oldNode, newContent, ctx) {
      if (ctx.ignoreActive && oldNode === document.activeElement) {
        // don't morph focused element
        return null;
      }

      if (ctx.callbacks.beforeNodeMorphed(oldNode, newContent) === false) {
        return oldNode;
      }

      if (oldNode instanceof HTMLHeadElement && ctx.head.ignore) {
        // ignore the head element
      } else if (
        oldNode instanceof HTMLHeadElement &&
        ctx.head.style !== "morph"
      ) {
        // ok to cast: if newContent wasn't also a <head>, it would've got caught in the `!isSoftMatch` branch above
        handleHeadElement(
          oldNode,
          /** @type {HTMLHeadElement} */ (newContent),
          ctx,
        );
      } else {
        morphAttributes(oldNode, newContent, ctx);
        if (!ignoreValueOfActiveElement(oldNode, ctx)) {
          // @ts-ignore newContent can be a node here because .firstChild will be null
          morphChildren(ctx, oldNode, newContent);
        }
      }
      ctx.callbacks.afterNodeMorphed(oldNode, newContent);
      return oldNode;
    }

    /**
     * syncs the oldNode to the newNode, copying over all attributes and
     * inner element state from the newNode to the oldNode
     *
     * @param {Node} oldNode the node to copy attributes & state to
     * @param {Node} newNode the node to copy attributes & state from
     * @param {MorphContext} ctx the merge context
     */
    function morphAttributes(oldNode, newNode, ctx) {
      let type = newNode.nodeType;

      // if is an element type, sync the attributes from the
      // new node into the new node
      if (type === 1 /* element type */) {
        const oldElt = /** @type {Element} */ (oldNode);
        const newElt = /** @type {Element} */ (newNode);

        const oldAttributes = oldElt.attributes;
        const newAttributes = newElt.attributes;
        for (const newAttribute of newAttributes) {
          if (ignoreAttribute(newAttribute.name, oldElt, "update", ctx)) {
            continue;
          }
          if (oldElt.getAttribute(newAttribute.name) !== newAttribute.value) {
            oldElt.setAttribute(newAttribute.name, newAttribute.value);
          }
        }
        // iterate backwards to avoid skipping over items when a delete occurs
        for (let i = oldAttributes.length - 1; 0 <= i; i--) {
          const oldAttribute = oldAttributes[i];

          // toAttributes is a live NamedNodeMap, so iteration+mutation is unsafe
          // e.g. custom element attribute callbacks can remove other attributes
          if (!oldAttribute) continue;

          if (!newElt.hasAttribute(oldAttribute.name)) {
            if (ignoreAttribute(oldAttribute.name, oldElt, "remove", ctx)) {
              continue;
            }
            oldElt.removeAttribute(oldAttribute.name);
          }
        }

        if (!ignoreValueOfActiveElement(oldElt, ctx)) {
          syncInputValue(oldElt, newElt, ctx);
        }
      }

      // sync text nodes
      if (type === 8 /* comment */ || type === 3 /* text */) {
        if (oldNode.nodeValue !== newNode.nodeValue) {
          oldNode.nodeValue = newNode.nodeValue;
        }
      }
    }

    /**
     * NB: many bothans died to bring us information:
     *
     *  https://github.com/patrick-steele-idem/morphdom/blob/master/src/specialElHandlers.js
     *  https://github.com/choojs/nanomorph/blob/master/lib/morph.jsL113
     *
     * @param {Element} oldElement the element to sync the input value to
     * @param {Element} newElement the element to sync the input value from
     * @param {MorphContext} ctx the merge context
     */
    function syncInputValue(oldElement, newElement, ctx) {
      if (
        oldElement instanceof HTMLInputElement &&
        newElement instanceof HTMLInputElement &&
        newElement.type !== "file"
      ) {
        let newValue = newElement.value;
        let oldValue = oldElement.value;

        // sync boolean attributes
        syncBooleanAttribute(oldElement, newElement, "checked", ctx);
        syncBooleanAttribute(oldElement, newElement, "disabled", ctx);

        if (!newElement.hasAttribute("value")) {
          if (!ignoreAttribute("value", oldElement, "remove", ctx)) {
            oldElement.value = "";
            oldElement.removeAttribute("value");
          }
        } else if (oldValue !== newValue) {
          if (!ignoreAttribute("value", oldElement, "update", ctx)) {
            oldElement.setAttribute("value", newValue);
            oldElement.value = newValue;
          }
        }
        // TODO: QUESTION(1cg): this used to only check `newElement` unlike the other branches -- why?
        // did I break something?
      } else if (
        oldElement instanceof HTMLOptionElement &&
        newElement instanceof HTMLOptionElement
      ) {
        syncBooleanAttribute(oldElement, newElement, "selected", ctx);
      } else if (
        oldElement instanceof HTMLTextAreaElement &&
        newElement instanceof HTMLTextAreaElement
      ) {
        let newValue = newElement.value;
        let oldValue = oldElement.value;
        if (ignoreAttribute("value", oldElement, "update", ctx)) {
          return;
        }
        if (newValue !== oldValue) {
          oldElement.value = newValue;
        }
        if (
          oldElement.firstChild &&
          oldElement.firstChild.nodeValue !== newValue
        ) {
          oldElement.firstChild.nodeValue = newValue;
        }
      }
    }

    /**
     * @param {Element} oldElement element to write the value to
     * @param {Element} newElement element to read the value from
     * @param {string} attributeName the attribute name
     * @param {MorphContext} ctx the merge context
     */
    function syncBooleanAttribute(oldElement, newElement, attributeName, ctx) {
      // @ts-ignore this function is only used on boolean attrs that are reflected as dom properties
      const newLiveValue = newElement[attributeName],
        // @ts-ignore ditto
        oldLiveValue = oldElement[attributeName];
      if (newLiveValue !== oldLiveValue) {
        const ignoreUpdate = ignoreAttribute(
          attributeName,
          oldElement,
          "update",
          ctx,
        );
        if (!ignoreUpdate) {
          // update attribute's associated DOM property
          // @ts-ignore this function is only used on boolean attrs that are reflected as dom properties
          oldElement[attributeName] = newElement[attributeName];
        }
        if (newLiveValue) {
          if (!ignoreUpdate) {
            // https://developer.mozilla.org/en-US/docs/Glossary/Boolean/HTML
            // this is the correct way to set a boolean attribute to "true"
            oldElement.setAttribute(attributeName, "");
          }
        } else {
          if (!ignoreAttribute(attributeName, oldElement, "remove", ctx)) {
            oldElement.removeAttribute(attributeName);
          }
        }
      }
    }

    /**
     * @param {string} attr the attribute to be mutated
     * @param {Element} element the element that is going to be updated
     * @param {"update" | "remove"} updateType
     * @param {MorphContext} ctx the merge context
     * @returns {boolean} true if the attribute should be ignored, false otherwise
     */
    function ignoreAttribute(attr, element, updateType, ctx) {
      if (
        attr === "value" &&
        ctx.ignoreActiveValue &&
        element === document.activeElement
      ) {
        return true;
      }
      return (
        ctx.callbacks.beforeAttributeUpdated(attr, element, updateType) ===
        false
      );
    }

    /**
     * @param {Node} possibleActiveElement
     * @param {MorphContext} ctx
     * @returns {boolean}
     */
    function ignoreValueOfActiveElement(possibleActiveElement, ctx) {
      return (
        !!ctx.ignoreActiveValue &&
        possibleActiveElement === document.activeElement &&
        possibleActiveElement !== document.body
      );
    }

    return morphNode;
  })();

  //=============================================================================
  // Head Management Functions
  //=============================================================================
  /**
   * @param {MorphContext} ctx
   * @param {Element} oldNode
   * @param {Element} newNode
   * @param {function} callback
   * @returns {Node[] | Promise<Node[]>}
   */
  function withHeadBlocking(ctx, oldNode, newNode, callback) {
    if (ctx.head.block) {
      const oldHead = oldNode.querySelector("head");
      const newHead = newNode.querySelector("head");
      if (oldHead && newHead) {
        const promises = handleHeadElement(oldHead, newHead, ctx);
        // when head promises resolve, proceed ignoring the head tag
        return Promise.all(promises).then(() => {
          const newCtx = Object.assign(ctx, {
            head: {
              block: false,
              ignore: true,
            },
          });
          return callback(newCtx);
        });
      }
    }
    // just proceed if we not head blocking
    return callback(ctx);
  }

  /**
   *  The HEAD tag can be handled specially, either w/ a 'merge' or 'append' style
   *
   * @param {Element} oldHead
   * @param {Element} newHead
   * @param {MorphContext} ctx
   * @returns {Promise<void>[]}
   */
  function handleHeadElement(oldHead, newHead, ctx) {
    let added = [];
    let removed = [];
    let preserved = [];
    let nodesToAppend = [];

    // put all new head elements into a Map, by their outerHTML
    let srcToNewHeadNodes = new Map();
    for (const newHeadChild of newHead.children) {
      srcToNewHeadNodes.set(newHeadChild.outerHTML, newHeadChild);
    }

    // for each elt in the current head
    for (const currentHeadElt of oldHead.children) {
      // If the current head element is in the map
      let inNewContent = srcToNewHeadNodes.has(currentHeadElt.outerHTML);
      let isReAppended = ctx.head.shouldReAppend(currentHeadElt);
      let isPreserved = ctx.head.shouldPreserve(currentHeadElt);
      if (inNewContent || isPreserved) {
        if (isReAppended) {
          // remove the current version and let the new version replace it and re-execute
          removed.push(currentHeadElt);
        } else {
          // this element already exists and should not be re-appended, so remove it from
          // the new content map, preserving it in the DOM
          srcToNewHeadNodes.delete(currentHeadElt.outerHTML);
          preserved.push(currentHeadElt);
        }
      } else {
        if (ctx.head.style === "append") {
          // we are appending and this existing element is not new content
          // so if and only if it is marked for re-append do we do anything
          if (isReAppended) {
            removed.push(currentHeadElt);
            nodesToAppend.push(currentHeadElt);
          }
        } else {
          // if this is a merge, we remove this content since it is not in the new head
          if (ctx.head.shouldRemove(currentHeadElt) !== false) {
            removed.push(currentHeadElt);
          }
        }
      }
    }

    // Push the remaining new head elements in the Map into the
    // nodes to append to the head tag
    nodesToAppend.push(...srcToNewHeadNodes.values());

    let promises = [];
    for (const newNode of nodesToAppend) {
      // TODO: This could theoretically be null, based on type
      let newElt = /** @type {ChildNode} */ (
        document.createRange().createContextualFragment(newNode.outerHTML)
          .firstChild
      );
      if (ctx.callbacks.beforeNodeAdded(newElt) !== false) {
        if (
          ("href" in newElt && newElt.href) ||
          ("src" in newElt && newElt.src)
        ) {
          /** @type {(result?: any) => void} */ let resolve;
          let promise = new Promise(function (_resolve) {
            resolve = _resolve;
          });
          newElt.addEventListener("load", function () {
            resolve();
          });
          promises.push(promise);
        }
        oldHead.appendChild(newElt);
        ctx.callbacks.afterNodeAdded(newElt);
        added.push(newElt);
      }
    }

    // remove all removed elements, after we have appended the new elements to avoid
    // additional network requests for things like style sheets
    for (const removedElement of removed) {
      if (ctx.callbacks.beforeNodeRemoved(removedElement) !== false) {
        oldHead.removeChild(removedElement);
        ctx.callbacks.afterNodeRemoved(removedElement);
      }
    }

    ctx.head.afterHeadMorphed(oldHead, {
      added: added,
      kept: preserved,
      removed: removed,
    });
    return promises;
  }

  //=============================================================================
  // Create Morph Context Functions
  //=============================================================================
  const createMorphContext = (function () {
    /**
     *
     * @param {Element} oldNode
     * @param {Element} newContent
     * @param {Config} config
     * @returns {MorphContext}
     */
    function createMorphContext(oldNode, newContent, config) {
      const { persistentIds, idMap } = createIdMaps(oldNode, newContent);

      const mergedConfig = mergeDefaults(config);
      const morphStyle = mergedConfig.morphStyle || "outerHTML";
      if (!["innerHTML", "outerHTML"].includes(morphStyle)) {
        throw `Do not understand how to morph style ${morphStyle}`;
      }

      return {
        target: oldNode,
        newContent: newContent,
        config: mergedConfig,
        morphStyle: morphStyle,
        ignoreActive: mergedConfig.ignoreActive,
        ignoreActiveValue: mergedConfig.ignoreActiveValue,
        restoreFocus: mergedConfig.restoreFocus,
        idMap: idMap,
        persistentIds: persistentIds,
        pantry: createPantry(),
        activeElementAndParents: createActiveElementAndParents(oldNode),
        callbacks: mergedConfig.callbacks,
        head: mergedConfig.head,
      };
    }

    /**
     * Deep merges the config object and the Idiomorph.defaults object to
     * produce a final configuration object
     * @param {Config} config
     * @returns {ConfigInternal}
     */
    function mergeDefaults(config) {
      let finalConfig = Object.assign({}, defaults);

      // copy top level stuff into final config
      Object.assign(finalConfig, config);

      // copy callbacks into final config (do this to deep merge the callbacks)
      finalConfig.callbacks = Object.assign(
        {},
        defaults.callbacks,
        config.callbacks,
      );

      // copy head config into final config  (do this to deep merge the head)
      finalConfig.head = Object.assign({}, defaults.head, config.head);

      return finalConfig;
    }

    /**
     * @returns {HTMLDivElement}
     */
    function createPantry() {
      const pantry = document.createElement("div");
      pantry.hidden = true;
      document.body.insertAdjacentElement("afterend", pantry);
      return pantry;
    }

    /**
     * @param {Element} oldNode
     * @returns {Element[]}
     */
    function createActiveElementAndParents(oldNode) {
      /** @type {Element[]} */
      let activeElementAndParents = [];
      let elt = document.activeElement;
      if (elt?.tagName !== "BODY" && oldNode.contains(elt)) {
        while (elt) {
          activeElementAndParents.push(elt);
          if (elt === oldNode) break;
          elt = elt.parentElement;
        }
      }
      return activeElementAndParents;
    }

    /**
     * Returns all elements with an ID contained within the root element and its descendants
     *
     * @param {Element} root
     * @returns {Element[]}
     */
    function findIdElements(root) {
      let elements = Array.from(root.querySelectorAll("[id]"));
      // root could be a document fragment which doesn't have `getAttribute`
      if (root.getAttribute?.("id")) {
        elements.push(root);
      }
      return elements;
    }

    /**
     * A bottom-up algorithm that populates a map of Element -> IdSet.
     * The idSet for a given element is the set of all IDs contained within its subtree.
     * As an optimzation, we filter these IDs through the given list of persistent IDs,
     * because we don't need to bother considering IDed elements that won't be in the new content.
     *
     * @param {Map<Node, Set<string>>} idMap
     * @param {Set<string>} persistentIds
     * @param {Element} root
     * @param {Element[]} elements
     */
    function populateIdMapWithTree(idMap, persistentIds, root, elements) {
      for (const elt of elements) {
        // we can pretend id is non-null String, because the .has line will reject it immediately if not
        const id = /** @type {String} */ (elt.getAttribute("id"));
        if (persistentIds.has(id)) {
          /** @type {Element|null} */
          let current = elt;
          // walk up the parent hierarchy of that element, adding the id
          // of element to the parent's id set
          while (current) {
            let idSet = idMap.get(current);
            // if the id set doesn't exist, create it and insert it in the map
            if (idSet == null) {
              idSet = new Set();
              idMap.set(current, idSet);
            }
            idSet.add(id);

            if (current === root) break;
            current = current.parentElement;
          }
        }
      }
    }

    /**
     * This function computes a map of nodes to all ids contained within that node (inclusive of the
     * node).  This map can be used to ask if two nodes have intersecting sets of ids, which allows
     * for a looser definition of "matching" than tradition id matching, and allows child nodes
     * to contribute to a parent nodes matching.
     *
     * @param {Element} oldContent  the old content that will be morphed
     * @param {Element} newContent  the new content to morph to
     * @returns {IdSets}
     */
    function createIdMaps(oldContent, newContent) {
      const oldIdElements = findIdElements(oldContent);
      const newIdElements = findIdElements(newContent);

      const persistentIds = createPersistentIds(oldIdElements, newIdElements);

      /** @type {Map<Node, Set<string>>} */
      let idMap = new Map();
      populateIdMapWithTree(idMap, persistentIds, oldContent, oldIdElements);

      /** @ts-ignore - if newContent is a duck-typed parent, pass its single child node as the root to halt upwards iteration */
      const newRoot = newContent.__idiomorphRoot || newContent;
      populateIdMapWithTree(idMap, persistentIds, newRoot, newIdElements);

      return { persistentIds, idMap };
    }

    /**
     * This function computes the set of ids that persist between the two contents excluding duplicates
     *
     * @param {Element[]} oldIdElements
     * @param {Element[]} newIdElements
     * @returns {Set<string>}
     */
    function createPersistentIds(oldIdElements, newIdElements) {
      let duplicateIds = new Set();

      /** @type {Map<string, string>} */
      let oldIdTagNameMap = new Map();
      for (const { id, tagName } of oldIdElements) {
        if (oldIdTagNameMap.has(id)) {
          duplicateIds.add(id);
        } else {
          oldIdTagNameMap.set(id, tagName);
        }
      }

      let persistentIds = new Set();
      for (const { id, tagName } of newIdElements) {
        if (persistentIds.has(id)) {
          duplicateIds.add(id);
        } else if (oldIdTagNameMap.get(id) === tagName) {
          persistentIds.add(id);
        }
        // skip if tag types mismatch because its not possible to morph one tag into another
      }

      for (const id of duplicateIds) {
        persistentIds.delete(id);
      }
      return persistentIds;
    }

    return createMorphContext;
  })();

  //=============================================================================
  // HTML Normalization Functions
  //=============================================================================
  const { normalizeElement, normalizeParent } = (function () {
    /** @type {WeakSet<Node>} */
    const generatedByIdiomorph = new WeakSet();

    /**
     *
     * @param {Element | Document} content
     * @returns {Element}
     */
    function normalizeElement(content) {
      if (content instanceof Document) {
        return content.documentElement;
      } else {
        return content;
      }
    }

    /**
     *
     * @param {null | string | Node | HTMLCollection | Node[] | Document & {generatedByIdiomorph:boolean}} newContent
     * @returns {Element}
     */
    function normalizeParent(newContent) {
      if (newContent == null) {
        return document.createElement("div"); // dummy parent element
      } else if (typeof newContent === "string") {
        return normalizeParent(parseContent(newContent));
      } else if (
        generatedByIdiomorph.has(/** @type {Element} */ (newContent))
      ) {
        // the template tag created by idiomorph parsing can serve as a dummy parent
        return /** @type {Element} */ (newContent);
      } else if (newContent instanceof Node) {
        if (newContent.parentNode) {
          // we can't use the parent directly because newContent may have siblings
          // that we don't want in the morph, and reparenting might be expensive (TODO is it?),
          // so instead we create a fake parent node that only sees a slice of its children.
          /** @type {Element} */
          return /** @type {any} */ (new SlicedParentNode(newContent));
        } else {
          // a single node is added as a child to a dummy parent
          const dummyParent = document.createElement("div");
          dummyParent.append(newContent);
          return dummyParent;
        }
      } else {
        // all nodes in the array or HTMLElement collection are consolidated under
        // a single dummy parent element
        const dummyParent = document.createElement("div");
        for (const elt of [...newContent]) {
          dummyParent.append(elt);
        }
        return dummyParent;
      }
    }

    /**
     * A fake duck-typed parent element to wrap a single node, without actually reparenting it.
     * This is useful because the node may have siblings that we don't want in the morph, and it may also be moved
     * or replaced with one or more elements during the morph. This class effectively allows us a window into
     * a slice of a node's children.
     * "If it walks like a duck, and quacks like a duck, then it must be a duck!" -- James Whitcomb Riley (1849–1916)
     */
    class SlicedParentNode {
      /** @param {Node} node */
      constructor(node) {
        this.originalNode = node;
        this.realParentNode = /** @type {Element} */ (node.parentNode);
        this.previousSibling = node.previousSibling;
        this.nextSibling = node.nextSibling;
      }

      /** @returns {Node[]} */
      get childNodes() {
        // return slice of realParent's current childNodes, based on previousSibling and nextSibling
        const nodes = [];
        let cursor = this.previousSibling
          ? this.previousSibling.nextSibling
          : this.realParentNode.firstChild;
        while (cursor && cursor != this.nextSibling) {
          nodes.push(cursor);
          cursor = cursor.nextSibling;
        }
        return nodes;
      }

      /**
       * @param {string} selector
       * @returns {Element[]}
       */
      querySelectorAll(selector) {
        return this.childNodes.reduce((results, node) => {
          if (node instanceof Element) {
            if (node.matches(selector)) results.push(node);
            const nodeList = node.querySelectorAll(selector);
            for (let i = 0; i < nodeList.length; i++) {
              results.push(nodeList[i]);
            }
          }
          return results;
        }, /** @type {Element[]} */ ([]));
      }

      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      insertBefore(node, referenceNode) {
        return this.realParentNode.insertBefore(node, referenceNode);
      }

      /**
       * @param {Node} node
       * @param {Node} referenceNode
       * @returns {Node}
       */
      moveBefore(node, referenceNode) {
        // @ts-ignore - use new moveBefore feature
        return this.realParentNode.moveBefore(node, referenceNode);
      }

      /**
       * for later use with populateIdMapWithTree to halt upwards iteration
       * @returns {Node}
       */
      get __idiomorphRoot() {
        return this.originalNode;
      }
    }

    /**
     *
     * @param {string} newContent
     * @returns {Node | null | DocumentFragment}
     */
    function parseContent(newContent) {
      let parser = new DOMParser();

      // remove svgs to avoid false-positive matches on head, etc.
      let contentWithSvgsRemoved = newContent.replace(
        /<svg(\s[^>]*>|>)([\s\S]*?)<\/svg>/gim,
        "",
      );

      // if the newContent contains a html, head or body tag, we can simply parse it w/o wrapping
      if (
        contentWithSvgsRemoved.match(/<\/html>/) ||
        contentWithSvgsRemoved.match(/<\/head>/) ||
        contentWithSvgsRemoved.match(/<\/body>/)
      ) {
        let content = parser.parseFromString(newContent, "text/html");
        // if it is a full HTML document, return the document itself as the parent container
        if (contentWithSvgsRemoved.match(/<\/html>/)) {
          generatedByIdiomorph.add(content);
          return content;
        } else {
          // otherwise return the html element as the parent container
          let htmlElement = content.firstChild;
          if (htmlElement) {
            generatedByIdiomorph.add(htmlElement);
          }
          return htmlElement;
        }
      } else {
        // if it is partial HTML, wrap it in a template tag to provide a parent element and also to help
        // deal with touchy tags like tr, tbody, etc.
        let responseDoc = parser.parseFromString(
          "<body><template>" + newContent + "</template></body>",
          "text/html",
        );
        let content = /** @type {HTMLTemplateElement} */ (
          responseDoc.body.querySelector("template")
        ).content;
        generatedByIdiomorph.add(content);
        return content;
      }
    }

    return { normalizeElement, normalizeParent };
  })();

  //=============================================================================
  // This is what ends up becoming the Idiomorph global object
  //=============================================================================
  return {
    morph,
    defaults,
  };
})();

module.exports = Idiomorph;


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./client/cms-live-updates/frame.ts");
/******/ 	
/******/ })()
;
//# sourceMappingURL=frame.js.map