/**
 * Reviewer styles: a single CSS string injected into document.head once
 * (same approach as the left panel). Every selector carries the `dbr-`
 * prefix so the plugin never leaks styles into the host shell.
 *
 * Color tokens follow the DSH light-shell convention used by the left
 * panel (--dsw-alias-* / --brand-color), with light literal fallbacks.
 * Do NOT use --vscode-* variables: the DSH host does not define them, so
 * they resolve to their dark fallback values and make enabled controls
 * look greyed-out/disabled.
 */

const STYLE_ID = 'dsh-devbuddy-reviewer-styles'

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

const CSS = `
.dbr-root, .dbr-root * { box-sizing: border-box; }
.dbr-root {
  height: 100%;
  overflow-y: auto;
  padding: 10px 12px 24px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary, var(--text-primary, rgba(0,0,0,0.88)));
  background: transparent;
}
.dbr-root button {
  font: inherit;
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.18)));
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
}
.dbr-root button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
  border-color: var(--dsw-alias-border-l4, rgba(0,0,0,0.28));
}
.dbr-root button:disabled { opacity: 0.45; cursor: default; }
.dbr-root button.dbr-primary {
  background: var(--brand-color, #3b6fd4);
  border-color: var(--brand-color, #3b6fd4);
  color: #fff;
}
.dbr-root button.dbr-primary:hover {
  background: var(--dsw-alias-brand-primary, #2f5fbd);
  border-color: var(--dsw-alias-brand-primary, #2f5fbd);
  color: #fff;
}
.dbr-root input, .dbr-root select, .dbr-root textarea {
  font: inherit;
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.18)));
  border-radius: 6px;
  padding: 4px 8px;
  width: 100%;
}
.dbr-root input::placeholder, .dbr-root textarea::placeholder {
  color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.35));
}
.dbr-root textarea { resize: vertical; min-height: 56px; }
.dbr-root a { color: var(--dsw-alias-link, var(--brand-color, #3b6fd4)); cursor: pointer; }

.dbr-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.dbr-header h2 { font-size: 13px; margin: 0; flex: 1; font-weight: 600; }
.dbr-project-select { flex: 1; }
.dbr-project-meta { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); font-size: 11px; margin: 2px 0 8px; display: flex; gap: 8px; align-items: center; }

.dbr-quick-actions {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 8px; margin-bottom: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1));
  border-radius: 6px;
  background: var(--dsw-alias-bg-subtle, rgba(0,0,0,0.02));
}
.dbr-quick-actions-title { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); }
.dbr-quick-action-btn { padding: 2px 10px; }
.dbr-quick-actions-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45)); flex-basis: 100%; }

.dbr-critical-banner {
  background: rgba(224,90,79,0.1);
  border: 1px solid rgba(224,90,79,0.5);
  color: #c93f35;
  border-radius: 6px;
  padding: 4px 8px;
  margin-bottom: 8px;
  font-size: 11.5px;
}

.dbr-tabs { display: flex; gap: 2px; margin-bottom: 8px; flex-wrap: wrap; }
.dbr-tabs button { padding: 3px 10px; font-size: 11.5px; }
.dbr-tabs button.dbr-active {
  background: var(--dsw-alias-interactive-bg-active, rgba(59,111,212,0.12));
  color: var(--dsw-alias-link, var(--brand-color, #3b6fd4));
  border-color: var(--brand-color, #3b6fd4);
}

.dbr-list { display: flex; flex-direction: column; gap: 5px; }
/* Document groups (request 14.6): cards stay tight inside a group; a divider
   separates groups and the document name leads each group. */
.dbr-doc-group { display: flex; flex-direction: column; gap: 5px; }
.dbr-doc-group + .dbr-doc-group {
  margin-top: 4px; padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
}
.dbr-doc-group-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 600;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.65));
  padding: 2px 4px; border-radius: 4px; cursor: pointer;
  user-select: none;
}
.dbr-doc-group-head:hover { background: rgba(0,0,0,0.05); }
.dbr-doc-group-head:focus-visible { outline: 2px solid var(--brand-color, #3b6fd4); outline-offset: -2px; }
.dbr-doc-group-name {
  flex: 1 1 auto; min-width: 0;
  color: inherit;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dbr-doc-group-count {
  flex: 0 0 auto; min-width: 16px; padding: 0 4px; border-radius: 8px;
  font-size: 10px; font-weight: 600; line-height: 15px; text-align: center;
  background: rgba(0,0,0,0.06); color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55));
}
.dbr-doc-group-toggle {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; color: inherit;
  transition: transform 0.12s ease;
}
.dbr-doc-group-toggle.dbr-collapsed { transform: rotate(-90deg); }
.dbr-card {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1));
  border-left-width: 3px;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  background: var(--dsw-alias-bg-base, #fff);
}
.dbr-card:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }
.dbr-card-sev-info { border-left-color: #8a8a8a; }
.dbr-card-sev-minor { border-left-color: #2f7fd1; }
.dbr-card-sev-major { border-left-color: #d17f2f; }
.dbr-card-sev-critical { border-left-color: #d63a32; }
.dbr-card-title { font-weight: 600; margin-bottom: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbr-title-num { font-weight: 700; font-style: normal; }
.dbr-detail-id .dbr-title-num { font-size: 12px; }
.dbr-card-loc { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbr-card-row { display: flex; align-items: center; gap: 5px; margin-top: 3px; flex-wrap: wrap; }

.dbr-pill {
  display: inline-flex; align-items: center;
  border-radius: 9px; padding: 0 7px; font-size: 10.5px; line-height: 16px;
  border: 1px solid rgba(0,0,0,0.14); white-space: nowrap;
}
.dbr-sev-info { background: rgba(138,138,138,0.14); color: #6e6e6e; }
.dbr-sev-minor { background: rgba(47,127,209,0.12); color: #2567a8; }
.dbr-sev-major { background: rgba(209,127,47,0.12); color: #a5601f; }
.dbr-sev-critical { background: rgba(214,58,50,0.1); color: #c3342c; }
.dbr-pill.dbr-status { background: rgba(0,0,0,0.05); color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.6)); }
.dbr-pill.dbr-tag { background: transparent; font-style: normal; }
.dbr-pill.dbr-party { background: rgba(47,127,209,0.10); color: #2567a8; font-style: normal; }

.dbr-empty { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.5)); text-align: center; padding: 28px 12px; }
.dbr-empty-hint { font-size: 11.5px; margin-top: 6px; }
.dbr-error { color: #c3342c; font-size: 11.5px; margin: 6px 0; }
.dbr-loading { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.5)); padding: 16px; text-align: center; }

/* detail */
.dbr-crumbs { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.dbr-detail-head { margin-bottom: 8px; }
.dbr-detail-title { font-size: 13.5px; font-weight: 600; margin: 4px 0; }
.dbr-detail-id { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); font-size: 11px; }
.dbr-detail-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); margin: 3px 0; }
.dbr-detail-meta b { color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88)); font-weight: 600; }
.dbr-detail-doc { cursor: pointer; text-decoration: underline; }

.dbr-quote {
  border-left: 3px solid var(--dsw-alias-border-l4, rgba(0,0,0,0.28));
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  padding: 5px 9px; margin: 6px 0; border-radius: 0 4px 4px 0;
  white-space: pre-wrap; word-break: break-word;
  font-family: var(--font-mono, var(--dsw-font-family-mono, monospace)); font-size: 11.5px;
}
.dbr-quote-point { color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); font-style: italic; }
.dbr-anchor-note { border-radius: 6px; padding: 4px 8px; margin: 6px 0; font-size: 11.5px; border: 1px solid; }
.dbr-anchor-valid, .dbr-anchor-moved { border-color: var(--dsw-alias-border-l3, rgba(0,0,0,0.15)); color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); }
.dbr-anchor-modified { border-color: rgba(209,154,47,0.55); background: rgba(209,154,47,0.1); color: #946a14; }
.dbr-anchor-outdated, .dbr-anchor-orphaned { border-color: rgba(214,58,50,0.5); background: rgba(214,58,50,0.07); color: #c3342c; }

.dbr-section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.5)); margin: 10px 0 4px; }
.dbr-prose { white-space: pre-wrap; word-break: break-word; }
.dbr-md { font-size: 12px; }

.dbr-thread { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.dbr-entry { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1)); border-radius: 6px; padding: 5px 8px; }
.dbr-entry-status { background: rgba(0,0,0,0.04); color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); font-size: 11.5px; }
.dbr-entry-decision { border-color: rgba(47,127,209,0.4); background: rgba(47,127,209,0.06); }
.dbr-entry-head { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); margin-bottom: 2px; display: flex; gap: 6px; }
.dbr-entry-body { white-space: pre-wrap; word-break: break-word; }

.dbr-reply-row { display: flex; gap: 6px; margin-top: 8px; align-items: flex-start; }
.dbr-reply-row textarea { flex: 1; }

/* Post-publication editing (GitHub-style): markers, inline edit buttons, forms. */
.dbr-edited-mark { font-size: 10.5px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.45)); text-transform: none; letter-spacing: 0; }
.dbr-edit-btn { margin-left: 8px; font-size: 11px; padding: 0 7px; text-transform: none; letter-spacing: 0; }
.dbr-entry-edit-btn { margin-left: auto; font-size: 11px; padding: 0 7px; opacity: 0; transition: opacity 0.12s; }
.dbr-entry:hover .dbr-entry-edit-btn, .dbr-entry-edit-btn:focus-visible { opacity: 1; }
.dbr-edit-form { display: flex; flex-direction: column; gap: 6px; margin: 4px 0; }
.dbr-edit-form textarea { width: 100%; resize: vertical; }
.dbr-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }

.dbr-actions { display: flex; gap: 5px; flex-wrap: wrap; margin: 10px 0; }
.dbr-remove { color: #c3342c; border-color: rgba(214,58,50,0.5); background: var(--dsw-alias-bg-base, #fff); }
.dbr-remove:hover { background: rgba(214,58,50,0.08); border-color: #d63a32; }

.dbr-dialog-bg {
  position: absolute; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px;
}
.dbr-dialog {
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.15));
  border-radius: 8px; padding: 12px; width: 100%; max-width: 320px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.18);
  display: flex; flex-direction: column; gap: 7px;
}
.dbr-dialog h3 { margin: 0; font-size: 13px; }
.dbr-dialog-row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }

/* composer */
.dbr-composer {
  border: 1px solid var(--brand-color, #3b6fd4);
  border-radius: 8px; padding: 10px;
  background: var(--dsw-alias-bg-base, #fff);
  display: flex; flex-direction: column; gap: 7px; margin-bottom: 10px;
}
.dbr-composer-head { display: flex; align-items: center; gap: 6px; }
.dbr-composer-head strong { flex: 1; font-size: 12.5px; }
.dbr-field { display: flex; flex-direction: column; gap: 3px; }
.dbr-field > label { font-size: 11px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55)); }
.dbr-type-hint {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; margin-left: 4px;
  border-radius: 50%; font-size: 10px; font-weight: 700;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55));
  background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06));
  cursor: help; user-select: none; vertical-align: middle;
}
.dbr-field-row { display: flex; gap: 8px; }
.dbr-field-row .dbr-field { flex: 1; min-width: 0; }

/* 关联方 collapsible multi-select */
.dbr-ms { position: relative; }
.dbr-ms-trigger {
  display: flex; align-items: center; gap: 6px; width: 100%;
  font: inherit; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.18)));
  border-radius: 6px; padding: 4px 8px;
}
.dbr-ms-trigger:disabled { opacity: 0.6; cursor: default; }
.dbr-ms-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbr-ms-value.is-empty { color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.35)); }
.dbr-ms-caret { font-size: 10px; opacity: 0.6; }
.dbr-ms-menu {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.18)));
  border-radius: 6px; padding: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.12);
  max-height: 220px; overflow-y: auto;
}
.dbr-ms-option {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.dbr-ms-option:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); }
.dbr-ms-option input { width: auto; margin: 0; }
.dbr-ms-option.is-auto {
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
  margin-bottom: 4px; padding-bottom: 6px;
}

/* selection bar */
.dbr-selection-bar {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--brand-color, #3b6fd4);
  border-radius: 6px; padding: 5px 9px; margin-bottom: 8px;
  background: rgba(59,111,212,0.08); font-size: 11.5px;
}
.dbr-selection-bar span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* document view */
.dbr-doc { font-family: var(--font-mono, var(--dsw-font-family-mono, monospace)); font-size: 11.5px; }
.dbr-doc-line { display: flex; min-height: 1.45em; }
.dbr-doc-gutter {
  flex: 0 0 auto; min-width: 46px; user-select: none; display: flex;
  align-items: flex-start; justify-content: flex-end; gap: 3px; padding-right: 6px;
  color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4));
}
.dbr-gutter-lineno { min-width: 20px; text-align: right; }
.dbr-gutter-badges { display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
.dbr-doc-code { white-space: pre-wrap; word-break: break-word; flex: 1; }
.dbr-doc-line.dbr-h-heading .dbr-doc-code { font-family: var(--dsw-font-family, sans-serif); font-weight: 600; }
.dbr-gutter-badge {
  border: 1px solid currentColor; border-radius: 8px; background: var(--dsw-alias-bg-base, #fff);
  padding: 0 4px; cursor: pointer; line-height: 14px; font-size: 9.5px; font-weight: 600;
}
.dbr-gutter-badge:hover { background: rgba(0,0,0,0.06); }
.dbr-gutter-badge.dbr-is-terminal { opacity: 0.5; }
/* Anchor drifted (modified/outdated) but the review's status has not moved:
   a quiet "looks stale" marker, never a status change (06 §3). */
.dbr-gutter-badge.dbr-is-drift { box-shadow: 0 0 0 2px rgba(209,127,47,0.45); }
.dbr-drift-chip {
  font-size: 9.5px; padding: 0 4px; border-radius: 6px; flex: 0 0 auto;
  background: rgba(209,127,47,0.14); color: #a4621f;
}
.dbr-num-sev-info { color: #8a8a8a; }
.dbr-num-sev-minor { color: #2f7fd1; }
.dbr-num-sev-major { color: #d17f2f; }
.dbr-num-sev-critical { color: #d63a32; }
.dbr-pop-number { font-size: 10.5px; font-weight: 700; flex: 0 0 auto; }

/* superscript N chips riding the top-right corner of a marked piece */
.dbr-doc mark { position: relative; }
.dbr-inline-nums {
  position: absolute; top: -9px; right: 2px; display: inline-flex; gap: 2px;
  pointer-events: auto;
}
.dbr-inline-num {
  border: none; border-radius: 8px; padding: 0 5px; font-size: 9px; line-height: 13px;
  font-weight: 700; color: #fff; cursor: pointer;
}
.dbr-inline-num.dbr-num-sev-info { background: #7a7a7a; }
.dbr-inline-num.dbr-num-sev-minor { background: #2f7fd1; }
.dbr-inline-num.dbr-num-sev-major { background: #d17f2f; }
.dbr-inline-num.dbr-num-sev-critical { background: #d63a32; }
.dbr-drift-list { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1)); }
/* Severity background tint only — no glyph color change. Each piece carries
   the pipe color used by its 2px "|" edge bars. */
.dbr-doc mark {
  border-radius: 2px; padding: 0 1px; color: inherit;
  background: rgba(47,127,209,0.16);
  --dbr-pipe: #2f7fd1;
  cursor: pointer;
}
.dbr-doc mark.dbr-anchor-sev-info { background: rgba(138,138,138,0.16); --dbr-pipe: #8a8a8a; }
.dbr-doc mark.dbr-anchor-sev-minor { background: rgba(47,127,209,0.16); --dbr-pipe: #2f7fd1; }
.dbr-doc mark.dbr-anchor-sev-major { background: rgba(209,127,47,0.16); --dbr-pipe: #d17f2f; }
.dbr-doc mark.dbr-anchor-sev-critical { background: rgba(214,58,50,0.16); --dbr-pipe: #d63a32; }
.dbr-doc mark.dbr-anchor-modified { background: rgba(209,154,47,0.20); --dbr-pipe: #c98f25; }
.dbr-doc mark.dbr-is-terminal { opacity: 0.55; }
/* Edge bars: inset shadows paint only on the first/last visual line of a
   (possibly soft-wrapped) piece, so they mark the exact text boundaries. */
.dbr-doc mark.dbr-edge-start { box-shadow: inset 2px 0 0 0 var(--dbr-pipe); }
.dbr-doc mark.dbr-edge-end { box-shadow: inset -2px 0 0 0 var(--dbr-pipe); }
/* Zero-length point: a single standalone 2px bar. */
.dbr-doc-point {
  display: inline-block; position: relative;
  width: 2px; height: 1em; line-height: 1;
  vertical-align: text-bottom;
  border-radius: 1px; margin: 0 -1px 0 0;
  cursor: pointer;
}
.dbr-doc-point.dbr-point-sev-info { background: #8a8a8a; }
.dbr-doc-point.dbr-point-sev-minor { background: #2f7fd1; }
.dbr-doc-point.dbr-point-sev-major { background: #d17f2f; }
.dbr-doc-point.dbr-point-sev-critical { background: #d63a32; }
.dbr-doc-point.dbr-anchor-modified { background: #c98f25; }
.dbr-doc-point.dbr-is-terminal { opacity: 0.55; }
/* Chips on a point ride the bar's right edge. */
.dbr-doc-point > .dbr-inline-nums { left: 2px; right: auto; }

.dbr-popover {
  position: absolute; z-index: 40;
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.15));
  border-radius: 8px; padding: 4px; min-width: 180px; max-width: 280px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex; flex-direction: column; gap: 2px;
}
.dbr-popover-item {
  text-align: left;
  background: transparent; border: 1px solid transparent;
  width: 100%; border-radius: 6px; padding: 4px 7px; display: flex; gap: 6px; align-items: center;
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
.dbr-popover-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); border-color: transparent; }
.dbr-popover-item .dbr-pop-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dbr-selection-fab {
  position: absolute; z-index: 40; height: 22px;
  background: var(--brand-color, #3b6fd4); color: #fff;
  border: 1px solid var(--brand-color, #3b6fd4); border-radius: 6px;
  padding: 2px 10px; font-size: 11.5px; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.dbr-selection-fab:hover { background: var(--dsw-alias-brand-primary, #2f5fbd); }

/* agent preview */
.dbr-agent-preview { max-height: 60%; overflow: auto; max-width: 380px; }
.dbr-agent-ctx { font-size: 11.5px; }
.dbr-agent-ctx details { margin: 4px 0; }
.dbr-agent-ctx summary { cursor: pointer; font-weight: 600; }
.dbr-agent-ctx pre {
  white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
  border-radius: 6px; padding: 6px; margin: 4px 0;
  font-family: var(--font-mono, var(--dsw-font-family-mono, monospace)); font-size: 11px;
}
.dbr-agent-flags { display: flex; flex-direction: column; gap: 2px; margin: 4px 0; }
.dbr-toast { font-size: 11.5px; padding: 5px 9px; border-radius: 6px; margin: 6px 0;
  background: rgba(0,0,0,0.06); color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.65)); }
.dbr-toast.dbr-ok { background: rgba(46,139,97,0.12); color: #25724d; }
.dbr-toast.dbr-bad { background: rgba(214,58,50,0.1); color: #c3342c; }
`
