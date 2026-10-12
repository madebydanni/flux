import HostChannel from "../channels/HostChannel";
import { logger } from "../core/logger";
import type { FluxChunkedSaveResponse, FluxCmsMode, JQueryElement } from "../types/flux.interface";
import FluxApiClient from "./FluxApiClient";
import { applyPjaxBootstrapFromDom, currentContextHint } from "./FluxBootstrap";
import FluxDirectiveManager from "./directives/FluxDirectiveManager";
import FluxLiveState from "./FluxLiveState";

const API_ENDPOINT = "/flux";
const CMS_FRAME = 'iframe[name="cms-preview-iframe"]';
const PAGE_COOLDOWN_MS = 500;
const BLOCK_COOLDOWN_MS = 500;

/** Elemental saves through its own JSON API from React, so only watching fetch sees those writes. */
const BLOCK_SAVE_URL = /\/elemental-area\/api\/(saveForm|publish|unpublish)\b/;

/** The block a save was for, read from the `saveForm` path or the publish and unpublish JSON body. */
function blockIdFromSave(url: string, init?: RequestInit): string | null {
    const fromPath = url.match(/\/api\/saveForm\/(\d+)/);
    if (fromPath) {
        return fromPath[1];
    }

    const body = init?.body;
    if (typeof body !== "string") {
        return null;
    }

    try {
        const id = JSON.parse(body)?.id;
        return id === undefined || id === null ? null : String(id);
    } catch {
        return null;
    }
}

/** Returns a predicate that is true once a key has cooled down since its last allowed call, and records the call. */
function createCooldownGate(ms: number) {
    const lastCalled = new Map<string, number>();
    return (key = "default") => {
        const now = Date.now();
        if (now - (lastCalled.get(key) ?? 0) < ms) return false;
        lastCalled.set(key, now);
        return true;
    };
}

/**
 * Whether the CMS's PJAX save response reports a validation failure. Only a definite failure counts; a response
 * that can't be classified is treated as a successful save, as the CMS does.
 */
function validationFailed(xhr?: XMLHttpRequest): boolean {
    const body = xhr?.responseText;
    if (!body) return false;

    try {
        const fragment = JSON.parse(body)?.ValidationResult;
        if (typeof fragment !== "string") return false;

        const script = new DOMParser()
            .parseFromString(fragment, "text/html")
            .querySelector('script[type="application/json"]');

        return script?.textContent
            ? JSON.parse(script.textContent).isValid === false
            : false;
    } catch {
        return false;
    }
}

export default class FluxHostCoordinator {
    private hostChannel: HostChannel;
    private fluxState: FluxLiveState;
    private api: FluxApiClient;
    private readonly pageReady = createCooldownGate(PAGE_COOLDOWN_MS);
    private readonly blockReady = createCooldownGate(BLOCK_COOLDOWN_MS);
    private observers: MutationObserver[] = [];
    private suppressModalUpdate = false;
    private unwatchSaves: (() => void) | null = null;

    constructor(
        url: string,
        private $: JQueryElement,
    ) {
        this.hostChannel = new HostChannel(url, CMS_FRAME);
        this.fluxState = new FluxLiveState();
        this.api = new FluxApiClient(API_ENDPOINT);
    }

    initialize(): void {
        this.setupFrameReadyHandler();
        this.setupSplitModeObserver();
        this.setupModalObserver();
        this.setupFluxBindings();
        this.setupPjaxHandler();
        this.setupSaveHandlers();

        // The frame may have posted FRAME_READY before this host existed, such as on a direct refresh.
        this.hostChannel.connectExistingFrame();
    }

    private currentMode(): FluxCmsMode {
        const cmsContainer = document.querySelector(".cms-container");
        if (!cmsContainer) {
            return "edit";
        }

        if (cmsContainer.classList.contains("cms-container--preview-mode")) {
            return "preview";
        }
        if (cmsContainer.classList.contains("cms-container--split-mode")) {
            return "split";
        }

        return "edit";
    }


    /**
     * Check if the Live Editing mode is on based on CMS Mode
     *
     * Preview mode can be configured on or off via Configuration
     * `'Configuration::live_update_in_preview_mode`
     *
     * @param mode
     * @returns
     */
    private isLiveOnMode(mode: FluxCmsMode): boolean {
        if (mode === "split") {
            return true;
        }


        if (mode === "preview") {
            return window.FluxLiveUpdateInPreviewMode !== false;
        }

        return false;
    }

    private acceptsInputFrom(element: HTMLElement): boolean {
        if (this.currentMode() !== "preview") {
            return true;
        }

        if (this.isLiveOnMode("preview")) {
            return true;
        }

        return element.closest(".cms-edit-form") !== null;
    }

    private broadcastMode(): void {
        this.hostChannel.broadcastMessage({
            type: "modeChange",
            mode: this.currentMode(),
        });
    }

    private setupFrameReadyHandler(): void {
        this.hostChannel.setOnFrameReady(() => {
            this.sendContextHintToIframe();
            this.broadcastMode();
            this.sendPageUpdateIfChanged();
        });
    }

