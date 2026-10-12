import HostChannel from "../../channels/HostChannel";
import FluxLiveState from "../FluxLiveState";
import { logger } from "../../core/logger";
import type { JQueryElement, TinyMCEEditor } from "../../types/flux.interface";
import {
    fromAttributes,
    fromElement,
    getElementValue,
    type FluxDirective,
} from "./FluxDirectives";
import { fluxAttributesForField, reportSchemaFallback } from "./FluxFormSchema";

/** Events a schema-bound field can be configured to fire on (fx-event). */
const DELEGATED_EVENTS = ["click", "change", "keyup"];

function shouldUpgradeToHtml(
    previous: string,
    next: unknown,
    inlineEditActive: boolean,
): boolean {
    if (inlineEditActive) return false;
    return previous.trim().length === 0 && String(next).trim().length > 0;
}

export default class FluxDirectiveManager {
    constructor(
        private $: JQueryElement,
        private fluxState: FluxLiveState,
        private onTriggerUpdate: (owner: string | null) => void,
        private hostChannel: HostChannel,
        private onPatchUpdate: (
            key: string,
            value: string,
            owner: string | null,
        ) => void,
        private acceptsInputFrom: (element: HTMLElement) => boolean,
    ) {}

    /** Last value seen per schema-bound field, keyed by input name because React replaces the node on every change. */
    private schemaBoundValues = new Map<string, string>();

    initialize(): void {
        const manager = this;
        this.$.entwine("flux", function ($: JQueryElement) {
            manager.setupKeyBindings($);
        });
        this.setupSchemaBindings();
    }

    /**
     * Handles fields whose React component drops the fx-* attributes, such as Boolean fields, by listening at the
     * document and looking up their bindings in the form schema by input name. It listens in the capture phase,
     * because a checkbox's `checked` has already flipped when its click dispatches.
     */
    private setupSchemaBindings(): void {
        const handler = (event: Event): void => this.handleSchemaBoundEvent(event);
        for (const eventType of DELEGATED_EVENTS) {
            document.addEventListener(eventType, handler, true);
        }
    }

    private handleSchemaBoundEvent(event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const name = (target as HTMLInputElement).name;
        if (!name) return;

        if (target.closest("[fx-key]")) return;

        const attributes = fluxAttributesForField(name);
        if (!attributes) return;

        const binding = fromAttributes(target, attributes);
        if (!binding || binding.event !== event.type) return;

        reportSchemaFallback(name, binding.key);

        this.schemaBoundValues.set(
            name,
            this.handleInputChange(
                event,
                target,
                binding,
                this.schemaBoundValues.get(name) ?? "",
            ),
        );
    }

    private setupKeyBindings($: any): void {
        const manager = this;

        $("[fx-key]").entwine({
            onmatch: function (this: any) {
                const element: HTMLElement = this[0];

                if (!manager.acceptsInputFrom(element)) {
                    return;
                }

                const binding = fromElement(element);

                if (!binding) return;

                if (binding.proxySelector) {
                    manager.observeKeyProxyElement(element, binding);
                    return;
                }

                if (element.tagName === "TEXTAREA" && binding.type === "HTML") {
                    manager.setupTinyMCEListener(element, binding);
                    return;
                }

                let previousValue: string =
                    (element as HTMLInputElement).value ?? "";

                element.addEventListener(
                    binding.event as string,
                    (listenerEvent: Event) => {
                        previousValue = manager.handleInputChange(
                            listenerEvent,
                            element,
                            binding,
                            previousValue,
                        );
                    },
                );
            },
        });
    }

    private handleInputChange(
        listenerEvent: Event,
        element: HTMLElement,
        binding: FluxDirective,
        previousValue: string,
    ): string {
        if (!this.acceptsInputFrom(element)) {
            return previousValue;
        }

        let value: any;
        let rawType: string;

        if (binding.collectSelector) {
            value = Array.from(
                element.querySelectorAll(binding.collectSelector),
            ).map((el) => (el as HTMLInputElement).value);
            rawType = "HTML";
        } else {
            ({ value, type: rawType } = this.extractEventData(
                listenerEvent,
                binding.event,
                element,
            ));
        }

        let type = rawType;
        if (rawType === "Text" && shouldUpgradeToHtml(previousValue, value, this.hostChannel.isInlineEditInProgress)) {
            type = "HTML";
        }

        const nextPreviousValue = String(value);

        this.fluxState.updateField(binding.key, value, {
            type,
            owner: binding.owner ?? undefined,
        });

        logger.log(
            `[textUpdate] host input change: key="${binding.key}" owner="${binding.owner}" type="${type}" active=${this.fluxState.getIsActive()}`,
            value,
        );

        if (!this.fluxState.getIsActive()) return nextPreviousValue;

        if (type === "Text") {
            this.hostChannel.broadcastMessage({
                type: "textUpdate",
                key: binding.key,
                owner: binding.owner,
                event: binding.event,
                value,
            });
            return nextPreviousValue;
        }

        this.onTriggerUpdate(binding.owner);
        return nextPreviousValue;
    }

