// Single scoped stylesheet (prefix td-), injected once into document.head.
// Follows the shell's dark marker via body[data-ds-dark-theme] (CSS only),
// same convention as the reference panel plugins.

export const PANEL_STYLE_ID = 'dsh-token-dashboard-styles'

export const STYLE_TEXT = [
  ':root {',
  '  --td-bg: #ffffff; --td-border: #e3e6ea; --td-text: #1f2430; --td-muted: #6b7280;',
  '  --td-c0: #eef1f4; --td-c1: #c9e6c0; --td-c2: #8fd08a; --td-c3: #4cb155; --td-c4: #2b8a3e; --td-c5: #1b6e2f;',
  '  --td-accent: #3b82f6; --td-shadow: 0 12px 40px rgba(0,0,0,.18);',
  '}',
  "body[data-ds-dark-theme] {",
  '  --td-bg: #1a1d24; --td-border: #2e333d; --td-text: #e5e7eb; --td-muted: #9ca3af;',
  '  --td-c0: #262b33; --td-c1: #1d4428; --td-c2: #2a6b33; --td-c3: #3d9b48; --td-c4: #57c163; --td-c5: #7ee787;',
  '  --td-shadow: 0 12px 40px rgba(0,0,0,.55);',
  '}',
  '.td-panel {',
  '  position: fixed; z-index: 1200; left: 50%; top: 8vh; transform: translateX(-50%);',
  '  width: min(940px, calc(100vw - 48px)); max-height: 82vh; overflow: auto;',
  '  background: var(--td-bg); border: 1px solid var(--td-border); border-radius: 12px;',
  '  box-shadow: var(--td-shadow); color: var(--td-text); pointer-events: auto;',
  '  font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif; font-size: 13px;',
  '}',
  '.td-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--td-border); flex-wrap: wrap; }',
  '.td-head h2 { margin: 0; font-size: 15px; font-weight: 600; }',
  '.td-head .td-spacer { flex: 1; }',
  '.td-seg { display: inline-flex; border: 1px solid var(--td-border); border-radius: 8px; overflow: hidden; }',
  '.td-seg button { border: 0; background: transparent; color: var(--td-text); padding: 4px 12px; font-size: 12px; cursor: pointer; }',
  '.td-seg button.on { background: var(--td-accent); color: #fff; }',
  '.td-btn { font-size: 12px; padding: 4px 12px; border: 1px solid var(--td-border); border-radius: 8px; background: transparent; color: var(--td-text); cursor: pointer; }',
  '.td-btn:hover { border-color: var(--td-accent); }',
  '.td-iconbtn { border: 0; background: transparent; color: var(--td-muted); cursor: pointer; font-size: 15px; padding: 2px 6px; }',
  '.td-stats { display: flex; gap: 28px; flex-wrap: wrap; padding: 12px 16px 2px; }',
  '.td-stat .num { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }',
  '.td-stat .lbl { font-size: 11px; color: var(--td-muted); }',
  '.td-body { padding: 10px 16px 16px; }',
  '.td-tabs { display: inline-flex; border: 1px solid var(--td-border); border-radius: 8px; overflow: hidden; margin: 0 12px 10px 0; }',
  '.td-tabs button { border: 0; background: transparent; color: var(--td-text); padding: 4px 14px; font-size: 12px; cursor: pointer; }',
  '.td-tabs button.on { background: var(--td-accent); color: #fff; }',
  '.td-pager { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }',
  '.td-pager .td-cap { color: var(--td-muted); font-size: 12px; min-width: 120px; }',
  '.td-grid { position: relative; display: inline-block; }',
  '.td-months { display: flex; padding-left: 26px; }',
  '.td-months span { font-size: 10px; color: var(--td-muted); white-space: nowrap; }',
  '.td-row { display: flex; gap: 3px; margin-bottom: 3px; }',
  '.td-weekday { width: 22px; font-size: 10px; color: var(--td-muted); text-align: right; padding-right: 4px; line-height: 12px; }',
  '.td-cell { width: 12px; height: 12px; border-radius: 2px; cursor: pointer; }',
  '.td-legend { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--td-muted); margin-top: 10px; }',
  '.td-legend .td-cell { cursor: default; }',
  '.td-tip { position: absolute; z-index: 10; background: #111827; color: #fff; font-size: 12px; padding: 8px 10px; border-radius: 8px; pointer-events: none; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.3); }',
  '.td-tip .big { font-weight: 700; }',
  '.td-tip .sub { color: #9ca3af; font-size: 11px; }',
  '.td-bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; }',
  '.td-bar { flex: 1; background: var(--td-accent); border-radius: 2px 2px 0 0; min-width: 4px; opacity: .85; cursor: pointer; }',
  '.td-bar:hover { opacity: 1; }',
  '.td-list { max-height: 240px; overflow: auto; }',
  '.td-drow { display: flex; align-items: center; gap: 10px; padding: 5px 4px; border-bottom: 1px solid var(--td-border); font-size: 12px; }',
  '.td-drow .d { width: 92px; color: var(--td-muted); font-variant-numeric: tabular-nums; }',
  '.td-drow .bar { flex: 1; height: 8px; background: var(--td-c0); border-radius: 4px; overflow: hidden; }',
  '.td-drow .bar i { display: block; height: 100%; background: var(--td-accent); }',
  '.td-drow .v { width: 90px; text-align: right; font-variant-numeric: tabular-nums; }',
  '.td-drow .note { width: 150px; font-size: 11px; color: var(--td-muted); text-align: right; }',
  '.td-status { color: var(--td-muted); padding: 24px 0; text-align: center; }',
  '.td-foot { padding: 8px 16px; border-top: 1px solid var(--td-border); color: var(--td-muted); font-size: 11px; display: flex; gap: 16px; flex-wrap: wrap; }',
  '.td-entry { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; color: inherit; cursor: pointer; padding: 6px 8px; border-radius: 6px; font-size: 12px; }',
  '.td-entry:hover { background: var(--td-c0); }',
  '.td-entry svg { display: block; }',
].join('\n')

export function injectStyles(): void {
  if (document.getElementById(PANEL_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = PANEL_STYLE_ID
  style.textContent = STYLE_TEXT
  document.head.appendChild(style)
}
