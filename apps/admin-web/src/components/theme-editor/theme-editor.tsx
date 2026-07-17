"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  LAYOUT_TEMPLATES,
  bindingToCollectionQuery,
  collectDocumentCollections,
  collectionNameFor,
  type ContentDto,
  type LayoutDocument,
  type LayoutNode,
  type LayoutTemplateName,
  type LayoutTokens,
  type MenuDto,
} from "@zcmsorg/schemas";
import type { ContentTypeOption } from "@/lib/block-registry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n-provider";
import {
  createColumn,
  createRow,
  createSection,
  createWidget,
  duplicateNode,
  insertNode,
  locate,
  moveNode,
  removeNode,
  setBinding,
  setProps,
  templateTree,
  withTemplate,
} from "@/lib/layout-doc";
import { buildPreviewContext, sampleRows } from "@/lib/preview-context";
import { saveThemeDraftAction } from "@/app/actions/theme-draft";
import type { ThemeDraftDto } from "@/lib/api";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { PublishPanel } from "./publish-panel";

/**
 * The Theme Editor.
 *
 * Three panes: what you can add, what you have drawn, and the knobs of whatever is
 * selected. The document lives in state here and goes to the server whole — see
 * saveThemeDraftAction for why a tree is not patchable.
 *
 * Saving is explicit, not autosave-on-keystroke. A drawing is a design, and a
 * design is a thing people try ideas in; a save on every drag would make Undo the
 * only way back from an experiment, and there is no Undo yet.
 */
