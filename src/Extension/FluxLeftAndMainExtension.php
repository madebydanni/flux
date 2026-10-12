<?php

namespace Flux\Extension;

use Flux\Context\FluxContextResolver;
use Flux\Core\Configuration;
use SilverStripe\Core\Extension;
use SilverStripe\Forms\Form;
use SilverStripe\Forms\LiteralField;
use SilverStripe\Security\Security;
use SilverStripe\Security\SecurityToken;
use SilverStripe\View\Requirements;

/**
 * Mounts the host JS and ships a bootstrap payload: inline for a full-page load, as a
 * form field for PJAX. Nested GridField items need no special handling here:
 * `LeftAndMain::currentRecordID()` already resolves them via `CMSMainCurrentRecordID`.
 * A LeftAndMain that runs no live update, such as an editor module's canvas page, sets `flux_live_update` to false.
 */
class FluxLeftAndMainExtension extends Extension
{

    public function onBeforeInit(): void
    {
        if (!Security::getCurrentUser() || !$this->getOwner()->config()->get('flux_live_update')) {
            return;
        }

        Requirements::javascript('dannidickson/flux: client/dist/js/bind/host.js');
        Requirements::javascript('dannidickson/flux: client/dist/js/silverstripe-cms/host.js');
    }

    public function onAfterInit(): void
    {
        if (!Security::getCurrentUser() || !$this->getOwner()->config()->get('flux_live_update')) {
            return;
        }

        $payload = $this->getBootstrap();

        if ($payload === null) {
            return;
        }

        Requirements::customScript(
            'window.FluxBootstrap = ' . json_encode($payload) . ';',
            'flux-bootstrap',
        );
    }

    public function updateEditForm(Form &$form): void
    {
        $recordId = $this->getOwner()->currentRecordID();
        $record = $this->getOwner()->getRecord($recordId);

        if ($record && $record->hasMethod('setFluxFields')) {
            $record->setFluxFields($form->Fields());
        }

        $payload = $this->getBootstrap();

        if ($payload === null) {
            return;
        }

        $json = htmlspecialchars(json_encode($payload), ENT_NOQUOTES | ENT_HTML5, 'UTF-8');
        $form->Fields()->push(
            LiteralField::create(
                'FluxBootstrapData',
                '<script type="application/json" id="flux-bootstrap-data">' . $json . '</script>',
            ),
        );
    }

    private function getBootstrap(): ?array
    {
        $contextResolver = new FluxContextResolver();
        $context = $contextResolver->forLeftAndMain($this->getOwner());

        if (!$context->hasContent()) {
            return null;
        }

        return [
            'context' => $context->jsonSerialize(),
            'contextHint' => $context->toContextHint(),
            'contextUrl' => '/flux/context',
            'csrf' => SecurityToken::getSecurityID(),
            'inlineEditorEnabled' => (bool) Configuration::config()->get('enable_inline_editor'),
            'liveUpdateInPreviewMode' => (bool) Configuration::config()->get('live_update_in_preview_mode'),
        ];
    }

}
