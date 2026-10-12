<?php

namespace Flux\Extension;

use Flux\Context\FluxContextResolver;
use Flux\Core\Configuration;
use SilverStripe\Control\Controller;
use SilverStripe\Control\HTTPRequest;
use SilverStripe\Control\Middleware\HTTPCacheControlMiddleware;
use SilverStripe\Core\Extension;
use SilverStripe\Model\ModelData;
use SilverStripe\ORM\DataObject;
use SilverStripe\Security\SecurityToken;
use SilverStripe\View\Requirements;

/**
 * Injects page context inline as `window.FluxFrameContext`
 * Preview frame will apply the fx directives on load
 * Rather than waiting for the host (CMS)
 *
 * @extends Extension<object>
 */
class FluxExtension extends Extension
{

    /**
     * Set when this render is for an editor module's page script, so the module may change its HTML.
     */
    private bool $rendersForEditor = false;

    public function onBeforeInit(): void
    {
        if (!Configuration::config()->get('enable_auto_set_fields')) {
            return;
        }

        Requirements::javascript('dannidickson/flux: client/dist/js/frontend.js');

        $request = Controller::curr()->getRequest();

        if (!$request->getVar('CMSPreview') || !SecurityToken::getSecurityID()) {
            return;
        }

        // Preview frame has a stable URL, so mark it uncacheable to avoid stale copies on reload.
        HTTPCacheControlMiddleware::singleton()->disableCache();

        Requirements::css('dannidickson/flux: client/dist/styles/preview.css');
        Requirements::javascript('dannidickson/flux: client/dist/js/bind/frame.js');
        Requirements::javascript('dannidickson/flux: client/dist/js/silverstripe-cms/frame.js');

        $this->injectFrameContext();

        if (!$this->rendersForEditorModule($request)) {
            return;
        }

        $this->includeEditorPageRequirements();
        $this->getOwner()->extend('beforeEditorRender', $request);
        $this->rendersForEditor = true;
    }

    /**
     * Lets an editor module change the HTML of its render (`updateEditorHtml`). Only a render through an action
     * handler is offered, which is how a preview renders a page.
     */
    public function afterCallActionHandler(HTTPRequest $request, string $action, mixed $result): ?string
    {
        if (!$this->rendersForEditor) {
            return null;
        }

        if (!is_string($result) && !$result instanceof ModelData) {
            return null;
        }

        $record = $this->getOwner()->data();

        if (!$record instanceof DataObject || !$record->exists()) {
            return null;
        }

        $html = $result;

        if ($result instanceof ModelData) {
            $html = $result->forTemplate();
        }

        $this->getOwner()->extend('updateEditorHtml', $html, $record);

        return $html;
    }

    /**
     * Whether an editor module takes this preview render for its page script: any extension answering
     * `isEditorRender` with true.
     */
    private function rendersForEditorModule(HTTPRequest $request): bool
    {
        return in_array(true, $this->getOwner()->extend('isEditorRender', $request), true);
    }

    /**
     * Adds the page script and stylesheet that an editor module registers in config.
     */
    private function includeEditorPageRequirements(): void
    {
        foreach (Configuration::config()->get('editor_page_javascript') as $file) {
            Requirements::javascript($file);
        }

        foreach (Configuration::config()->get('editor_page_css') as $file) {
            Requirements::css($file);
        }
    }

    private function injectFrameContext(): void
    {
        $record = $this->getOwner()->data();

        if (!($record instanceof DataObject) || !$record->exists()) {
            return;
        }

        $context = (new FluxContextResolver())->forRecord($record);

        if (!$context->hasContent()) {
            return;
        }

        $inlineEditorEnabled = (bool) Configuration::config()->get('enable_inline_editor');
        $inlineEditorFlag = 'false';

        if ($inlineEditorEnabled) {
            $inlineEditorFlag = 'true';
        }

        Requirements::customScript(
            'window.FluxFrameContext = ' . json_encode($context->jsonSerialize()) . ';'
                . 'window.FluxCsrf = ' . json_encode(SecurityToken::getSecurityID()) . ';'
                . 'window.FluxInlineEditorEnabled = ' . $inlineEditorFlag . ';',
            'flux-frame-context',
        );
    }

}
