# Performance measurements

Generated: 2026-10-21T08:43:27.784Z

Environment: Linux x64 container, Xvfb 1440x900, Electron 44.9.2 (Chromium 152),
extensions/adblock/feed worker disabled to isolate shell overhead. Startup is measured
from main-module load to chrome `did-finish-load` (first chrome paint). Working set is
summed from `app.getAppMetrics()` across Electron processes after 500 ms idle.

| Tabs | Sleeping | Working set | Main RSS | Renderer procs | Startup | Diff batches |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 575 MB | 167 MB | 2 | 244 ms | 0 |
| 1 | 0 | 576 MB | 167 MB | 2 | 252 ms | 0 |
| 20 | 0 | 2156 MB | 190 MB | 21 | 237 ms | 1 |
| 20 | 19 | 607 MB | 184 MB | 2 | 228 ms | 6 |
| 50 | 0 | 4630 MB | 220 MB | 51 | 232 ms | 1 |
| 50 | 49 | 629 MB | 197 MB | 2 | 207 ms | 11 |

Notes:
- Tabs are `about:blank`; inactive awake tabs keep one renderer/WebContentsView each.
- Sleeping tabs have their WebContents destroyed; only the active tab should remain.
- Diff batches coalesce reducer changes on the ~16 ms frame timer.
- CPU/IPC message rate was not profiled beyond batch/diff counts; add a tracing pass in a future iteration if regressions appear.
- Target from the plan: startup < 1.5 s, 50 sleeping tabs well under 3 GB.
