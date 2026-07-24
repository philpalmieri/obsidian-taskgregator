import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// A plugin-generated block id at the end of a task line, e.g. " ^tg1a2b3c".
const TG_BLOCKID_RE = /\s\^(tg[a-z0-9]+)\s*$/i;

/**
 * Live Preview decoration: replace a task's trailing `^tg…` block id with a small
 * clickable note icon (so the raw id never shows). The id stays in the file; it is
 * only hidden visually, and revealed again when the cursor is on that line.
 */
export function noteIconLivePreview(
  hasNote: (blockId: string) => boolean,
  openNote: (blockId: string) => void
) {
  class NoteIconWidget extends WidgetType {
    constructor(readonly blockId: string) {
      super();
    }
    eq(other: NoteIconWidget): boolean {
      return other.blockId === this.blockId;
    }
    toDOM(): HTMLElement {
      const span = createSpan({ cls: "tg-inline-note tg-lp-note", text: "📝" });
      span.setAttribute("aria-label", "Open task note");
      span.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNote(this.blockId);
      };
      return span;
    }
    ignoreEvent(): boolean {
      return false;
    }
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const sel = view.state.selection.main;
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const m = line.text.match(TG_BLOCKID_RE);
            const idx = m ? m.index ?? -1 : -1;
            if (m && idx >= 0 && hasNote(m[1])) {
              // Keep the raw id visible while the cursor is on this line.
              const cursorOnLine = sel.from <= line.to && sel.to >= line.from;
              if (!cursorOnLine) {
                const start = line.from + idx;
                builder.add(start, line.to, Decoration.replace({ widget: new NoteIconWidget(m[1]) }));
              }
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
