import { app, webContents, type WebContents } from 'electron'

/**
 * Ione's material vocabulary on the built-in uBlock Origin Lite's own documents.
 *
 * The extension is the blocker: its popup, dashboard and matched-rules page are its UI, and the
 * host does not fork their controls. What the host can do is make them look like the browser
 * around them – the menu surface, Ione's ink and accent, rounded cards, the same press motion –
 * through a user-origin stylesheet, which wins over the extension's author CSS without touching
 * a file of the GPL package. `installUblockTheme(id)` is called once the bundled extension has
 * loaded; every extension page created afterwards (or already open) is dressed on load.
 */
const CSS = String.raw`
:root {
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif !important;
  --font-size: 13.5px;
  --surface-0-rgb: 21 21 25;
  --surface-1: #1c1c22;
  --surface-2: #24242c;
  --surface-3: #34343e;
  --ink-1: #f1f1f5;
  --ink-2: #c3c3cd;
  --ink-3: #93939f;
  --ink-4: #70707c;
  --accent-surface-1: #a99bff;
  --accent-surface-2: #8c7dff;
  --accent-surface-3: #7463f2;
  --popup-toolbar-surface: transparent;
  --button-surface: #26262f;
  --button-surface-hover: #30303a;
  --border-1: #30303a;
  --border-2: #3d3d49;
  color-scheme: dark;
}
html.light {
  --surface-0-rgb: 248 248 250;
  --surface-1: #ffffff;
  --surface-2: #f2f2f6;
  --surface-3: #e1e1e8;
  --ink-1: #17171c;
  --ink-2: #474751;
  --ink-3: #6d6d78;
  --ink-4: #8b8b96;
  --accent-surface-1: #5a46d6;
  --accent-surface-2: #6c57ea;
  --accent-surface-3: #5842cf;
  --popup-toolbar-surface: transparent;
  --button-surface: #f1f1f5;
  --button-surface-hover: #e8e8ef;
  --border-1: #e2e2e9;
  --border-2: #d3d3dd;
  color-scheme: light;
}
html, body {
  background: transparent !important;
  color: var(--ink-1) !important;
  font-family: var(--font-family) !important;
  min-height: 0;
  overflow-x: hidden;
}
body:has(#dashboard-nav) {
  min-height: 100vh;
}
body {
  background:
    radial-gradient(70% 42% at 92% -6%, rgb(116 99 242 / 0.16), transparent 62%),
    radial-gradient(55% 38% at -8% 32%, rgb(96 165 250 / 0.06), transparent 60%),
    rgb(var(--surface-0-rgb)) !important;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 {
  color: var(--ink-1) !important;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
p, li, label, summary {
  color: var(--ink-2) !important;
  line-height: 1.55 !important;
}
a { color: var(--accent-surface-1) !important; }
button, input, select, textarea {
  font-family: var(--font-family) !important;
  color: var(--ink-1) !important;
}
input[type="text"], input[type="search"], input[type="url"], textarea {
  box-sizing: border-box;
  width: 100%;
  background: var(--surface-2) !important;
  border: 0 !important;
  border-radius: 11px !important;
  padding: 8px 11px !important;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
input:focus, textarea:focus, button:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-surface-2) 65%, transparent) !important;
}
button {
  border: 0 !important;
  background: var(--button-surface) !important;
  border-radius: 11px !important;
  transition: background 140ms ease, border-color 140ms ease, transform 120ms ease;
}
button:hover { background: var(--button-surface-hover) !important; }
button:active { transform: scale(.96); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink-3) 32%, transparent) !important;
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

/* The popup: Material 3 Expressive in miniature – one tonal sheet, a springy mode selector,
   pill-shaped tools and a live gradient behind the glass. */
html#uBO-popup-panel,
html#uBO-popup-panel body {
  min-height: 0 !important;
  height: auto !important;
}
html#uBO-popup-panel {
  background: transparent !important;
}
html#uBO-popup-panel body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 10px 6px !important;
  overflow: hidden !important;
  animation: ione-ubo-sheet-in 340ms cubic-bezier(.16,1,.3,1) both;
}
html#uBO-popup-panel body::before {
  content: '';
  position: fixed;
  z-index: -1;
  inset: 0;
  background:
    radial-gradient(42% 48% at 28% 24%, rgb(140 125 255 / .42), transparent 70%),
    radial-gradient(40% 44% at 74% 68%, rgb(96 165 250 / .24), transparent 72%),
    radial-gradient(36% 40% at 70% 10%, rgb(244 114 182 / .20), transparent 72%);
  opacity: .9;
  animation: ione-ubo-aurora 9s ease-in-out infinite alternate;
}
html#uBO-popup-panel main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
}
/* A tonal site pill, the one anchor the eye starts on. */
#hostname {
  display: flex;
  min-height: 0 !important;
  align-items: center;
  justify-content: center;
  margin: 0 0 10px !important;
  padding: 12px 16px !important;
  border: 0 !important;
  border-radius: 26px !important;
  background: color-mix(in srgb, var(--accent-surface-2) 13%, var(--surface-1)) !important;
  color: var(--ink-1) !important;
  box-shadow:
    0 1px 0 rgb(255 255 255 / .06) inset,
    0 6px 20px rgb(0 0 0 / .18);
  animation: ione-ubo-item-in 380ms cubic-bezier(.16,1,.3,1) both;
}
#hostname > span + span {
  color: var(--accent-surface-1) !important;
  font-weight: 700;
}
#hostname::before {
  content: '';
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--accent-surface-1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-surface-2) 18%, transparent);
  animation: ione-ubo-breathe 2.8s ease-in-out infinite;
}
/* The filtering selector: a tonal track and an expressive thumb that springs between stops. */
#filteringModeText {
  margin: 2px 0 8px !important;
  color: var(--ink-3) !important;
  text-align: center;
}
#filteringModeText > span:first-of-type {
  display: inline-block;
  color: var(--ink-1) !important;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  animation: ione-ubo-mode-name 320ms cubic-bezier(.16,1,.3,1) both;
}
#filteringModeText > span:nth-of-type(2) { color: var(--accent-surface-1) !important; }
.filteringModeSlider {
  --filtering-mode-button-size: 54px;
  --filtering-mode-slider-background: color-mix(in srgb, var(--surface-2) 80%, transparent);
  align-self: stretch !important;
  box-sizing: border-box;
  width: 100% !important;
  max-width: 100%;
  height: 62px;
  margin: 0 2px 10px !important;
  padding: 4px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-2) 74%, transparent);
  box-shadow: 0 1px 0 rgb(255 255 255 / .04) inset;
  animation: ione-ubo-item-in 400ms 30ms cubic-bezier(.16,1,.3,1) both;
}
.filteringModeSlider span[data-level] {
  display: flex;
  height: 100%;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  margin: 0 !important;
  border-radius: 999px;
  background: transparent !important;
  opacity: 1;
}
.filteringModeSlider span[data-level]::after {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-4);
  opacity: .55;
  transition: transform 200ms cubic-bezier(.16,1,.3,1), background 160ms ease, opacity 160ms ease;
}
.filteringModeSlider span[data-level]:hover::after {
  transform: scale(1.5);
  background: var(--accent-surface-1);
  opacity: 1;
}
.filteringModeSlider[data-level="0"] span[data-level]:nth-of-type(1)::after,
.filteringModeSlider[data-level="1"] span[data-level]:nth-of-type(2)::after,
.filteringModeSlider[data-level="2"] span[data-level]:nth-of-type(3)::after,
.filteringModeSlider[data-level="3"] span[data-level]:nth-of-type(4)::after {
  background: color-mix(in srgb, var(--accent-surface-3) 60%, var(--surface-1));
  opacity: .9;
}
.filteringModeButton {
  width: 26px !important;
  height: 26px !important;
  border-radius: 999px !important;
  background: transparent;
  z-index: 10;
  top: 50% !important;
  transform: translateY(-50%);
  transition: left 380ms cubic-bezier(.34,1.56,.64,1);
}
.filteringModeSlider[data-level="0"] .filteringModeButton { left: calc(12.5% - 13px) !important; }
.filteringModeSlider[data-level="1"] .filteringModeButton { left: calc(37.5% - 13px) !important; }
.filteringModeSlider[data-level="2"] .filteringModeButton { left: calc(62.5% - 13px) !important; }
.filteringModeSlider[data-level="3"] .filteringModeButton { left: calc(87.5% - 13px) !important; }
.filteringModeButton > div {
  border: 0;
  border-radius: 999px;
  background: linear-gradient(145deg, var(--accent-surface-1), var(--accent-surface-3)) !important;
  box-shadow:
    0 2px 0 rgb(255 255 255 / .16) inset,
    0 8px 20px color-mix(in srgb, var(--accent-surface-3) 44%, transparent);
  transition: transform 200ms cubic-bezier(.16,1,.3,1), filter 160ms ease;
}
.filteringModeButton > div:hover { transform: scale(1.06); filter: none; }
.filteringModeSlider.moving .filteringModeButton > div { transform: scale(1.08); filter: none; }
.filteringModeSlider[data-level="0"] .filteringModeButton > div {
  background: linear-gradient(145deg, var(--surface-3), var(--surface-2)) !important;
  box-shadow: 0 6px 16px rgb(0 0 0 / .24);
}
/* Tools: tonal list rows, then a quiet icon ribbon. */
.toolMenu {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  margin: 8px 0 2px !important;
  padding: 0 !important;
  box-shadow: none !important;
  animation: ione-ubo-item-in 420ms 80ms cubic-bezier(.16,1,.3,1) both;
}
.toolMenu > .tool {
  background: color-mix(in srgb, var(--surface-1) 54%, transparent) !important;
  margin: 3px 0;
}
.toolMenu > .tool:hover {
  background: color-mix(in srgb, var(--accent-surface-2) 15%, var(--surface-1)) !important;
}
.toolRibbon {
  border: 0 !important;
  box-shadow: none !important;
  animation: ione-ubo-item-in 420ms 120ms cubic-bezier(.16,1,.3,1) both;
}
.toolMenu > .tool, .toolRibbon > .tool {
  border-radius: 14px !important;
  padding: 10px 11px !important;
  transition: background 160ms ease, transform 180ms cubic-bezier(.16,1,.3,1), color 160ms ease;
}
.toolMenu > .tool:hover, .toolRibbon > .tool:hover {
  background: color-mix(in srgb, var(--accent-surface-2) 16%, transparent) !important;
  transform: translateX(3px);
}
.toolMenu > .tool:active, .toolRibbon > .tool:active {
  transform: scale(.94);
  background: color-mix(in srgb, var(--accent-surface-2) 24%, transparent) !important;
}
.toolMenu > .tool > .fa-icon:first-child {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-right: 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent-surface-2) 15%, transparent);
  color: var(--accent-surface-1);
}
.toolMenu > label {
  padding: 2px 10px 6px !important;
  color: var(--ink-3) !important;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .02em;
}
.toolRibbon {
  width: 100% !important;
  box-sizing: border-box;
  align-self: stretch;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin: 8px 0 0 !important;
  padding: 4px 5px 4px 12px !important;
  border: 0 !important;
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-1) 72%, transparent) !important;
  box-shadow: none !important;
}
.toolRibbon::before {
  content: 'uBlock Origin Lite';
  color: var(--ink-3);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.toolRibbon .tool {
  display: grid;
  width: 36px;
  min-width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0 !important;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
  box-shadow: none;
}
.toolRibbon .tool:hover { transform: translateY(-2px) scale(1.04); background: var(--button-surface-hover); }
.toolRibbon .tool:active { transform: scale(.9); }

/* The dashboard: a centred document with a quiet navigation pill; sections are sections, not
   repeated bordered cards. Only the filtering choices get a surface because they are choices. */
body:has(#dashboard-nav) {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0 48px;
}
body:has(#dashboard-nav) > * {
  box-sizing: border-box;
  width: min(760px, calc(100% - 32px));
  max-width: 100%;
}
header {
  position: sticky;
  top: 0;
  z-index: 20;
  margin: 0 0 18px !important;
  padding: 8px 0 !important;
  background: linear-gradient(rgb(var(--surface-0-rgb) / .94), rgb(var(--surface-0-rgb) / .78) 70%, transparent) !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: blur(16px) saturate(1.2);
  animation: ione-ubo-header-in 320ms cubic-bezier(.2,.8,.2,1) both;
}
nav {
  display: flex;
  gap: 3px;
  padding: 4px;
  border: 0 !important;
  border-radius: 20px;
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
  box-shadow: 0 10px 30px rgb(0 0 0 / .16);
  overflow-x: auto;
  scrollbar-width: none;
}
nav > .tabButton {
  border: 0 !important;
  border-radius: 12px !important;
  padding: 9px 14px !important;
  background: transparent !important;
  color: var(--ink-3) !important;
  transition: background 140ms ease, color 140ms ease, transform 120ms ease;
}
nav > .tabButton:hover { color: var(--ink-1) !important; background: var(--button-surface-hover) !important; }
nav > .tabButton:active { transform: scale(.96); }
body[data-pane="settings"] nav .tabButton[data-pane="settings"],
body[data-pane="rulesets"] nav .tabButton[data-pane="rulesets"],
body[data-pane="filters"] nav .tabButton[data-pane="filters"],
body[data-pane="develop"] nav .tabButton[data-pane="develop"],
body[data-pane="about"] nav .tabButton[data-pane="about"] {
  background: color-mix(in srgb, var(--accent-surface-2) 22%, var(--surface-2)) !important;
  color: var(--ink-1) !important;
  box-shadow: 0 1px 0 rgb(255 255 255 / .05) inset;
}
nav .logo { display: grid; place-items: center; padding: 0 8px 0 6px; }
body > section { padding: 0 !important; }
body > section > div {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  margin: 0 !important;
  padding: 0 0 22px !important;
  box-shadow: none !important;
  animation: ione-ubo-section-in 280ms cubic-bezier(.2,.8,.2,1) both;
}
body > section > div + div {
  border-top: 1px solid var(--border-1) !important;
  padding-top: 22px !important;
}
body[data-pane="settings"] > section[data-pane="settings"] {
  display: flex;
  flex-direction: column;
  gap: 0;
}
/* The dashboard's mode choice is a segmented tonal control: the active stop itself grows a
   pill, so the indicator can never drift from the dots and never spills out of a card. */
body:has(#dashboard-nav) .filteringModeButton { display: none !important; }
body:has(#dashboard-nav) .filteringModeSlider span[data-level] {
  position: relative;
}
body:has(#dashboard-nav) .filteringModeSlider span[data-level]::before {
  content: '';
  position: absolute;
  inset: 7px 3px;
  border-radius: 999px;
  background: transparent;
  transition: background 220ms cubic-bezier(.16,1,.3,1), box-shadow 220ms ease;
}
body:has(#dashboard-nav) .filteringModeSlider[data-level="0"] span[data-level="0"]::before,
body:has(#dashboard-nav) .filteringModeSlider[data-level="1"] span[data-level="1"]::before,
body:has(#dashboard-nav) .filteringModeSlider[data-level="2"] span[data-level="2"]::before,
body:has(#dashboard-nav) .filteringModeSlider[data-level="3"] span[data-level="3"]::before {
  background: color-mix(in srgb, var(--accent-surface-2) 24%, transparent);
  box-shadow: 0 1px 0 rgb(255 255 255 / .05) inset;
}
body:has(#dashboard-nav) .filteringModeSlider span[data-level]::after {
  position: relative;
  z-index: 1;
}
body > section > div:nth-child(2) { animation-delay: 45ms; }
body > section > div:nth-child(3) { animation-delay: 90ms; }
h3 {
  margin: 0 0 5px !important;
  font-size: 15px !important;
  font-weight: 650 !important;
}
body > section > div > p { max-width: 68ch; margin: 0 0 14px; }
#defaultFilteringMode {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
  align-items: stretch;
}
#defaultFilteringMode > * { min-width: 0; }
@media (max-width: 780px) {
  #defaultFilteringMode { grid-template-columns: 1fr !important; }
  #defaultFilteringMode > :nth-child(3) { grid-column: auto !important; }
  .filteringModeCard {
    display: grid !important;
    height: auto !important;
    min-height: 88px;
    grid-template-columns: auto 148px minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 12px 14px !important;
  }
  .filteringModeCard > div { padding: 0 !important; }
  .filteringModeCard > div:nth-of-type(2) { width: 148px; }
  .filteringModeCard > div:nth-of-type(3) {
    border-top: 0 !important;
    max-height: 46px;
    overflow: hidden;
    font-size: 11.5px !important;
  }
}
@media (max-width: 560px) {
  .filteringModeCard {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .filteringModeCard > div:nth-of-type(2) { grid-column: 1 / -1; grid-row: 2; width: 100%; }
  .filteringModeCard > div:nth-of-type(3) { grid-column: 1 / -1; grid-row: 3; max-height: none; }
}
.filteringModeCard {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  margin: 0 !important;
  padding: 14px !important;
  border: 0 !important;
  border-radius: 26px !important;
  background: color-mix(in srgb, var(--surface-1) 78%, transparent) !important;
  box-shadow: 0 1px 0 rgb(255 255 255 / .035) inset;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}
.filteringModeCard:hover {
  transform: translateY(-3px) scale(1.012);
  background: color-mix(in srgb, var(--accent-surface-2) 5%, var(--surface-1)) !important;
}
.filteringModeCard:has(input:checked) {
  background: color-mix(in srgb, var(--accent-surface-2) 15%, var(--surface-1)) !important;
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--accent-surface-2) 70%, transparent),
    0 12px 26px color-mix(in srgb, var(--accent-surface-3) 16%, transparent);
}
.filteringModeCard > div:last-child { color: var(--ink-3) !important; font-size: 11.5px; line-height: 1.45; }
.filteringModeCard > div:nth-of-type(2) { display: none; }
#lists .listEntry {
  border: 0 !important;
  border-radius: 14px !important;
  margin: 0 !important;
  padding: 11px 12px !important;
  background: transparent !important;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
}
#lists .listEntry:hover {
  background: color-mix(in srgb, var(--accent-surface-2) 10%, var(--surface-1)) !important;
  transform: translateX(2px);
}
.input.checkbox > svg, .input.radio > svg { color: var(--accent-surface-1) !important; }
details {
  border: 0 !important;
  border-radius: 14px !important;
  padding: 10px 12px !important;
  background: color-mix(in srgb, var(--surface-1) 60%, transparent) !important;
}
summary { color: var(--ink-1) !important; }

@keyframes ione-ubo-sheet-in {
  from { opacity: 0; transform: translateY(6px) scale(.985); }
  to { opacity: 1; transform: none; }
}
@keyframes ione-ubo-header-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}
@keyframes ione-ubo-section-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes ione-ubo-pulse {
  0% { transform: scale(.82); opacity: .4; }
  70% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.filteringModeCard:has(input:checked) .input.radio svg { animation: ione-ubo-pulse 260ms cubic-bezier(.2,.8,.2,1); }


/* The click's shape: a single material ripple inside whatever the pointer pressed. */
.ione-ripple {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  z-index: 30;
  background: color-mix(in srgb, var(--accent-surface-1) 52%, transparent);
  transform: translate(-50%, -50%) scale(0);
  animation: ione-ubo-ripple 520ms cubic-bezier(.2,.7,.3,1) forwards;
}
@keyframes ione-ubo-ripple {
  60% { opacity: .55; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
}
@keyframes ione-ubo-aurora {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(10deg) scale(1.08); }
  100% { transform: rotate(-8deg) scale(1.03); }
}
@keyframes ione-ubo-breathe {
  0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-surface-2) 16%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent-surface-2) 6%, transparent); }
}
@keyframes ione-ubo-item-in {
  from { opacity: 0; transform: translateY(8px) scale(.98); }
  to { opacity: 1; transform: none; }
}
@keyframes ione-ubo-mode-name {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 680px) {
  #defaultFilteringMode { grid-template-columns: 1fr; }
  body:has(#dashboard-nav) > * { width: min(760px, calc(100% - 20px)); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`
