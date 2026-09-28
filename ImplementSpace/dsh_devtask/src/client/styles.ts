/**
 * DevTask stylesheet, injected once into document.head and scoped by the
 * `dtk-` prefix (the sibling plugins use `dbl-` / `dvr-`). Plain CSS text
 * rather than a CSS-module pipeline, because the DSH module loader serves a
 * single client.js with no extra assets.
 *
 * The layout follows the DevBuddy family takeover: `[data-devtask-view]` fills
 * the center column and is hidden unless <html> carries `data-devtask-active`.
 *
 * Style parity with DevBuddy is deliberate: this sheet reads the SAME design
 * tokens (`--dsw-alias-*`, `--bg-body`, `--text-primary`, `--border-color`,
 * `--input-bg`, `--brand-color`) and the same metrics (36px nav rows, 24px
 * icon box, 14px panel base type) so the two family panels are visually
 * interchangeable. It must never fall back to a dark palette: a token miss
 * has to degrade to the light shell values, not to a black surface.
 */

/** `!` marks a declaration the shell would otherwise win on specificity. */
const CSS = `
[data-devtask-view] { display: none; }
html[data-devtask-active] [data-devtask-view] {
  display: flex; flex-direction: column;
  position: absolute; inset: 0; z-index: 5;
  background: var(--dsw-alias-bg-base, var(--bg-body, #fff));
  color: var(--dsw-alias-label-primary, var(--text-primary, rgba(0,0,0,0.88)));
  font-size: 14px;
}
html[data-devtask-active] [data-pane="conversation"] > :not([data-devtask-view]),
html[data-devtask-active] [class*="centerCol"] > :not([data-devtask-view]) { visibility: hidden !important; }

/* Family sidebar entry row (plain DOM, shares the shell's nav look). Same
   metrics as DevBuddy's row so the two labels sit on one optical line: a
   fixed 36px row, zero vertical padding (centring comes from the height),
   and a 24px icon box holding an 18px glyph. */
.dtk-family-entry {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.55));
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}
.dtk-family-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
.dtk-family-entry[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(91,141,239,0.14));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  font-weight: 600;
}
.dtk-family-entry__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
.dtk-family-entry__icon svg { display: block; width: 18px; height: 18px; }
.dtk-family-entry__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-sidebar-collapsed] .dtk-family-entry {
  justify-content: center;
  padding: 0;
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
  border-radius: 50%;
}
[data-sidebar-collapsed] .dtk-family-entry__label { display: none; }

/* Panel shell */
.dtk-root {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  box-sizing: border-box;
  color: var(--text-primary, rgba(0,0,0,0.88));
  background: var(--bg-body, transparent);
  font-size: 14px;
}
.dtk-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px; border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  flex: none;
}
.dtk-header-title { margin: 0; font-size: 16px; font-weight: 650; }
.dtk-header-sub { margin: 2px 0 0; font-size: 12px; opacity: .6; }
.dtk-header-actions { display: flex; align-items: center; gap: 8px; }

.dtk-btn {
  padding: 6px 16px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: transparent; color: inherit; font: inherit; font-size: 13px;
}
.dtk-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); }
.dtk-btn:disabled { opacity: .5; cursor: default; }
.dtk-btn-primary {
  background: var(--brand-color, #3b6fd4); border-color: var(--brand-color, #3b6fd4); color: #fff;
}
.dtk-btn-primary:hover:not(:disabled) { background: var(--brand-color, #3b6fd4); filter: brightness(1.06); }
.dtk-linkbtn {
  background: none; border: 0; padding: 0; color: var(--brand-color, #3b6fd4);
  font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline;
}

/* Browser-style view tab strip (DevBuddy's project tab bar metrics). */
.dtk-tabbar {
  display: flex; align-items: flex-end; gap: 2px; padding: 8px 14px 0;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  overflow-x: auto; scrollbar-width: thin; flex: none;
}
.dtk-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 8px 7px 12px; margin-bottom: -1px;
  background: transparent; border: 1px solid transparent; border-bottom: none;
  border-radius: 10px 10px 0 0;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.6));
  font: inherit; font-size: 12.5px; line-height: 1.4; cursor: pointer; white-space: nowrap;
}
.dtk-tab:hover {
  background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
.dtk-tab[data-active="true"] {
  background: var(--dsw-alias-bg-base, #fff);
  border-color: var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
  font-weight: 550;
}
.dtk-tab-employee { font-size: 11px; opacity: .6; }
.dtk-tab-x {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: none; border-radius: 50%;
  background: transparent; color: inherit; font-size: 13px; line-height: 1;
  opacity: 0; padding: 0; cursor: pointer;
}
.dtk-tab:hover .dtk-tab-x,
.dtk-tab[data-active="true"] .dtk-tab-x { opacity: .55; }
.dtk-tab-x:hover { opacity: 1 !important; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08)); }
.dtk-tab-add {
  padding: 7px 10px; background: transparent; border: 0; color: inherit;
  font: inherit; font-size: 12.5px; cursor: pointer; opacity: .75; white-space: nowrap;
}
.dtk-tab-add:hover { opacity: 1; }

/* Board */
.dtk-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }

/* 图表配置栏（周期 + 图表类型） */
.dtk-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 10px 24px; flex: 0 0 auto;
  border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff));
}
.dtk-toolbar-group { display: flex; align-items: center; gap: 8px; }
.dtk-toolbar-right { margin-left: auto; }
.dtk-seg-group {
  display: inline-flex; border-radius: 7px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.12)));
}
.dtk-seg {
  appearance: none; border: 0; background: transparent; color: inherit;
  font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer;
  white-space: nowrap; opacity: .7;
}
.dtk-seg + .dtk-seg { border-left: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.12))); }
.dtk-seg:hover { opacity: 1; }
.dtk-seg[data-active="true"] {
  background: var(--brand-color, #3b6fd4); color: #fff; opacity: 1;
}

/* 自定义周期日期选择器 */
.dtk-date-range { display: flex; align-items: center; gap: 6px; }
.dtk-date-field { display: flex; align-items: center; gap: 4px; }
.dtk-date-label { font-size: 11px; opacity: .55; white-space: nowrap; }
.dtk-date-input {
  font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.15)));
  background: var(--dsw-alias-bg-base, var(--bg-body, #fff)); color: inherit;
}
.dtk-date-input:focus { outline: none; border-color: var(--brand-color, #3b6fd4); }
.dtk-date-sep { opacity: .4; font-size: 12px; }

/* 空视图占位（OKR / 甘特图无数据时） */
.dtk-view-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; min-height: 300px; font-size: 13px; opacity: .5;
}
.dtk-view-placeholder-icon { font-size: 32px; opacity: .6; }
.dtk-view-placeholder-hint { font-size: 12px; opacity: .75; }

/* 甘特图视图：左侧固定任务列 + 右侧百分比定位时间轨（无横向滚动）。
   刻度线/今日线画在一层通高 overlay 上（left 偏移避开任务列），
   行内容 z-index 抬到其上。状态色与看板 dtk-status-dot 共用色板。 */
.dtk-gantt { --dtk-gantt-label-w: 320px; position: relative; font-size: 12.5px; padding-bottom: 12px; }
.dtk-gantt-headrow, .dtk-gantt-row { display: grid; grid-template-columns: var(--dtk-gantt-label-w) 1fr; }
.dtk-gantt-headrow {
  position: relative; z-index: 1; height: 30px;
  border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff));
}
.dtk-gantt-headlabel { font-size: 12px; font-weight: 600; opacity: .65; }
.dtk-gantt-rows { position: relative; }
.dtk-gantt-row { position: relative; z-index: 1; min-height: 30px; }
.dtk-gantt-row:hover { background: var(--dsw-alias-border-l3, rgba(0,0,0,0.04)); }
.dtk-gantt-labelcell {
  display: flex; align-items: center; gap: 7px; min-width: 0; padding: 4px 10px;
  border-right: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
}
.dtk-gantt-row[data-depth="1"] .dtk-gantt-labelcell { padding-left: 24px; }
.dtk-gantt-title {
  appearance: none; border: 0; background: transparent; color: inherit;
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; padding: 0; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dtk-gantt-title:hover { text-decoration: underline; }
.dtk-gantt-rowmeta { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
.dtk-gantt-owner { font-size: 11px; opacity: .7; white-space: nowrap; }
.dtk-gantt-dates { font-size: 11px; opacity: .55; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dtk-gantt-trackcell { position: relative; }
.dtk-gantt-bar {
  position: absolute; top: 50%; transform: translateY(-50%);
  height: 16px; min-width: 3px; border-radius: 4px; overflow: hidden;
  background: rgba(76,141,255,.22);
}
.dtk-gantt-barfill { display: block; height: 100%; background: #4c8dff; opacity: .85; }
.dtk-gantt-bar[data-status="backlog"] { background: rgba(138,138,146,.22); }
.dtk-gantt-bar[data-status="todo"] { background: rgba(76,141,255,.22); }
.dtk-gantt-bar[data-status="running"] { background: rgba(240,168,60,.22); }
.dtk-gantt-bar[data-status="done"] { background: rgba(56,178,106,.22); }
.dtk-gantt-bar[data-status="failed"] { background: rgba(229,84,75,.22); }
.dtk-gantt-bar[data-status="backlog"] .dtk-gantt-barfill { background: #8a8a92; }
.dtk-gantt-bar[data-status="todo"] .dtk-gantt-barfill { background: #4c8dff; }
.dtk-gantt-bar[data-status="running"] .dtk-gantt-barfill { background: #f0a83c; }
.dtk-gantt-bar[data-status="done"] .dtk-gantt-barfill { background: #38b26a; }
.dtk-gantt-bar[data-status="failed"] .dtk-gantt-barfill { background: #e5544b; }
.dtk-gantt-nobar { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 11px; opacity: .3; }
.dtk-gantt-sectionrow {
  position: relative; z-index: 1;
  padding: 6px 12px; font-size: 11px; font-weight: 600; opacity: .55;
  border-top: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff));
}
.dtk-gantt-overlay {
  position: absolute; top: 0; bottom: 0; left: var(--dtk-gantt-label-w); right: 0;
  pointer-events: none; z-index: 0;
}
.dtk-gantt-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--dsw-alias-border-l3, rgba(0,0,0,0.07)); }
.dtk-gantt-ticklabel {
  position: absolute; top: 7px; left: 0; transform: translateX(-50%);
  font-size: 10.5px; opacity: .5; white-space: nowrap;
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff)); padding: 0 3px;
}
.dtk-gantt-tick[data-edge="first"] .dtk-gantt-ticklabel { transform: none; }
.dtk-gantt-tick[data-edge="last"] .dtk-gantt-ticklabel { transform: translateX(-100%); }
.dtk-gantt-today { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--brand-color, #3b6fd4); }
.dtk-gantt-todaylabel {
  position: absolute; top: 4px; left: 0; transform: translateX(-50%);
  font-size: 10px; color: #fff; background: var(--brand-color, #3b6fd4);
  border-radius: 6px; padding: 0 5px; white-space: nowrap;
}

/* 活动事件视图：竖向时间线（glyph 圆点 + 行内容），按本地日期分组。
   glyph 坐在竖线上（list 左缘画 border，事件 padding-left 让位）。
   创建=加号/绿，更新=铅笔/蓝。 */
.dtk-activity { display: flex; flex-direction: column; padding: 0 24px 16px; font-size: 12.5px; }
.dtk-activity-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 0; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
}
.dtk-activity-count { font-size: 12px; opacity: .6; font-variant-numeric: tabular-nums; }
.dtk-activity-day { display: flex; flex-direction: column; }
.dtk-activity-daylabel { margin: 0; padding: 8px 0 2px; }
.dtk-activity-daytoggle {
  appearance: none; border: 0; background: transparent; color: inherit;
  display: flex; align-items: baseline; gap: 6px; width: 100%; text-align: left;
  margin-left: -6px; padding: 4px 6px; border-radius: 6px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 650; opacity: .6;
}
.dtk-activity-daytoggle:hover { opacity: .9; background: var(--dsw-alias-bg-layer-2, var(--bg-body, rgba(0,0,0,.03))); }
.dtk-activity-daytoggle:focus-visible { outline: 2px solid var(--brand-color, #3b6fd4); outline-offset: 1px; }
.dtk-activity-caret { flex: none; font-size: 10px; }
.dtk-activity-daycount { font-weight: 500; opacity: .75; font-variant-numeric: tabular-nums; }
.dtk-activity-day[data-collapsed="true"] { padding-bottom: 4px; }
.dtk-activity-day[data-collapsed="true"] .dtk-activity-daytoggle { opacity: .75; }
.dtk-activity-hint { margin: 0 0 8px; padding: 0 2px; font-size: 11px; opacity: .6; }
.dtk-activity-list { list-style: none; margin: 0; padding: 2px 0 6px; position: relative; }
.dtk-activity-list::before {
  content: ''; position: absolute; top: 6px; bottom: 10px; left: 10px; width: 1px;
  background: var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
}
.dtk-activity-event {
  position: relative; display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 0 9px;
}
.dtk-activity-glyph {
  flex: none; display: flex; align-items: center; justify-content: center;
  width: 21px; height: 21px; border-radius: 50%; z-index: 1;
  font-size: 11px; line-height: 1; color: #fff; background: #8a8a92;
}
.dtk-activity-event[data-type="create"] .dtk-activity-glyph { background: #38b26a; }
.dtk-activity-event[data-type="update"] .dtk-activity-glyph { background: #4c8dff; }
.dtk-activity-body { min-width: 0; flex: 1; }
.dtk-activity-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0; }
.dtk-activity-operator { font-weight: 650; flex: none; }
.dtk-activity-action { opacity: .75; }
.dtk-activity-task {
  appearance: none; border: 0; background: transparent; color: inherit; padding: 0;
  font: inherit; font-size: 12.5px; color: var(--brand-color, #3b6fd4);
  cursor: pointer; text-align: left; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dtk-activity-task:hover { text-decoration: underline; }
.dtk-activity-task-dead { cursor: default; opacity: .85; }
.dtk-activity-task-dead:hover { text-decoration: none; }
.dtk-activity-time { margin-left: auto; flex: none; font-size: 11.5px; opacity: .5; white-space: nowrap; }
.dtk-activity-diffs {
  list-style: none; margin: 6px 0 0; padding: 6px 10px;
  border-radius: 8px; display: flex; flex-direction: column; gap: 3px;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  font-size: 12px;
}
.dtk-activity-diff { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.dtk-activity-difffield { flex: none; opacity: .55; width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtk-activity-diffold { opacity: .5; text-decoration: line-through; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.dtk-activity-diffarrow { opacity: .4; flex: none; }
.dtk-activity-diffnew { font-weight: 600; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtk-activity-more { display: flex; justify-content: center; padding: 8px 0 12px; }
.dtk-activity-moretext { font-size: 12px; opacity: .45; }

/* OKR 项目视图：🎯目标(O) → 📈KR → 📋任务 → 模块子任务 四层树 */
.dtk-okr-view { display: flex; flex-direction: column; gap: 8px; padding: 14px 24px; }
.dtk-okr-node {
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  border-radius: 10px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
}
.dtk-okr-node.dtk-okr-objective { background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.06)); }
.dtk-okr-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px; }
.dtk-okr-objrow { padding: 10px 12px; }
.dtk-okr-krrow { padding-left: 24px; }
.dtk-okr-taskrow { padding-left: 48px; position: relative; }
/* 有子任务的任务行：整行可点击展开/收起 */
.dtk-okr-taskrow[data-expandable="true"] { cursor: pointer; }
.dtk-okr-row:hover { background: var(--dsw-alias-border-l3, rgba(0,0,0,0.04)); }
.dtk-okr-toggle {
  appearance: none; border: 0; background: transparent; color: inherit;
  padding: 0; cursor: pointer; line-height: 1; display: flex; align-items: center;
}
.dtk-okr-caret { font-size: 10px; opacity: .6; width: 12px; text-align: center; }
/* 无子任务的任务行用等宽占位，保证标题列对齐 */
.dtk-okr-caret-spacer { width: 12px; flex: none; }
.dtk-okr-row-title {
  appearance: none; border: 0; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer; padding: 0; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dtk-okr-objrow .dtk-okr-row-title { font-size: 14px; font-weight: 700; }
.dtk-okr-krrow .dtk-okr-row-title { font-size: 12.5px; font-weight: 600; }
.dtk-okr-taskrow .dtk-okr-row-title { font-size: 12.5px; }
.dtk-okr-row-title:hover { text-decoration: underline; }
.dtk-okr-static-title { cursor: default; }
.dtk-okr-static-title:hover { text-decoration: none; }
.dtk-okr-row-meta { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }
.dtk-okr-owners { font-size: 11.5px; opacity: .75; white-space: nowrap; }
.dtk-okr-owner { font-size: 11.5px; opacity: .75; white-space: nowrap; }
.dtk-okr-due { font-size: 11.5px; opacity: .55; font-variant-numeric: tabular-nums; }
.dtk-okr-count { font-size: 11.5px; opacity: .65; font-variant-numeric: tabular-nums; }
.dtk-okr-badge {
  font-size: 11px; opacity: .7; padding: 1px 7px; border-radius: 8px;
  background: var(--dsw-alias-border-l3, rgba(0,0,0,0.08)); white-space: nowrap;
}
.dtk-okr-progress { display: flex; align-items: center; gap: 6px; flex: none; width: 120px; }
.dtk-okr-progress-track {
  flex: 1 1 auto; height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--dsw-alias-border-l3, rgba(0,0,0,0.12));
}
.dtk-okr-progress-fill {
  display: block; height: 100%; border-radius: 2px;
  background: var(--brand-color, #3b6fd4);
}
.dtk-okr-progress-fill[data-done="true"] { background: #38b26a; }
.dtk-okr-progress-text { font-size: 11px; opacity: .65; width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
.dtk-okr-children { list-style: none; margin: 0; padding: 0 0 4px 0; }
.dtk-okr-task { display: block; }
/* 模块子任务行（TaskRow depth ≥ 1）：缩进由行内 paddingLeft 按深度递增
   （基准 96px，每深一级 +20px），这里只管密度与字号。 */
.dtk-okr-subtask { padding: 4px 12px; font-size: 12px; opacity: .92; }
.dtk-okr-subtask:hover { background: var(--dsw-alias-border-l3, rgba(0,0,0,0.04)); }
.dtk-okr-subtask .dtk-okr-row-title { font-size: 12px; }
/* 任务/子任务「＋ 添加子任务」：绝对定位钉在树最左列，与 O 行折叠箭头
   （▸，.dtk-okr-objrow 内容起点 12px、字形中心 ≈18px）对齐——任务行与
   各级子任务行共用同一坐标系（各级容器无左内边距），全部 ＋ 因此排成
   一列；脱离文档流，不挤占行内折叠箭头/标题的位置 */
.dtk-okr-add {
  appearance: none; border: 0; background: transparent; color: inherit;
  position: absolute; left: 5px; top: 50%; transform: translateY(-50%);
  padding: 0 6px; cursor: pointer;
  font-size: 14px; font-weight: 600; line-height: 1; opacity: .45; border-radius: 6px;
}
.dtk-okr-add:hover { opacity: 1; background: var(--dsw-alias-border-l3, rgba(0,0,0,0.08)); }
.dtk-okr-empty { font-size: 12px; opacity: .45; padding: 6px 12px 6px 48px; list-style: none; }

.dtk-board {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 24px; min-height: 100%; box-sizing: border-box;
}
.dtk-column {
  display: flex; flex-direction: column; gap: 8px;
  flex: 1 1 0; min-width: 190px;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.1)));
  border-radius: 10px; padding: 10px;
}
.dtk-column[data-drop="true"] { border-color: var(--brand-color, #3b6fd4); }
.dtk-column-head { display: flex; align-items: center; gap: 6px; padding-bottom: 4px; }
.dtk-column-title { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: .02em; }
.dtk-column-count { font-size: 11px; opacity: .55; margin-left: auto; }
.dtk-status-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #8a8a92; }
.dtk-status-dot[data-status="backlog"] { background: #8a8a92; }
.dtk-status-dot[data-status="todo"] { background: #4c8dff; }
.dtk-status-dot[data-status="running"] { background: #f0a83c; }
.dtk-status-dot[data-status="done"] { background: #38b26a; }
.dtk-status-dot[data-status="failed"] { background: #e5544b; }
.dtk-column-body { display: flex; flex-direction: column; gap: 8px; min-height: 30px; }
.dtk-column-empty { font-size: 12px; opacity: .45; padding: 6px 2px; }
.dtk-subtask { margin-left: 20px; border-left: 2px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.12))); padding-left: 8px; }

/* Task card */
.dtk-card {
  display: flex; flex-direction: column; gap: 5px; width: 100%; text-align: left;
  padding: 9px 10px; border-radius: 8px; cursor: grab;
  border: 1px solid var(--dsw-alias-border-l3, var(--border-color, rgba(0,0,0,0.12)));
  background: var(--dsw-alias-bg-base, var(--bg-body, #fff)); color: inherit; font: inherit;
}
.dtk-card:hover { border-color: var(--brand-color, #3b6fd4); }
.dtk-card-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
.dtk-card-desc {
  font-size: 12px; opacity: .65; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.dtk-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dtk-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.dtk-card-tag {
  font-size: 11px; padding: 1px 6px; border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.06)); white-space: nowrap;
}
.dtk-prio {
  font-size: 11px; padding: 1px 6px; border-radius: 9px;
  border: 1px solid currentColor; white-space: nowrap;
}
.dtk-prio[data-priority="low"] { color: #8a8a92; }
.dtk-prio[data-priority="medium"] { color: #3b6fd4; }
.dtk-prio[data-priority="high"] { color: #c07d1a; }
.dtk-prio[data-priority="urgent"] { color: #d4483b; }
.dtk-card-time { font-size: 11px; opacity: .5; margin-left: auto; }

/* Inline create form — the 新增视图 flow, styled like DevBuddy's 新增项目 form:
   a card in the flow, never a modal overlay. It sits in the panel's UPPER
   area, between the header and the tab strip, so it reads as the chrome that
   adds a tab rather than as board content. */
.dtk-form-area { flex: none; padding: 0 24px 12px; }
.dtk-form {
  display: flex; flex-direction: column; gap: 10px;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 10px; padding: 16px;
  background: var(--bg-elevated, transparent);
  flex: none;
}
.dtk-form-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.dtk-form-title { margin: 0; font-size: 15px; font-weight: 650; }
.dtk-form-hint { font-size: 12px; opacity: .6; }
.dtk-form-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* Dialogs (task create / edit only) */
.dtk-scrim {
  position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center;
}
.dtk-dialog {
  width: min(420px, calc(100vw - 40px)); max-height: calc(100vh - 80px); overflow: auto;
  background: var(--dsw-alias-bg-overlay, var(--bg-body, #fff));
  color: var(--dsw-alias-label-primary, var(--text-primary, rgba(0,0,0,0.88)));
  border: 1px solid var(--border-color, rgba(0,0,0,0.14));
  border-radius: 10px; padding: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.18);
}
.dtk-dialog-title { margin: 0 0 12px; font-size: 15px; font-weight: 650; }
.dtk-dialog-sub { margin: -8px 0 12px; font-size: 12px; opacity: .6; }
.dtk-dialog-sub-strong { font-weight: 650; opacity: .85; }
/* 弹窗内双列字段栅格（添加子任务：状态/负责人/日期/进度） */
.dtk-dialog-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; }
.dtk-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.dtk-label { font-size: 12px; opacity: .7; }
.dtk-input, .dtk-select, .dtk-textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: var(--input-bg, transparent);
  color: inherit; font: inherit; font-size: 13px;
}
.dtk-textarea { min-height: 64px; resize: vertical; }
.dtk-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dtk-error { color: #d4483b; font-size: 12px; margin-top: 6px; }
.dtk-status {
  margin: 12px 24px; padding: 10px 12px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
}
.dtk-status[data-kind="error"] { border-color: #d4483b; color: #d4483b; }

/* 后台刷新指示（快照秒开渲染期间，header 操作区的小字）。 */
.dtk-refreshing { font-size: 12px; opacity: .6; }

/* Agent 视图：registry 本地花名册——工具栏 + 内联创建表单 + 卡片网格。
   状态徽标底色由组件内联给出（AGENT_STATUS_COLORS），卡片 data-status
   供左边条/悬浮态做轻微着色。 */
.dtk-agent { font-size: 13px; padding-bottom: 12px; }
.dtk-agent-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dtk-agent-count { font-size: 12px; opacity: .6; }
.dtk-agent-form { display: flex; flex-direction: column; gap: 8px; max-width: 560px; margin-bottom: 14px; }
.dtk-agent-desc { min-height: 52px; resize: vertical; }
.dtk-agent-form-actions { display: flex; justify-content: flex-end; }
.dtk-agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.dtk-agent-card {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 10px; padding: 12px 14px;
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff));
}
.dtk-agent-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dtk-agent-name { margin: 0; font-size: 14px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtk-agent-pill { flex: none; border-radius: 999px; padding: 2px 10px; font-size: 11px; color: #fff; }
.dtk-agent-card-desc { margin: 0; flex: 1; font-size: 12px; opacity: .7; white-space: pre-wrap; }
.dtk-agent-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dtk-agent-created { font-size: 11px; opacity: .5; }
.dtk-agent-status-select { width: auto; padding: 4px 6px; font-size: 12px; }
.dtk-agent-delete { margin-left: auto; }

/* 任务日志板块（design/06 §3）：占插件界面下半部分的条件渲染面板，
   .dtk-scroll 的兄弟节点。外层 flex:none + max-height:55%（面板本体
   overflow:hidden 不滚动），内层 body 承接全部纵向滚动，避免双层滚动。 */
.dtk-logpanel {
  flex: none; max-height: 55%; min-height: 180px;
  display: flex; flex-direction: column; overflow: hidden;
  border-top: 1px solid var(--border-color, rgba(0,0,0,0.14));
  background: var(--dsw-alias-bg-layer-1, var(--bg-body, #fff));
}
.dtk-logpanel-head {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
  background: var(--dsw-alias-bg-layer-2, var(--bg-elevated, rgba(0,0,0,0.02)));
}
.dtk-logpanel-kind {
  flex: none; border-radius: 999px; padding: 2px 8px;
  font-size: 11px; color: #fff; background: rgba(0,0,0,0.38);
}
.dtk-logpanel-kind[data-kind="objective"] { background: #7a5af8; }
.dtk-logpanel-kind[data-kind="kr"] { background: #2f7df6; }
.dtk-logpanel-kind[data-kind="task"] { background: #0a8f5b; }
.dtk-logpanel-kind[data-kind="subtask"] { background: #6b7f0c; }
.dtk-logpanel-title {
  margin: 0; min-width: 0; flex: 1; font-size: 13px; font-weight: 650;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dtk-logpanel-deleted {
  flex: none; border-radius: 4px; padding: 1px 6px; font-size: 11px;
  color: #d4483b; border: 1px solid currentColor; opacity: .85;
}
.dtk-logpanel-meta { flex: none; font-size: 12px; opacity: .55; }
.dtk-logpanel-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.dtk-logpanel-close {
  border: none; background: transparent; cursor: pointer;
  padding: 2px 6px; font-size: 14px; line-height: 1.2; border-radius: 4px;
  color: inherit; opacity: .6;
}
.dtk-logpanel-close:hover { opacity: 1; background: rgba(0,0,0,0.06); }
.dtk-logpanel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; }
.dtk-logpanel-hint { margin: 4px 0 8px; font-size: 12px; opacity: .55; }
.dtk-logpanel-hint[data-kind="warn"] { opacity: .8; color: #b8860b; }

/* 时间线：manual / system 两类条目以圆点区分，最新在上。 */
.dtk-log-list { list-style: none; margin: 0; padding: 0; }
.dtk-log-entry { padding: 6px 0 8px 14px; position: relative; font-size: 13px; }
.dtk-log-entry + .dtk-log-entry { border-top: 1px dashed var(--border-color, rgba(0,0,0,0.08)); }
.dtk-log-entry-dot {
  position: absolute; left: 1px; top: 12px; width: 7px; height: 7px;
  border-radius: 999px; background: rgba(0,0,0,0.3);
}
.dtk-log-entry[data-kind="system"] .dtk-log-entry-dot { background: rgba(0,0,0,0.18); }
.dtk-log-entry[data-kind="manual"] .dtk-log-entry-dot { background: #0a8f5b; }
.dtk-log-entry-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 12px; }
.dtk-log-entry-time { opacity: .55; }
.dtk-log-entry-author { opacity: .75; }
.dtk-log-entry-edited { opacity: .5; font-size: 11px; }
.dtk-log-entry[data-kind="system"] .dtk-log-entry-body { opacity: .65; }
.dtk-log-entry-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }

/* composer（06 §4）：默认收起为单行虚线入口，展开为多行 Markdown + 署名 + 发布。 */
.dtk-log-composer { margin: 2px 0 10px; }
.dtk-log-composer-collapsed {
  display: block; width: 100%; box-sizing: border-box; text-align: left;
  padding: 7px 10px; border-radius: 8px; font: inherit; font-size: 13px;
  color: inherit; opacity: .7; cursor: pointer;
  border: 1px dashed var(--border-color, rgba(0,0,0,0.25));
  background: var(--input-bg, transparent);
}
.dtk-log-composer-collapsed:hover { opacity: 1; }
.dtk-log-composer-area {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: var(--input-bg, transparent); color: inherit; font: inherit;
  font-size: 13px; line-height: 1.55; resize: vertical; min-height: 72px;
}
.dtk-log-composer-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.dtk-log-composer-author { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; font-size: 12px; opacity: .75; }
.dtk-log-composer-author select {
  max-width: 140px; padding: 3px 6px; border-radius: 6px; font: inherit; font-size: 12px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: var(--input-bg, transparent); color: inherit;
}

/* manual 条目的作者操作（编辑/删除）与行内编辑态。 */
.dtk-log-entry-actions { display: flex; gap: 2px; margin-left: auto; }
.dtk-log-entry-actions .dtk-linkbtn { padding: 0 4px; font-size: 12px; opacity: .55; }
.dtk-log-entry-actions .dtk-linkbtn:hover:not(:disabled) { opacity: 1; }
.dtk-log-entry-actions .dtk-linkbtn:disabled { opacity: .3; cursor: default; }
.dtk-log-entry-editor { display: flex; flex-direction: column; gap: 6px; }
.dtk-log-entry-editarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  background: var(--input-bg, transparent); color: inherit; font: inherit;
  font-size: 13px; line-height: 1.55; resize: vertical;
}
.dtk-log-entry-editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dtk-log-entry-error { margin: 0; color: #d4483b; font-size: 12px; }

/* 文档引用选择器（06 §8.2）：内嵌两步面板，复用 devreviewer API。 */
.dtk-log-composer-refrow { display: flex; gap: 6px; margin-bottom: 4px; }
.dtk-log-composer-refrow .dtk-linkbtn { font-size: 12px; opacity: .75; }
.dtk-log-composer-refrow .dtk-linkbtn:hover:not(:disabled) { opacity: 1; }
.dtk-refpicker {
  border: 1px solid var(--border-color, rgba(0,0,0,0.18));
  border-radius: 6px; background: var(--dsw-alias-bg-base, #fff);
  margin-top: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.dtk-refpicker-head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
}
.dtk-refpicker-head strong { flex: 1; font-size: 11.5px; }
.dtk-refpicker-head button {
  border: none; background: transparent; font-size: 16px;
  cursor: pointer; color: var(--dsw-alias-label-secondary, rgba(0,0,0,0.5));
  line-height: 1; padding: 0;
}
.dtk-refpicker-body { padding: 4px; max-height: 240px; overflow-y: auto; }
.dtk-refpicker-list { display: flex; flex-direction: column; gap: 2px; }
.dtk-refpicker-tree { display: flex; flex-direction: column; gap: 1px; }
.dtk-refpicker-dir {
  display: flex; align-items: center; gap: 6px;
  text-align: left; width: 100%; padding: 4px 6px; border-radius: 4px;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  font-size: 11.5px; font-weight: 600;
  color: var(--dsw-alias-label-primary, rgba(0,0,0,0.85));
}
.dtk-refpicker-dir:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); }
.dtk-refpicker-arrow { flex-shrink: 0; font-size: 10px; width: 12px; color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45)); }
.dtk-refpicker-children { padding-left: 14px; display: flex; flex-direction: column; gap: 1px; }
.dtk-refpicker-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4)); padding: 6px; }
.dtk-refpicker-item {
  display: flex; align-items: center; gap: 6px;
  text-align: left; width: 100%; padding: 4px 6px; border-radius: 4px;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  font-size: 11.5px; color: var(--dsw-alias-label-primary, rgba(0,0,0,0.88));
}
.dtk-refpicker-item:hover { background: var(--dsw-alias-bg-hover, rgba(0,0,0,0.06)); }
.dtk-refpicker-icon { flex-shrink: 0; font-size: 12px; }
.dtk-refpicker-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtk-refpicker-path { font-size: 10px; color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4)); flex-shrink: 0; }
.dtk-refpicker-back {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; cursor: pointer;
  border: none; background: transparent; padding: 4px 6px;
  color: var(--brand-color, #3b6fd4); margin-bottom: 2px;
}
.dtk-refpicker-sep {
  font-size: 10px; color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4));
  padding: 4px 6px 2px; text-transform: uppercase; letter-spacing: 0.5px;
}
`

let injected = false

/** Inject the stylesheet once for the page's lifetime. */
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.setAttribute('data-dsh-plugin', 'devtask')
  style.setAttribute('data-dsh-part', 'stylesheet')
  style.textContent = CSS
  document.head.appendChild(style)
}