export function ThemeEditor({
  draft,
  contentTypes,
  menus,
  siteName,
  locale,
  canEdit,
  canPublish,
}: {
  draft: ThemeDraftDto;
  contentTypes: ContentTypeOption[];
  menus: MenuDto[];
  siteName: string;
  locale: string;
  canEdit: boolean;
  /** `theme:publish` — may put this company's name on a public package. */
  canPublish: boolean;
}) {
  const t = useT();
  const [doc, setDoc] = useState<LayoutDocument>(draft.document);
  const [template, setTemplate] = useState<LayoutTemplateName>("page");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const tree = templateTree(doc, template);
  const selected = selectedId ? (locate(tree, selectedId)?.node ?? null) : null;
  const disabled = !canEdit || saving;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A few pixels of slop, or every click on a widget starts a drag and
      // selecting something becomes impossible.
      activationConstraint: { distance: 5 },
    }),
    // The reason a drag library was acceptable here at all: dnd-kit's drags are
    // operable from the keyboard. A canvas that could only be arranged by mouse
    // would be a feature some people simply cannot use.
    useSensor(KeyboardSensor),
  );

  /**
   * The canvas draws real widgets, and a post-list reads ctx.collections under the
   * name derived from its own binding. Sample rows are keyed the same way, so the
   * preview populates through exactly the path the live theme will use rather than
   * a special case that could drift from it.
   */
  const ctx = useMemo(() => {
    const base = buildPreviewContext({ siteName, locale, menus });
    const collections: Record<string, ContentDto[]> = {};
    for (const [name, query] of Object.entries(collectDocumentCollections(doc))) {
      const label = contentTypes.find((c) => c.key === query.contentType)?.name ?? query.contentType;
      collections[name] = sampleRows(query.limit ?? 6, label);
    }
    return { ...base, collections } as typeof base;
  }, [doc, siteName, locale, menus, contentTypes]);

  const mutate = useCallback(
    (next: LayoutNode[]) => {
      setDoc((current) => withTemplate(current, template, next));
      setDirty(true);
      setMessage(null);
    },
    [template],
  );

  /** The current column: where a click-to-add widget lands. */
  const currentColumnId = useMemo(() => {
    if (selected?.kind === "column") return selected.id;
    if (selectedId) {
      const found = locate(tree, selectedId);
      if (found?.parent?.kind === "column") return found.parent.id;
    }
    // Nothing selected: the first column of the template, so the very first widget
    // an author adds has somewhere to go without them learning the tree first.
    const firstSection = tree[0];
    const firstRow = firstSection?.children?.[0];
    return firstRow?.children?.[0]?.id ?? null;
  }, [selected, selectedId, tree]);

  function addWidget(widgetType: string) {
    if (!currentColumnId) {
      setMessage(t("themeEditor.errors.noColumn"));
      return;
    }
    const node = createWidget(widgetType);
    const column = locate(tree, currentColumnId);
    mutate(insertNode(tree, currentColumnId, column?.node.children?.length ?? 0, node));
    setSelectedId(node.id);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { kind?: string; widgetType?: string } | undefined;
    const overId = String(over.id);

    // A palette item is not in the tree yet — dropping it is an insert, not a move.
    if (activeData?.kind === "new" && activeData.widgetType) {
      const column = locate(tree, overId);
      if (column?.node.kind !== "column") return;
      const node = createWidget(activeData.widgetType);
      mutate(insertNode(tree, overId, column.node.children?.length ?? 0, node));
      setSelectedId(node.id);
      return;
    }

    const activeId = String(active.id);
    if (activeId === overId) return;

    // moveNode refuses a drop the containment rule forbids and returns the tree
    // unchanged, so an illegal drop is a no-op here rather than a special case.
    const target = locate(tree, overId);
    if (!target) return;
    const next = moveNode(tree, activeId, overId, target.node.children?.length ?? 0);
    if (next !== tree) mutate(next);
  }

  function moveWithin(id: string, delta: number) {
    const found = locate(tree, id);
    if (!found) return;
    const parentId = found.parent?.id;
    if (!parentId) {
      // A root section: reorder the template's top level directly.
      const index = tree.findIndex((n) => n.id === id);
      const target = index + delta;
      if (target < 0 || target >= tree.length) return;
      const copy = [...tree];
      const [item] = copy.splice(index, 1);
      if (item) copy.splice(target, 0, item);
      mutate(copy);
      return;
    }
    mutate(moveNode(tree, id, parentId, found.index + delta + (delta > 0 ? 1 : 0)));
  }

  function save() {
    startSave(async () => {
      const result = await saveThemeDraftAction(draft.id, { document: doc });
      if (result.ok) {
        setDirty(false);
        setMessage(t("themeEditor.saved"));
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">{draft.name}</h1>
            <code className="text-xs text-neutral-500">{draft.key}</code>
          </div>

          <div className="flex items-center gap-1" role="tablist" aria-label={t("themeEditor.templates.label")}>
            {LAYOUT_TEMPLATES.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={template === name}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  template === name
                    ? "bg-brand-500 text-white"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
                onClick={() => {
                  setTemplate(name);
                  setSelectedId(null);
                }}
              >
                {t(`themeEditor.templates.${name}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {message ? <span className="text-xs text-neutral-500">{message}</span> : null}
            {dirty ? (
              <span className="text-xs text-amber-600">{t("themeEditor.unsaved")}</span>
            ) : null}
            <Button size="sm" disabled={disabled || !dirty} onClick={save}>
              {saving ? t("themeEditor.actions.saving") : t("themeEditor.actions.save")}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-52 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
            <Palette onAdd={addWidget} disabled={disabled} />
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto bg-neutral-100 dark:bg-neutral-900">
            {/* The template a person never drew has no tree — `page` is the only
                required one, and the rest fall back to it at render time. Saying so
                beats an empty canvas that looks broken. */}
            <Canvas
              tree={tree}
              ctx={ctx}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddSection={() => mutate([...tree, createSection()])}
              onAddRow={(sectionId) => {
                const section = locate(tree, sectionId);
                mutate(insertNode(tree, sectionId, section?.node.children?.length ?? 0, createRow()));
              }}
              onAddColumn={(rowId) => {
                const row = locate(tree, rowId);
                mutate(insertNode(tree, rowId, row?.node.children?.length ?? 0, createColumn(6)));
              }}
              onMoveWithin={moveWithin}
              disabled={disabled}
            />
          </main>

          <aside className="w-80 shrink-0 border-l border-neutral-200 dark:border-neutral-800">
            <Inspector
              doc={doc}
              node={selected}
              contentTypes={contentTypes}
              disabled={disabled}
              onProps={(props) => selectedId && mutate(setProps(tree, selectedId, props))}
              onBinding={(binding) => selectedId && mutate(setBinding(tree, selectedId, binding))}
              onTokens={(tokens: LayoutTokens) => {
                setDoc((current) => ({ ...current, tokens }));
                setDirty(true);
              }}
              onDelete={() => {
                if (!selectedId) return;
                mutate(removeNode(tree, selectedId));
                setSelectedId(null);
              }}
              onDuplicate={() => selectedId && mutate(duplicateNode(tree, selectedId))}
            />
            {/* Signing lives beside the design, not on a settings page: it is the
                last step of the same job, and the checksum it signs belongs to the
                build of THIS draft. */}
            <PublishPanel
              draftId={draft.id}
              draftKey={draft.key}
              payloadChecksum={dirty ? null : draft.payloadChecksum}
              canPublish={canPublish}
            />
          </aside>
        </div>
      </div>
    </DndContext>
  );
}