    /** Tells the frame which record is active, so it can fetch more by that scope. */
    private sendContextHintToIframe(): void {
        const hint = currentContextHint();
        if (!hint) {
            logger.warn("No context hint available to send to iframe");
            return;
        }
        this.hostChannel.broadcastMessage({
            type: "contextHint",
            class: hint.class,
            id: hint.id,
            itemID: hint.itemID ?? null,
            relation: hint.relation ?? null,
        });
    }

    private sendPageUpdateIfChanged(): void {
        if (!this.fluxState.getIsActive()) {
            return;
        }

        if (this.fluxState.hasChanges()) {
            this.sendPageTemplateUpdate();
        }
    }

    private sendFluxConfigToIframe(): void {
        if (window.FluxConfig) {
            this.hostChannel.broadcastMessage({
                type: "configUpdate",
                config: window.FluxConfig,
            });
        }
    }

    private observeClassAttribute(
        element: Element,
        callback: (el: HTMLElement) => void,
    ): MutationObserver {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                callback(mutation.target as HTMLElement);
            });
        });
        observer.observe(element, {
            attributes: true,
            attributeFilter: ["class"],
        });
        return observer;
    }

    private setupSplitModeObserver(): void {
        const cmsContainer = document.querySelector(".cms-container");
        if (!cmsContainer) return;

        let lastMode = this.currentMode();
        this.fluxState.setLiveStateActive(this.isLiveOnMode(lastMode));

        const observer = this.observeClassAttribute(cmsContainer, () => {
            const mode = this.currentMode();
            if (mode === lastMode) return;

            const wasLive = this.isLiveOnMode(lastMode);
            const live = this.isLiveOnMode(mode);

            // Changes are kept, so entering a live mode re-applies the config and draft state.
            if (!wasLive && live) {
                this.fluxState.setLiveStateActive(true);
                this.sendFluxConfigToIframe();
                this.sendPageUpdateIfChanged();
            } else if (wasLive && !live) {
                this.fluxState.setLiveStateActive(false);
            }

            lastMode = mode;
            this.broadcastMode();
        });

        this.observers.push(observer);
    }

    /** Treats a closed modal as a 'templateUpdate', so an edited Link or Image re-renders in the preview. */
    private setupModalObserver(): void {
        const bodyElement = document.body;
        if (!bodyElement) return;

        let modalOpen = bodyElement.classList.contains("modal-open");

        const observer = this.observeClassAttribute(bodyElement, (target) => {
            const isOpen = target.classList.contains("modal-open");
            if (isOpen === modalOpen) return;
            modalOpen = isOpen;

            if (isOpen) {
                logger.log("Modal opened");
                return;
            }

            window.setTimeout(() => {
                if (!this.fluxState.getIsActive()) {
                    logger.log("Modal closed — no live preview, skipping update");
                    return;
                }

                if (this.suppressModalUpdate) {
                    logger.log(
                        "Modal closed — skipping update (TinyMCE handled)",
                    );
                    this.suppressModalUpdate = false;
                    return;
                }
                logger.log("Modal closed");
                this.sendPageTemplateUpdate();
            }, 500);
        });

        this.observers.push(observer);
    }

    async sendPageTemplateUpdate(): Promise<void> {
        if (!this.pageReady()) {
            logger.log("Still in cooldown, skipping update");
            return;
        }

        try {
            const payload = this.fluxState.toPageUpdatePayload();
            const response = await this.api.sendPageUpdate(payload);

            if (!response.trusted) {
                logger.warn("Source HTML returned unsafe html");
            }

            this.hostChannel.broadcastMessage({
                type: "pageTemplateUpdate",
                html: response.html,
                changedFields: response.changedFields,
            });

            if (response.spliceMisses?.length) {
                logger.error(
                    "Element regions not found. May stale content for:",
                    response.spliceMisses,
                );
            }

            if (response.segmentTemplateChanges) {
                const { Elements } = response.segmentTemplateChanges;
                for (const [id, fragment] of Object.entries(Elements)) {
                    if (!fragment.owner) {
                        logger.error(
                            `Element ${id} has no owner target; skipping block`,
                        );
                        continue;
                    }
                    this.hostChannel.broadcastMessage({
                        type: "blockUpdate",
                        html: fragment.html,
                        targetOwner: fragment.owner,
                    });
                }
            }
        } catch (error) {
            logger.error("Template update failed:", error);
            throw error;
        }
    }

    async sendBlockUpdate(owner: string): Promise<void> {
        if (!this.blockReady(owner)) {
            logger.log(`Block cooldown active for ${owner}, skipping`);
            return;
        }

        try {
            const payload = this.fluxState.toBlockUpdatePayload(owner);
            const response = await this.api.sendBlockUpdate(payload, owner);

            if (!response.trusted) {
                logger.warn("Block update returned unsafe html");
            }

            logger.log(`Morphing block: ${owner}`);
            this.hostChannel.broadcastMessage({
                type: "blockUpdate",
                html: response.html,
                targetOwner: owner,
            });
        } catch (error) {
            logger.warn(
                "Block update failed, falling back to full page update:",
                error,
            );
            this.sendPageTemplateUpdate();
        }
    }

    triggerUpdate(owner: string | null): void {
        if (!this.fluxState.getIsActive()) return;

        if (owner) {
            this.sendBlockUpdate(owner);
            return;
        }

        this.sendPageTemplateUpdate();
    }

    /**
     * Saves all draft state block by block in one transaction.
     *
     * @TODO not yet final
     */
    async saveChunked(): Promise<FluxChunkedSaveResponse> {
        const payload = this.fluxState.getChunkedSavePayload();
        if (payload.chunks.length === 0) {
            return {
                ok: true,
                saved: [],
                errors: []
            };
        }

        const result = await this.api.sendChunkedSave(payload);

        if (result.ok) {
            this.fluxState.clear();
            this.sendPageTemplateUpdate();
            return result;
        }

        logger.warn("Chunked save failed:", result.errors);
        return result;
    }

    async sendPatchUpdate(
        key: string,
        value: string,
        owner: string | null,
    ): Promise<void> {
        if (!this.fluxState.getIsActive()) return;

        this.suppressModalUpdate = true;

        try {
            const data = await this.api.sendPatchUpdate(key, value, owner);

            this.hostChannel.broadcastMessage({
                type: "patchTemplateUpdate",
                key: data.key,
                owner: data.owner,
                value: data.html,
            });
        } catch (error) {
            logger.warn(
                "Patch update failed, falling back to full update:",
                error,
            );
            this.triggerUpdate(owner);
        }
    }

    /** Waits for the swapped HTML to contain the new script before applying the bootstrap. */
    private setupPjaxHandler(): void {
        this.$(document).on("ajaxComplete", () => {
            requestAnimationFrame(() => {
                if (!applyPjaxBootstrapFromDom()) return;
                this.sendContextHintToIframe();
            });
        });
    }

    /**
     * A save makes the database authoritative, so the recorded changes are dropped. The preview reloads after a save
     * and its FRAME_READY would replay the ChangeSet over the saved render, so the reload stands and keeps the stage
     * the CMS is previewing (/flux/pageTemplateUpdate always renders Draft).
     */
    private setupSaveHandlers(): void {
        const coordinator = this;

        this.$.entwine("flux", function ($: any) {
            $(".cms-edit-form").entwine({
                onaftersubmitform: function (this: any, event: any, data: any) {
                    coordinator.handleRecordSaved("form submit", data?.xhr);
                    this._super(event, data);
                },
            });
        });

        this.watchBlockSaves();
    }

    /**
     * Watches fetch for Elemental's React block save, publish and unpublish. Responses are only inspected, because
     * reading the body would starve the real caller.
     */
    private watchBlockSaves(): void {
        if (this.unwatchSaves) return;

        const originalFetch = window.fetch;
        if (!originalFetch) return;

        // Chrome throws "Illegal invocation" on a fetch called off the window.
        const callOriginal = originalFetch.bind(window);

        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const response = await callOriginal(...args);

            try {
                const [resource] = args;
                const url =
                    typeof resource === "string"
                        ? resource
                        : resource instanceof Request
                          ? resource.url
                          : String(resource);

                if (response.ok && BLOCK_SAVE_URL.test(url)) {
                    this.handleBlockSaved(url, args[1]);
                }
            } catch (error) {
                logger.error(
                    "Could not tell whether a fetch was a block save — stale changes may be replayed over it:",
                    error,
                );
            }

            return response;
        };

        this.unwatchSaves = () => {
            window.fetch = originalFetch;
        };
    }

    private handleRecordSaved(source: string, xhr?: XMLHttpRequest): void {
        if (validationFailed(xhr)) {
            logger.warn(
                `Save (${source}) failed validation — keeping recorded changes so the preview still shows them`,
            );
            return;
        }

        const dropped = this.fluxState.clear();
        if (!dropped.length) return;

        logger.log(
            `Saved (${source}) — dropped recorded changes, the preview reload renders from the database:`,
            dropped,
        );
    }

    /** A block write makes the database authoritative for that block alone; the other pending edits must survive. */
    private handleBlockSaved(url: string, init?: RequestInit): void {
        const elementId = blockIdFromSave(url, init);

        if (elementId === null) {
            logger.error(
                `Block write to ${url} did not identify its element — keeping all recorded changes, ` +
                    'so the preview may replay a stale value over the saved one.',
            );
            return;
        }

        const dropped = this.fluxState.clearRecord("Element", elementId);
        if (!dropped.length) return;

        logger.log(
            `Block ${elementId} saved — dropped its recorded changes, the rest of the page keeps its own:`,
            dropped,
        );
    }

    private setupFluxBindings(): void {
        const bindingManager = new FluxDirectiveManager(
            this.$,
            this.fluxState,
            (owner) => this.triggerUpdate(owner),
            this.hostChannel,
            (key, value, owner) => this.sendPatchUpdate(key, value, owner),
            (element) => this.acceptsInputFrom(element),
        );

        bindingManager.initialize();
    }

    destroy(): void {
        this.observers.forEach((observer) => observer.disconnect());
        this.observers = [];
        this.unwatchSaves?.();
        this.unwatchSaves = null;
        this.hostChannel.destroy();
    }
}