const RIPPLE = String.raw`
(() => {
  if (window.__ioneRipple) return;
  window.__ioneRipple = true;
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, .tool, .tabButton, .filteringModeCard, summary')
      : null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.5;
    const style = getComputedStyle(target);
    if (style.position === 'static') target.style.position = 'relative';
    if (style.overflow !== 'hidden') target.style.overflow = 'hidden';
    const ripple = document.createElement('span');
    ripple.className = 'ione-ripple';
    ripple.style.width = ripple.style.height = rect.height + 'px';
    ripple.style.left = (event.clientX - rect.left) + 'px';
    ripple.style.top = (event.clientY - rect.top) + 'px';
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });
})()`

const themed = new Set<number>()
let installedFor: string | null = null

function apply(wc: WebContents, id: string): void {
  if (wc.isDestroyed()) return
  if (!wc.getURL().startsWith(`chrome-extension://${id}/`)) return
  if (themed.has(wc.id)) return
  themed.add(wc.id)
  wc.insertCSS(CSS, { cssOrigin: 'user' }).catch(() => themed.delete(wc.id))
  wc.executeJavaScript(RIPPLE).catch(() => undefined)
  wc.once('destroyed', () => themed.delete(wc.id))
}

/** Dress every uBlock Origin Lite document of `id`; idempotent, and follows pages opened later. */
export function installUblockTheme(id: string): void {
  if (installedFor === id) return
  installedFor = id
  const dress = (wc: WebContents): void => {
    if (!wc.getURL().startsWith(`chrome-extension://${id}/`)) return
    if (wc.isLoading()) wc.once('did-finish-load', () => apply(wc, id))
    else apply(wc, id)
  }
  for (const wc of webContents.getAllWebContents()) dress(wc)
  app.on('web-contents-created', (_event, wc) => {
    dress(wc)
    wc.on('did-finish-load', () => apply(wc, id))
  })
}
