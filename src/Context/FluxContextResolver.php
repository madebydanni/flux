<?php

namespace Flux\Context;

use Flux\Schema\FluxSchema;
use SilverStripe\Admin\LeftAndMain;
use SilverStripe\Forms\GridField\GridField;
use SilverStripe\ORM\CMSPreviewable;
use SilverStripe\ORM\DataObject;
use Symbiote\GridFieldExtensions\GridFieldOrderableRows;

/**
 * Figures out what the current editing thing is. What the record and scope should be.
 * Called from the LeftAndMain extension, as well as the `flux/context` api endpoint
 */
class FluxContextResolver
{

    private FluxSchema $schema;

    public function __construct(?FluxSchema $schema = null)
    {
        $this->schema = $schema ?? new FluxSchema();
    }

    public function forLeftAndMain(LeftAndMain $admin): FluxContext
    {
        $record = $admin->currentRecord();

        if (!$record || !$record->exists()) {
            return FluxContext::empty();
        }

        return $this->forRecord($record);
    }

    /**
     * Build context for an item in a GridFieldDetailForm (caller has item, parent, relationName).
     */
    public function forGridFieldItem(DataObject $item, DataObject $parent, string $relationName): FluxContext
    {
        if ($parent->hasMethod('ElementalArea') && $relationName === 'ElementalArea') {
            return $this->getBlockContext($item, $parent);
        }

        return $this->getRelationItemInPageContext($item, $parent, $relationName);
    }

    public function forRecord(DataObject $record, ?int $itemID = null): FluxContext
    {
        if ($itemID && $record->hasMethod('ElementalArea')) {
            $element = $record->ElementalArea()->Items()->byID($itemID);

            if ($element instanceof DataObject && $element->exists()) {
                return $this->getBlockContext($element, $record);
            }
        }

        if ($record instanceof CMSPreviewable || $record->hasExtension(CMSPreviewable::class)) {
            return $this->getPageContext($record);
        }

        return $this->getRelationItemContext($record);
    }

    /**
     * Item row context on a page
     */
    private function getRelationItemInPageContext(
        DataObject $item,
        DataObject $parent,
        string $relationName,
    ): FluxContext {
        $segments = [
            $this->pageSegment($parent),
            [
                'Type' => 'RelationItem',
                'ClassName' => $item::class,
                'ID' => (string) $item->ID,
                'owner' => (string) $item->ID,
                'editLink' => $this->editLinkFor($item),
                'relation' => $relationName,
            ],
        ];

        $schema = $this->schema->forClasses([$parent::class, $item::class]);
        $this->addRelationsFromGridFields($parent, $schema);

        $context = new FluxContext(
            scopeKind: FluxContext::SCOPE_RELATION_ITEM,
            scopeOwnerId: (string) $item->ID,
            segments: $segments,
            schema: $schema,
            pageId: (int) $parent->ID,
            pageClass: $parent::class,
        );

        $parent->extend('updateFluxContext', $context);

        return $context;
    }

    private function getPageContext(DataObject $page): FluxContext
    {
        $segments = [$this->pageSegment($page)];
        $classes = [$page::class];

        foreach ($this->elementsOf($page) as $element) {
            $segments[] = $this->elementSegment($element);
            $classes[] = $element::class;
        }

        $schema = $this->schema->forClasses($classes);
        $this->addRelationsFromGridFields($page, $schema);
        array_push($segments, ...$this->relationItemSegments($page, $schema));

        $context = new FluxContext(
            scopeKind: FluxContext::SCOPE_PAGE,
            scopeOwnerId: null,
            segments: $segments,
            schema: $schema,
            pageId: $page->ID,
            pageClass: $page::class,
        );

        $page->extend('updateFluxContext', $context);

        return $context;
    }

    /**
     * One segment per relation row, keyed on the same bare-id owner token the DOM is stamped
     * with. Without a matching segment FluxLiveState drops the change silently.
     *
     * @param array $schema Class schema slice, already carrying relation ids.
     * @return array<int, array>
     */
    private function relationItemSegments(DataObject $record, array $schema): array
    {
        $relationNames = array_keys($schema[$record::class]['RelationFields'] ?? []);
        $segments = [];

        foreach ($relationNames as $relationName) {
            if (!$record->hasMethod($relationName)) {
                continue;
            }

            foreach ($record->$relationName() as $item) {
                $segments[] = [
                    'Type' => 'RelationItem',
                    'ClassName' => $item::class,
                    'ID' => (string) $item->ID,
                    'owner' => (string) $item->ID,
                    'relation' => $relationName,
                    'editLink' => $this->editLinkFor($item),
                ];
            }
        }

        return $segments;
    }

