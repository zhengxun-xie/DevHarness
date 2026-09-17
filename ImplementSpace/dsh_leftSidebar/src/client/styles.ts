/**
 * Plugin-scoped styles. Injected once into document.head as a plain
 * stylesheet string (the standalone plugin build has no CSS-module virtual
 * pipeline). All selectors carry the `dbl-` prefix to avoid collisions.
 *
 * Unlike the narrow right-sidebar variant, this body covers the WIDE center
 * column (DOM-level family-panel takeover, see devbuddy-mount.tsx): content
 * is centered with a reading-width column inside an opaque absolute cover.
 */

export const STYLE_ID = 'dsh-devbuddy-left-styles'

const CSS = `
/* --- family-panel center-column takeover -------------------------------------
   Mirrors the task-board / dsh-ssh convention: the injected container is an
   extra child of the shell's center column, shown via an <html> attribute.
   activePanelId never changes, so the conversation and the session right
   sidebar stay mounted underneath. Guards keep the single-occupant column
   from showing two family panels if attributes ever coexist. */
[data-pane='conversation'],
[class*='centerCol'] {
  position: relative;
}
.dbl-panel-view {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 60;
  background: var(--dsw-alias-bg-base, var(--bg-body, #fff));
  color: var(--dsw-alias-label-primary, var(--text-primary, rgba(0,0,0,0.88)));
}
/* Sibling active attrs: dsh-taskboard (official atb board), @linxin666
   task-board and ssh. If any coexists with ours we YIELD the column: the
   sibling's own !important hide-rule covers us, and our rules below stand
   down so the sibling's view can show (fail-safe against missed events). */
html[data-devbuddy-active]:not([data-dsh-atb-active]):not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) .dbl-panel-view {
  display: flex;
  flex-direction: column;
}
html[data-devbuddy-active]:not([data-dsh-atb-active]):not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-devbuddy-view]):not([data-dsh-atb-view]):not([data-dsh-taskboard-view]):not([data-dsh-ssh-view]),
html[data-devbuddy-active]:not([data-dsh-atb-active]):not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-devbuddy-view]):not([data-dsh-atb-view]):not([data-dsh-taskboard-view]):not([data-dsh-ssh-view]) {
  display: none !important;
}
/* Sibling family panels (task board / ssh) mount lazily on their FIRST open:
   their applyActive() creates the container and commits the React tree BEFORE
   setting its own active attribute, while our cover is still active. If their
   container is display:none at that moment, layout-measuring boards (kanban
   columns etc.) mount at zero size and stay blank after they take over.
   Keep their containers LAID OUT but invisible while DevBuddy owns the
   column: visibility:hidden still gives real geometry, never swallows
   pointer events, and our opaque cover hides it anyway. The rule drops the
   instant the sibling becomes active (its own attr set / ours removed). */
html[data-devbuddy-active]:not([data-dsh-atb-active]) [class*='centerCol'] > [data-dsh-atb-view],
html[data-devbuddy-active]:not([data-dsh-taskboard-active]) [class*='centerCol'] > [data-dsh-taskboard-view],
html[data-devbuddy-active]:not([data-dsh-ssh-active]) [class*='centerCol'] > [data-dsh-ssh-view] {
  display: block !important;
  visibility: hidden;
}
.dbl-panel-view > .dbl-root {
  flex: 1 1 auto;
  min-width: 0;
}
/* Keep the frame's NATIVE right-bar drag handle interactive while DevBuddy
   covers the center. The handle (AppFrame div[data-side='rightbar'], an 8px
   col-resize hit strip at the center/rightbar boundary) drives the real
   right-bar width exactly like in the conversation view — the grid re-solves
   and this inset:0 cover follows. It renders at z-index 11 and our cover at
   60 would swallow its center-side half, so lift it above the cover only
   while DevBuddy is active. Scoped by <html> attribute + stable data-side. */
html[data-devbuddy-active] [data-side='rightbar'] {
  z-index: 61;
}
/* Visible boundary line, matching the conversation view where the line is the
   right panel's own border-left (.P3OORG_panel border-l4): our opaque cover at
   z-60 can sub-pixel-overlap that border, so own the same divider on the
   cover's right edge. Harmless when the bar is collapsed (line lands on the
   viewport edge) and naturally scoped to DevBuddy-active. */
html[data-devbuddy-active] .dbl-panel-view {
  border-right: 0.5px solid var(--dsw-alias-border-l4);
}
/* Hover / drag accent on the native hit strip: a 2px brand-coloured guide
   centered on the boundary, shown while hovering or dragging. The strip is
   an empty div, so the line is its ::after and never disturbs pointer
   capture (pointer-events: none). */
html[data-devbuddy-active] [data-side='rightbar']::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--dsw-alias-brand-primary, #5b8def);
  opacity: 0;
  transition: opacity var(--ds-transition-duration-fast, 120ms)
    var(--ds-ease-in-out, ease);
  pointer-events: none;
}
html[data-devbuddy-active] [data-side='rightbar']:hover::after,
html[data-devbuddy-active] [data-side='rightbar'][data-dragging]::after {
  opacity: 1;
}

/* --- injected left-sidebar entry row -----------------------------------------
   Plain-DOM row beside the shell's New Session control; follows the shell's
   nav-row metrics and collapses to an icon-only circle on the 56px rail. */
.dbl-family-entry {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55));
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.dbl-family-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
.dbl-family-entry[data-active] {
  background: var(--dsw-alias-interactive-bg-active, rgba(91,141,239,0.14));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  font-weight: 600;
}
.dbl-family-entry__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
.dbl-family-entry__icon svg {
  display: block;
  width: 18px;
  height: 18px;
}
.dbl-family-entry__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-sidebar-collapsed] .dbl-family-entry {
  justify-content: center;
  padding: 0;
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
  border-radius: 50%;
}
[data-sidebar-collapsed] .dbl-family-entry__label {
  display: none;
}

/* --- panel body ------------------------------------------------------------- */
.dbl-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  color: var(--text-primary, rgba(0,0,0,0.88));
  background: var(--bg-body, transparent);
  font-size: 14px;
}
.dbl-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 24px;
}
.dbl-header-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dbl-header-title { margin: 0; font-size: 16px; font-weight: 650; }
.dbl-header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dbl-header-actions .dbl-btn { display: inline-flex; align-items: center; justify-content: center; padding: 6px 10px; }
.dbl-header-actions .dbl-btn[data-active="true"] {
  border-color: var(--brand-color, #5b8def);
  color: var(--brand-color, #3b6fd4);
}
.dbl-scroll { flex: 1 1 auto; overflow-y: auto; }
/* Full-width work surface (parity with the sidebar file editor/preview,
   which never impose a reading-column cap): cards follow the panel width;
   the side padding alone keeps them off the frame edge. */
.dbl-content {
  width: 100%;
  box-sizing: border-box;
  padding: 20px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* --- browser-style project tab bar (topmost chrome row) -------------------- */
.dbl-tabbar {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 8px 10px 0;
  overflow-x: auto;
  scrollbar-width: thin;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
}
.dbl-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 7px 8px 7px 12px;
  margin-bottom: -1px; /* overlap the bar's bottom border when active */
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.6));
  font-size: 12.5px;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
}
.dbl-tab:hover {
  background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
/* Active tab merges into the content below: content-coloured face, three-sided
   hairline, and the negative bottom margin hides the bar border under it. */
.dbl-tab[data-active='true'] {
  background: var(--dsw-alias-bg-base, #fff);
  border-color: var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  font-weight: 550;
}
.dbl-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbl-tab-x {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  /* Browser affordance: the close glyph reveals on hover, stays put on the
     active tab. */
  opacity: 0;
}
.dbl-tab:hover .dbl-tab-x,
.dbl-tab[data-active='true'] .dbl-tab-x { opacity: 0.55; }
.dbl-tab-x:hover {
  opacity: 1 !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08));
}

.dbl-form {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 10px; padding: 16px;
  background: var(--bg-elevated, transparent);
}
.dbl-field { display: flex; flex-direction: column; gap: 5px; }
.dbl-field label { font-size: 12px; opacity: 0.7; }
.dbl-input {
  width: 100%; box-sizing: border-box;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: var(--input-bg, transparent);
  color: inherit; font: inherit; font-size: 13px;
}
.dbl-actions { display: flex; gap: 8px; justify-content: flex-end; }
.dbl-btn {
  padding: 6px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: transparent; color: inherit;
}
.dbl-btn-primary {
  background: var(--brand-color, #3b6fd4); border-color: var(--brand-color, #3b6fd4);
  color: #fff;
}
.dbl-btn-primary:disabled { opacity: 0.5; cursor: default; }

.dbl-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  flex: 0 0 auto;
}
.dbl-title { margin: 0; font-size: 18px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbl-path { font-size: 12px; opacity: 0.6; word-break: break-all; font-family: var(--font-mono, monospace); }

/* --- project ↔ DSH workspace status bar -------------------------------- */
.dbl-wsbar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px;
  padding: 7px 12px; border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.14));
  background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03));
  font-size: 12.5px;
}
.dbl-wsbar-info { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto; }
.dbl-wsbar-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
  background: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.3));
}
.dbl-wsbar-dot[data-linked="true"] { background: #3aa675; }
.dbl-wsbar-kicker { opacity: 0.55; flex: 0 0 auto; }
.dbl-wsbar-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbl-wsbar-badge {
  flex: 0 0 auto; font-size: 10.5px; line-height: 1; padding: 2px 6px; border-radius: 99px;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.6));
  background: rgba(127,127,127,0.14);
}
.dbl-wsbar-count { opacity: 0.6; font-size: 11.5px; flex: 0 0 auto; }
.dbl-wsbar-unlinked { opacity: 0.65; }
.dbl-wsbar-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; position: relative; }
.dbl-wsbar-new:disabled { opacity: 0.6; }
.dbl-wsbar-menu-wrap { position: relative; }
.dbl-wsbar-scrim {
  position: fixed; inset: 0; border: 0; padding: 0; background: transparent; z-index: 40;
}
.dbl-wsbar-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 41;
  min-width: 280px; max-width: 380px; max-height: 320px; overflow-y: auto;
  border-radius: 10px; padding: 4px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.14));
  background: var(--dsw-alias-bg-overlay, #fff);
  box-shadow: 0 8px 28px rgba(0,0,0,0.16);
  display: flex; flex-direction: column;
}
.dbl-wsbar-item {
  display: flex; flex-direction: column; align-items: stretch; gap: 2px;
  border: 0; background: transparent; color: inherit; text-align: left;
  font: inherit; font-size: 12.5px; padding: 7px 10px; border-radius: 7px; cursor: pointer;
}
.dbl-wsbar-item:hover:not(:disabled),
.dbl-wsbar-item[data-current="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
}
.dbl-wsbar-item:disabled { opacity: 0.5; cursor: default; }
.dbl-wsbar-item-title { font-weight: 600; }
.dbl-wsbar-item-path {
  font-size: 11px; opacity: 0.6; font-family: var(--font-mono, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dbl-wsbar-menu-sep { height: 1px; margin: 4px 6px; background: var(--border-color, rgba(0,0,0,0.12)); }
.dbl-wsbar-menu-empty, .dbl-wsbar-menu-error { padding: 10px; font-size: 12px; opacity: 0.7; }
.dbl-wsbar-menu-error[data-kind="error"] { color: #d4483b; opacity: 1; }
.dbl-wsbar-error { flex-basis: 100%; color: #d4483b; font-size: 12px; }

.dbl-node {
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
  background: var(--bg-elevated, transparent);
}
/* Sticky card header: while a long document scrolls (in preview OR edit),
   the title + collapse + 预览/编辑 + 保存 controls stay pinned at the top
   of the scroll viewport — same role as the sidebar file editor's
   .editorHeader (padding + bottom hairline, outside the scrolled content).
   Negative margins span the card's padding edge; the solid base background
   hides document lines scrolling beneath. Each card's head is constrained by
   its own card, so the next card's header pushes the previous one away. */
.dbl-node-head {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin: -12px -14px 0;
  padding: 8px 14px;
  background: var(--dsw-alias-bg-base, #fff);
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
  border-radius: 10px 10px 0 0;
  cursor: pointer;
}
/* The actions cluster has its own buttons; it must not look/act like the
   collapse target (clicks are stopped there in NodeCard). */
.dbl-node-head .dbl-node-actions { cursor: auto; }
.dbl-node-head:focus-visible { outline: 2px solid var(--dsw-alias-link, #3b6fd4); outline-offset: -2px; border-radius: 10px; }
.dbl-node-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; min-width: 0; }
.dbl-node-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dbl-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.dbl-dot[data-state="missing"] { background: var(--text-tertiary, rgba(0,0,0,0.25)); }
.dbl-dot[data-state="present"] { background: #3aa675; }
.dbl-node-meta { font-size: 11.5px; opacity: 0.6; font-family: var(--font-mono, monospace); font-weight: 400; }
.dbl-node-desc { font-size: 12.5px; opacity: 0.75; }
/* Markdown preview renders frameless directly on the card surface — parity
   with the sidebar file editor's preview (.editorMd: flex 1, transparent,
   no border/background/height cap). It flows with the document and the outer
   .dbl-scroll owns the scrollbar; the primitives' .markdown stylesheet owns
   typography. Only the empty/missing hint face remains. */
.dbl-node-md {
  /* no box, no height cap, no internal scroll — outer panel scrolls */
  position: relative;
}
.dbl-node-md[data-empty="true"] { opacity: 0.55; font-style: italic; }
/* Unsaved-draft banner rendered above the preview. */
.dbl-node-md-note {
  margin: 0 0 8px; font-size: 11.5px; font-style: normal;
  color: #b5791a;
}
/* --- preview/edit chrome, mirroring the sidebar file editor -------------
   Collapse glyph + segmented [预览|编辑] mode switch (always visible, active
   segment highlighted) + dirty dot + discard/save text buttons. */
.dbl-collapse-btn {
  border: none; background: none; padding: 0 2px; cursor: pointer;
  font-size: 13px; line-height: 1; color: inherit; opacity: 0.65;
}
.dbl-collapse-btn:hover { opacity: 1; }
.dbl-mode {
  display: inline-flex; align-items: stretch;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  border-radius: 7px; overflow: hidden;
}
.dbl-mode-btn {
  border: none; background: transparent; color: inherit;
  font: inherit; font-size: 12px; line-height: 1;
  padding: 4px 10px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.6));
}
.dbl-mode-btn + .dbl-mode-btn { border-left: 1px solid var(--border-color, rgba(0,0,0,0.18)); }
.dbl-mode-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); }
.dbl-mode-btn[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(91,141,239,0.14));
  color: var(--dsw-alias-link, var(--brand-color, #3b6fd4));
  font-weight: 600;
  cursor: default;
}
/* Amber dirty marker (same role as the file editor's unsaved dot). */
.dbl-dirty-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto;
  background: #e0a23b;
}
/* --- line-number editor (CodeMirror-style gutter, native textarea) -------
   Borderless, transparent, auto-growing — same surface philosophy as the
   sidebar file editor (.editorCm: flex 1, transparent, no border/box); the
   outer panel scrolls, the editor never does internally. The ink mirror
   MUST share the textarea's font, padding and wrap settings exactly, or
   wrapped-line numbering (and the colored glyph overlay) drifts;
   --dbl-gutter-w is the per-digit-count width from the component. */
.dbl-editor {
  position: relative; display: flex; width: 100%; box-sizing: border-box;
  /* Floor for a fresh/short document: 9 lines (13px × 1.7 ≈ 22.1px ≈ 200px). */
  min-height: 200px; color: inherit;
}
.dbl-editor-gutter {
  position: relative; flex: 0 0 auto; width: var(--dbl-gutter-w, 42px);
  overflow: hidden; user-select: none; cursor: text;
  border-right: 1px solid var(--border-color, rgba(0,0,0,0.10));
  background: transparent;
}
.dbl-editor-ln {
  position: absolute; left: 4px; right: 4px; height: 22.1px;
  display: flex; align-items: center; justify-content: flex-start;
  font-size: 13px; line-height: 1.7;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4));
}
/* Review pills hug the gutter's LEFT edge; the line number is pushed to the
   RIGHT edge (next to the document text). */
.dbl-editor-ln-num { flex: 0 0 auto; margin-left: auto; text-align: right; }
/* Side-by-side review-number pills (design/05 §5.2): one pill PER review
   anchored at the line, showing its document-scoped #N. Outlined capsule
   with a severity-colored border; drifted anchors render hollow/gray. */
.dbl-rv-badges { display: inline-flex; flex: 0 0 auto; gap: 2px; margin-right: 3px; }
.dbl-rv-badge {
  min-width: 16px; height: 15px; padding: 0 2px; margin-top: 1px;
  border: 1px solid currentColor; border-radius: 4px; box-sizing: border-box;
  background: transparent;
  font-size: 9.5px; font-weight: 600; line-height: 13px;
  font-variant-numeric: tabular-nums; text-align: center;
  cursor: pointer;
}
.dbl-rv-badge:hover { background: rgba(0,0,0,0.08); }
.dbl-rv-badge:focus-visible { outline: 2px solid var(--brand-color, #3b6fd4); outline-offset: 1px; }
.dbl-rv-num-info { color: #9a9a9a; }
.dbl-rv-num-minor { color: #4aa3ff; }
.dbl-rv-num-major { color: #f2a65a; }
.dbl-rv-num-critical { color: #f48771; }
/* Moved/modified/outdated/orphaned anchors: hollow neutral capsule. */
.dbl-rv-badge.dbl-rv-drifted { color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45)); }
.dbl-editor-ta,
.dbl-editor-mirror {
  /* Shared metrics — keep these identical across the two surfaces. */
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px; line-height: 1.7; letter-spacing: normal;
  tab-size: 4; white-space: pre-wrap; overflow-wrap: anywhere;
  padding: 0 12px 10px; margin: 0; border: 0; box-sizing: border-box;
}
.dbl-editor-ta {
  flex: 1 1 auto; min-width: 0; display: block;
  background: transparent; color: inherit; outline: none;
  resize: none; overflow: hidden;
  /* Stays the visible/caret/IME layer beneath the ink overlay: glyphs keep
     their normal color so IME composition text is never hidden. */
  position: relative; z-index: 1;
}
/* Metric-identical transparent copy of every line ABOVE the textarea. It
   exists only for measurement (line numbers, range geometry); its glyphs are
   always transparent — review highlights paint entirely on the overlay. */
.dbl-editor-mirror {
  position: absolute; top: 0; bottom: 0; z-index: 2;
  left: var(--dbl-gutter-w, 42px); right: 0;
  color: transparent;
  pointer-events: none;
  overflow: hidden;
}
.dbl-editor-mirror-line { display: block; }
/* Highlight overlay (design/05 §5.2): bottom layer painting background
   tints plus 2px "|" edge bars. Its rects are editor-box-relative
   (rangeRects already include the gutter offset + 12px text padding), so
   this box starts at the editor's left edge — shifting it by the gutter
   width would add the gutter twice and push every highlight right by that
   width. Never intercepts events. */
.dbl-editor-overlay {
  position: absolute; top: 0; bottom: 0; z-index: 0;
  left: 0; right: 0;
  pointer-events: none; overflow: hidden;
}
/* Background-tint overlay only — no glyph color change, no underline.
   Line-level (drifted) anchors tint the whole covered lines without
   rounding. */
.dbl-rv-hl {
  position: absolute; border-radius: 3px;
  box-sizing: border-box;
}
.dbl-rv-hl.dbl-rv-line-level { border-radius: 0; }
/* 2px edge bars ("|") at the selection boundaries; a zero-length point
   anchor renders a single bar. Bar width is fixed; the inline style only
   sets left/top/height. */
.dbl-rv-bar {
  position: absolute;
  box-sizing: border-box;
  width: 2px; border-radius: 1px;
}
.dbl-rv-bar-start { margin-left: -1px; }
.dbl-rv-bar-end { margin-left: -1px; }
.dbl-rv-bar-point { border-radius: 1px; }
/* valid / moved: severity tint + bar; modified: amber; outdated / orphaned:
   neutral line-level blocks only. Glyph colors are NEVER changed. */
.dbl-rv-sev-info { background: rgba(138,138,138,0.14); --dbl-rv-pipe: #8a8a8a; }
.dbl-rv-sev-minor { background: rgba(55,148,255,0.14); --dbl-rv-pipe: #3794ff; }
.dbl-rv-sev-major { background: rgba(224,146,59,0.16); --dbl-rv-pipe: #e0923b; }
.dbl-rv-sev-critical { background: rgba(224,90,79,0.15); --dbl-rv-pipe: #e05a4f; }
.dbl-rv-bar.dbl-rv-sev-info,
.dbl-rv-bar.dbl-rv-sev-minor,
.dbl-rv-bar.dbl-rv-sev-major,
.dbl-rv-bar.dbl-rv-sev-critical { background: var(--dbl-rv-pipe); }
.dbl-rv-anchor-modified {
  background: rgba(209,154,47,0.20);
  --dbl-rv-pipe: #c98f25;
}
.dbl-rv-bar.dbl-rv-anchor-modified { background: #c98f25; }
.dbl-rv-anchor-outdated,
.dbl-rv-anchor-orphaned {
  background: rgba(0,0,0,0.05);
  --dbl-rv-pipe: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45));
}
.dbl-rv-bar.dbl-rv-anchor-outdated,
.dbl-rv-bar.dbl-rv-anchor-orphaned {
  background: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45));
}
/* --- Preview-surface inline marks (design/05 §5.1) -----------------------
   Injected imperatively into the rendered markdown. The mark shows only the
   severity background tint (no glyph color change) with 2px "|" edge bars at
   the interval boundaries (inset shadows, so layout never shifts); a
   zero-length point anchor renders a single standalone bar. The top-right
   corner carries one solid N chip per review. Uncommitted selections are
   never marked. */
.dbl-rv-anchor {
  position: relative; border-radius: 2px; padding: 0 1px;
  cursor: pointer;
}
.dbl-rv-edge-start { box-shadow: inset 2px 0 0 0 var(--dbl-rv-pipe); border-top-left-radius: 2px; border-bottom-left-radius: 2px; }
.dbl-rv-edge-end { box-shadow: inset -2px 0 0 0 var(--dbl-rv-pipe); border-top-right-radius: 2px; border-bottom-right-radius: 2px; }
.dbl-rv-anchor-lost {
  background: rgba(0,0,0,0.05);
  --dbl-rv-pipe: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45));
}
/* Zero-length point: a single 2px bar. Negative right margin cancels the
   bar's width so following glyphs do not shift. */
.dbl-rv-point {
  display: inline-block; position: relative;
  width: 2px; height: 1em; line-height: 1;
  vertical-align: text-bottom;
  border-radius: 1px; margin: 0 -1px 0 0;
  cursor: pointer;
}
.dbl-rv-point-sev-info { background: #8a8a8a; }
.dbl-rv-point-sev-minor { background: #3794ff; }
.dbl-rv-point-sev-major { background: #e0923b; }
.dbl-rv-point-sev-critical { background: #e05a4f; }
.dbl-rv-point.dbl-rv-anchor-modified { background: #c98f25; }
.dbl-rv-point.dbl-rv-anchor-lost {
  background: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45));
}
/* Chips on a point ride the bar's right edge. */
.dbl-rv-point > .dbl-rv-anchor-nums {
  top: -9px; left: 2px; right: auto;
}
.dbl-rv-anchor-nums {
  position: absolute; top: -9px; right: 2px;
  display: inline-flex; gap: 2px; pointer-events: auto;
}
.dbl-rv-anchor-num {
  border: none; border-radius: 8px; padding: 0 5px;
  font-size: 9px; font-weight: 700; line-height: 13px;
  color: #fff; cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.dbl-rv-anchor-num.dbl-rv-num-info { background: #7a7a7a; color: #fff; }
.dbl-rv-anchor-num.dbl-rv-num-minor { background: #2f7fd1; color: #fff; }
.dbl-rv-anchor-num.dbl-rv-num-major { background: #d17f2f; color: #fff; }
.dbl-rv-anchor-num.dbl-rv-num-critical { background: #d63a32; color: #fff; }
/* In-place "add review" bubble above the selection (design/05 §6). */
.dbl-rv-fab {
  position: absolute; z-index: 40;
  display: inline-flex; align-items: stretch;
  height: 24px; border-radius: 5px; overflow: hidden;
  background: #2f2f33; color: #fff;
  box-shadow: 0 2px 10px rgba(0,0,0,0.28);
  font-size: 12px; white-space: nowrap; user-select: none;
}
.dbl-rv-fab-main {
  border: none; background: transparent; color: inherit;
  padding: 0 10px; cursor: pointer; font-size: 12px;
}
.dbl-rv-fab-main:hover { background: rgba(255,255,255,0.12); }
.dbl-rv-fab-x {
  border: none; border-left: 1px solid rgba(255,255,255,0.18);
  background: transparent; color: inherit;
  width: 22px; cursor: pointer; line-height: 1;
}
.dbl-rv-fab-x:hover { background: rgba(255,255,255,0.12); }
.dbl-linkbtn {
  border: none; background: none; padding: 0; cursor: pointer; font-size: 12.5px;
  color: var(--brand-color, #3b6fd4);
}
.dbl-linkbtn:disabled { opacity: 0.5; cursor: default; }
/* Save reads slightly stronger than discard (both stay inline text buttons). */
.dbl-save-btn { font-weight: 600; }
.dbl-status { font-size: 12.5px; }
.dbl-status[data-kind="error"] { color: #d4483b; }
.dbl-status[data-kind="ok"] { color: #3aa675; }
.dbl-empty {
  margin: auto; text-align: center; opacity: 0.7; display: flex;
  flex-direction: column; gap: 12px; align-items: center; padding: 48px;
}
.dbl-loading { margin: auto; opacity: 0.6; font-size: 13px; }
`

let injected = false

/** Inject the stylesheet once per document lifetime (HMR re-runs are safe). */
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) {
    injected = true
    return
  }
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = 'dsh-devbuddy-left'
  tag.textContent = CSS
  document.head.appendChild(tag)
  injected = true
}
