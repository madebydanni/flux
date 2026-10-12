<?php

namespace Flux\Extension\Forms;

use SilverStripe\Core\Extension;
use SilverStripe\Forms\FormField;
use SilverStripe\ORM\DataObject;
use WeakMap;

/**
 * Base flux attributes for every FormField. Field-type extensions override
 * applyFluxAttributes() to add their own.
 *
 * @extends Extension<FormField>
 */
class FormFieldExtension extends Extension
{

    /**
     * Keyed by field, because one extension instance serves every FormField.
     *
     * @var WeakMap<FormField, DataObject>|null
     */
    private static ?WeakMap $panelOwnerRecords = null;

    /** @var WeakMap<FormField, string>|null */
    private static ?WeakMap $panelFieldNames = null;

    /**
     * The record this field loads from and saves to in a custom panel, when it isn't the panel's own record.
     */
    public function setPopupOwnerRecord(DataObject $record): FormField
    {
        if (self::$panelOwnerRecords === null) {
            self::$panelOwnerRecords = new WeakMap();
        }

        self::$panelOwnerRecords[$this->getOwner()] = $record;

        return $this->getOwner();
    }

    public function getPopupOwnerRecord(): ?DataObject
    {
        if (self::$panelOwnerRecords === null || !isset(self::$panelOwnerRecords[$this->getOwner()])) {
            return null;
        }

        return self::$panelOwnerRecords[$this->getOwner()];
    }

    /**
     * The property this field loads and saves in a custom panel, when its name is an alias: a panel can't hold two
     * fields named Title from two records.
     */
    public function setPopupFieldName(string $property): FormField
    {
        if (self::$panelFieldNames === null) {
            self::$panelFieldNames = new WeakMap();
        }

        self::$panelFieldNames[$this->getOwner()] = $property;

        return $this->getOwner();
    }

    public function getPopupFieldName(): ?string
    {
        if (self::$panelFieldNames === null || !isset(self::$panelFieldNames[$this->getOwner()])) {
            return null;
        }

        return self::$panelFieldNames[$this->getOwner()];
    }

    /**
     * Every FormField needs a key, a bind target (DOM selector) and a type.
     */
    public function applyFluxAttributes(string $key, string $value, ?string $fluxType): void
    {
        $this->getOwner()->setAttribute('fx-key', $key);
        $this->getOwner()->setAttribute('fx-bind', $value);
        $this->getOwner()->setAttribute('fx-type', $fluxType);
    }

    /**
     * For a relation (has_one, has_many) it requires an owner id (target)
     */
    public function applyFluxOwnerAttribute(?object $owner): void
    {
        if (!$owner || !method_exists($owner, 'getOwnerTarget')) {
            return;
        }

        $ownerTarget = $owner->getOwnerTarget();

        if (!$ownerTarget) {
            return;
        }

        $this->getOwner()->setAttribute('fx-owner', $ownerTarget);
    }

}
