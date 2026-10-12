/**
 * Bridges the v2 `window.FluxBootstrap` payload into the v1 `window.FluxConfig` shape.
 *
 * Connects the `window.FluxBootstrap` and `window.FluxConfig` payloads together.
 *
 * @todo need to merge in the various states from config to livestate into a single var
 */

import { logger } from "../core/logger";
import type {
    FluxConfigSegment,
    FluxConfigStructure,
} from "../types/flux.interface";

export interface FluxScope {
    kind: "page" | "block" | "relation-item";
    ownerId: string | null;
}

export interface FluxContextPayload {
    scope: FluxScope;
    page: { id: number; class: string } | null;
    segments: FluxConfigSegment[];
    schema: Record<string, { Fields: Record<string, any>; RelationFields: Record<string, any> }>;
}

export interface FluxContextHint {
    class: string;
    id: number;
    itemID?: number | null;
    relation?: string | null;
}

export interface FluxBootstrapPayload {
    context?: FluxContextPayload;
    contextHint?: FluxContextHint | null;
    contextUrl?: string;
    pageClass?: string;
    pageId?: number;
    csrf?: string;
    inlineEditorEnabled?: boolean;
    liveUpdateInPreviewMode?: boolean;
}

declare global {
    interface Window {
        FluxBootstrap?: FluxBootstrapPayload;
        FluxFrameContext?: FluxContextPayload;
        FluxScope?: FluxScope;
        FluxCsrf?: string;
        FluxContextHint?: FluxContextHint | null;
        FluxInlineEditorEnabled?: boolean;
        FluxLiveUpdateInPreviewMode?: boolean;
    }
}

/**
 * Converts a v2 context payload into the legacy FluxConfig shape. The in-flight ChangeSet survives only while
 * the same record (page id and class) is edited.
 */
export function adaptContextToFluxConfig(context: FluxContextPayload): FluxConfigStructure {
    const fields: Record<string, Record<string, any>> = {};
    const relationFields: Record<string, Record<string, any>> = {};

    for (const [className, slice] of Object.entries(context.schema)) {
        fields[className] = slice.Fields ?? {};
        relationFields[className] = slice.RelationFields ?? {};
    }

    const previous = window.FluxConfig;
    const previousPage = previous?.Segments?.find((s) => s.Type === "Page");
    const nextPage = context.segments.find((s) => s.Type === "Page");

    const sameRecord =
        !!previousPage &&
        !!nextPage &&
        String(previousPage.ID) === String(nextPage.ID) &&
        previousPage.ClassName === nextPage.ClassName;

    let changeSet: Record<string, Record<string, any>> = {};
    if (sameRecord) {
        changeSet = previous?.ChangeSet ?? {};
    } else if (previous?.ChangeSet && Object.keys(previous.ChangeSet).length > 0) {
        logger.error(
            "Discarding pending changes: context switched records",
            {
                from: previousPage ? `${previousPage.ClassName}#${previousPage.ID}` : null,
                to: nextPage ? `${nextPage.ClassName}#${nextPage.ID}` : null,
                discarded: Object.keys(previous.ChangeSet),
            },
        );
    }

    return {
        Segments: context.segments,
        Fields: fields,
        RelationFields: relationFields,
        ChangeSet: changeSet as Record<string, Record<string, any>>,
        Events: [],
    };
}

export function applyContext(context: FluxContextPayload): void {
    window.FluxConfig = adaptContextToFluxConfig(context);
    window.FluxScope = context.scope;
    logger.log("Applied Flux context:", context.scope);
}

/** Reads the innermost `#flux-bootstrap-data` tag, because nested items add one inside the outer form's. */
function readBootstrapScriptTag(): FluxBootstrapPayload | null {
    const nodes = document.querySelectorAll<HTMLScriptElement>('script#flux-bootstrap-data');
    if (nodes.length === 0) return null;

    for (let i = nodes.length - 1; i >= 0; i--) {
        const txt = nodes[i].textContent;
        if (!txt) continue;
        try {
            return JSON.parse(txt) as FluxBootstrapPayload;
        } catch {
        }
    }
    return null;
}

/** Host entry: applies the inline bootstrap, returning the FluxConfig or null when there is none. */
function applyBootstrapPayload(payload: FluxBootstrapPayload): void {
    if (payload.csrf) window.FluxCsrf = payload.csrf;
    if (payload.contextHint !== undefined) window.FluxContextHint = payload.contextHint;
    if (payload.inlineEditorEnabled !== undefined) window.FluxInlineEditorEnabled = payload.inlineEditorEnabled;
    if (payload.liveUpdateInPreviewMode !== undefined) {
        window.FluxLiveUpdateInPreviewMode = payload.liveUpdateInPreviewMode;
    }
    applyContext(payload.context!);
}

export function applyInlineHostBootstrap(): FluxConfigStructure | null {
    const bootstrap = readBootstrapScriptTag() ?? window.FluxBootstrap ?? null;
    if (!bootstrap?.context) return null;
    applyBootstrapPayload(bootstrap);
    return window.FluxConfig ?? null;
}

/** The latest hint from a host bootstrap, for the host to send to the frame. */
export function currentContextHint(): FluxContextHint | null {
    return window.FluxContextHint ?? null;
}

/** Host PJAX hook: reads the bootstrap from the swapped form HTML, since a PJAX request fetches only the form. */
export function applyPjaxBootstrapFromDom(): boolean {
    const payload = readBootstrapScriptTag();
    if (!payload?.context) return false;
    applyBootstrapPayload(payload);
    return true;
}

/**
 * Preview-frame entry: fetches /flux/context with the params the host sent in the contextHint message, since
 * only the CMS knows which record is being edited. Resolves to the applied FluxConfig.
 */
export async function fetchFluxContext(hint: FluxContextHint): Promise<FluxConfigStructure | null> {
    const context = await fetchContextPayload(hint);
    if (!context) return null;
    applyContext(context);
    return window.FluxConfig ?? null;
}

/**
 * Fetches the context payload without applying it, so the frame's boot fetch can't overwrite a more specific
 * scope the host sent meanwhile.
 */
export async function fetchContextPayload(hint: FluxContextHint): Promise<FluxContextPayload | null> {
    const params = new URLSearchParams();
    params.set("class", hint.class);
    params.set("id", String(hint.id));
    if (hint.itemID) params.set("itemID", String(hint.itemID));
    if (hint.relation) params.set("relation", hint.relation);

    try {
        const response = await fetch(`/flux/context?${params.toString()}`, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            logger.warn("Flux context fetch failed:", response.status);
            return null;
        }
        return (await response.json()) as FluxContextPayload;
    } catch (error) {
        logger.warn("Flux context fetch error:", error);
        return null;
    }
}