    /**
     * Adds per-record runtime data (row `ids`, GridField `actions`, `sortField`) that the static
     * schema can't know. Without the live row IDs the frame can't map DOM rows onto records, so
     * GridField DataObjects aren't editable at all.
     */
    private function addRelationsFromGridFields(DataObject $record, array &$schema): void
    {
        $className = $record::class;
        $relations = $schema[$className]['RelationFields'] ?? [];

        if ($relations === [] || !$record->hasMethod('getCMSFields')) {
            return;
        }

        // Index the record's GridFields by relation name once.
        $gridFields = [];

        foreach ($record->getCMSFields()->dataFields() as $field) {
            if (!$field instanceof GridField) {
                continue;
            }

            $gridFields[$field->getName()] = $field;
        }

        foreach ($relations as $relationName => $relation) {
            if (($relation['idMap'] ?? []) !== []) {
                continue;
            }

            $grid = $gridFields[$relationName] ?? null;

            $sortField = null;
            $orderable = $grid?->getConfig()->getComponentByType(GridFieldOrderableRows::class);

            if ($orderable) {
                $sortField = $orderable->getSortField();

                if (!array_key_exists('sortable', $relation)) {
                    $schema[$className]['RelationFields'][$relationName]['sortField'] = $sortField;
                }
            }

            if ($record->hasMethod($relationName)) {
                $list = $record->$relationName();

                if ($sortField) {
                    $list = $list->sort($sortField);
                }

                $schema[$className]['RelationFields'][$relationName]['ids'] =
                    array_values($list->column('ID'));
            }

            if (!$grid) {
                continue;
            }

            $schema[$className]['RelationFields'][$relationName]['actions'] =
                $this->actionsForGridField($grid);
        }
    }

    /**
     * Provides the actions for a GridField
     *
     * @return array<int, string>
     */
    private function actionsForGridField(GridField $grid): array
    {
        $actions = [];

        foreach ($grid->getConfig()->getComponents() as $component) {
            $componentClass = $component::class;

            if (str_contains($componentClass, 'GridFieldEditButton')) {
                $actions[] = 'edit';
            } elseif (str_contains($componentClass, 'GridFieldArchiveAction')) {
                $actions[] = 'archive';
            } elseif (str_contains($componentClass, 'GridFieldDeleteAction')) {
                $actions[] = 'delete';
            }
        }

        return $actions;
    }

    private function getBlockContext(DataObject $element, DataObject $page): FluxContext
    {
        $segments = [
            $this->pageSegment($page),
            $this->elementSegment($element),
        ];

        $ownerId = sprintf('#e%d', $element->ID);

        if ($element->hasMethod('getOwnerTarget')) {
            $ownerId = $element->getOwnerTarget();
        }

        $schema = $this->schema->forClasses([$page::class, $element::class]);

        $this->addRelationsFromGridFields($element, $schema);

        return new FluxContext(
            scopeKind: FluxContext::SCOPE_BLOCK,
            scopeOwnerId: $ownerId,
            segments: $segments,
            schema: $schema,
            pageId: (int) $page->ID,
            pageClass: $page::class,
        );
    }

    private function getRelationItemContext(DataObject $record): FluxContext
    {
        $segments = [
            [
                'Type' => 'RelationItem',
                'ClassName' => $record::class,
                'ID' => (string) $record->ID,
            ],
        ];

        return new FluxContext(
            scopeKind: FluxContext::SCOPE_RELATION_ITEM,
            scopeOwnerId: (string) $record->ID,
            segments: $segments,
            schema: $this->schema->forClasses([$record::class]),
        );
    }

    private function pageSegment(DataObject $page): array
    {
        return [
            'Type' => 'Page',
            'ClassName' => $page::class,
            'ID' => (string) $page->ID,
            'editLink' => $this->editLinkFor($page),
        ];
    }

    private function elementSegment(DataObject $element): array
    {
        $segment = [
            'Type' => 'Element',
            'ClassName' => $element::class,
            'ID' => (string) $element->ID,
            'editLink' => $this->editLinkFor($element),
        ];

        if ($element->hasMethod('getOwnerTarget')) {
            $segment['owner'] = $element->getOwnerTarget();
        }

        return $segment;
    }

    /**
     * Records without CMSEditLink() get null, and the frame falls back to toggle-only editing.
     */
    private function editLinkFor(DataObject $record): ?string
    {
        if (!$record->hasMethod('getCMSEditLink')) {
            return null;
        }

        $link = $record->getCMSEditLink();

        if (!$link) {
            return null;
        }

        return $link;
    }

    /**
     * @return iterable<DataObject>
     */
    private function elementsOf(DataObject $page): iterable
    {
        if (!$page->hasMethod('ElementalArea') || !$page->ElementalArea()->exists()) {
            return [];
        }

        return $page->ElementalArea()->Elements();
    }

}