    private observeKeyProxyElement(
        element: HTMLElement,
        binding: FluxDirective,
    ): void {
        let previousValue: string | null = null;
        let isFirstRun = true;

        let observeTarget: HTMLElement = element;

        if (binding.proxyType === "previousElementSibling") {
            observeTarget =
                (element.previousElementSibling as HTMLElement) ?? element;
        } else if (binding.proxyType === "nextElementSibling") {
            observeTarget =
                (element.nextElementSibling as HTMLElement) ?? element;
        }

        const observer = new MutationObserver(() => {
            const proxiedElement = observeTarget.querySelector<HTMLElement>(
                binding.proxySelector!,
            );

            if (!proxiedElement) return;

            const currentValue = getElementValue(proxiedElement);

            if (isFirstRun) {
                previousValue = currentValue;
                isFirstRun = false;
                return;
            }

            if (currentValue !== previousValue) {
                previousValue = currentValue;

                if (!this.acceptsInputFrom(element)) {
                    return;
                }

                this.fluxState.updateField(binding.key, currentValue, {
                    owner: binding.owner ?? undefined,
                });

                this.onTriggerUpdate(binding.owner);
            }
        });

        observer.observe(observeTarget, {
            childList: true,
            subtree: true,
            characterData: false,
        });
    }

    private setupTinyMCEListener(
        element: HTMLElement,
        binding: FluxDirective,
    ): void {
        const editor = window.tinymce?.get(element.id);

        if (!editor) return;
        let previousContent: string = editor.getContent() ?? "";

        const getChangedContent = (): { editor: TinyMCEEditor; content: string } | null => {
            if (!this.acceptsInputFrom(element)) {
                return null;
            }

            const ed = window.tinymce?.get(element.id);
            if (!ed?.hasFocus()) return null;
            const content = ed.getContent();
            if (content === previousContent) return null;
            previousContent = content;
            return { editor: ed, content };
        };

        // An editor's value is markup, so it is morphed into the bound element;
        // a textUpdate would show the literal tags.
        const sendRichTextUpdate = () => {
            const result = getChangedContent();
            if (!result) return;
            const { editor: ed, content } = result;

            // TinyMCE renders shortcodes as DOM elements that morph smoothly;
            // getContent() gives the raw shortcode syntax.
            const value = this.containsShortcode(content)
                ? ed.getBody().innerHTML
                : content;

            // Record the editor's own markup, not the rendered body: the ChangeSet is replayed
            // through the server and must carry the shortcode source.
            this.fluxState.updateField(binding.key, content, {
                type: "HTML",
                owner: binding.owner ?? undefined,
            });

            this.hostChannel.broadcastMessage({
                type: "richTextUpdate",
                key: binding.key,
                owner: binding.owner,
                value,
            });
        };

        const sendPatchUpdate = () => {
            const result = getChangedContent();
            if (!result) return;
            const { content } = result;

            this.fluxState.updateField(binding.key, content, {
                type: "HTML",
                owner: binding.owner ?? undefined,
            });

            this.hostChannel.broadcastMessage({
                type: "richTextPatch",
                key: binding.key,
                owner: binding.owner,
                value: content,
            });
            this.onPatchUpdate(binding.key, content, binding.owner);
        };

        editor.on("input", () => {
            sendRichTextUpdate();
        });
        editor.on("Change", (e: any) => {
            if (!e.originalEvent || e.originalEvent.type === "execcommand") {
                sendPatchUpdate();
            }
        });
    }

    private containsShortcode(content: string): boolean {
        return /\[[a-zA-Z_][\w]*\s[^\]]*\]/.test(content);
    }

    private extractEventData(
        event: Event,
        eventType: string | null,
        element: HTMLElement,
    ): { value: any; type: string } {
        let value: any;
        let type: string = "HTML";
        const target = event.target as any;

        if (eventType === "keyup") {
            value = target.value;
            if (element.getAttribute("fx-event-type") === "templateUpdate" || value.length < 1) {
                type = "HTML";
            } else {
                type = "Text";
            }
        } else if (eventType === "click") {
            value = target.checked;
            type = "HTML";
        } else if (eventType === "change") {
            value = target.type === "checkbox" ? target.checked : target.value;
            type = "HTML";
        }

        return { value, type };
    }
}
