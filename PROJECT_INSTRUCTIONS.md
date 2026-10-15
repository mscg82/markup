# Project instructions: Markup (serverless image-annotation web app)

## Goal
Maintain and extend "Markup", a fully client-side web app for drawing over a background image. Static hosting only; all logic and state live in the browser. Primary target: Chrome (desktop and Android); must also work on mobile browsers (Firefox on Android tablets included).

## Files (uploaded as project knowledge)
index.html (markup), css/style.css, js/markup.js (app logic), js/colorpicker.js (custom color picker), js/i18n.js, locale/languages.json (selectable languages) and locale/*.json (all user-visible strings; never hard-code text in HTML or JS, add a key to locale/en.json and use data-i18n* attributes or t()), sw.js (service worker, must stay in the root for scope), manifest.webmanifest, img/ (favicon.ico/svg, icon-48/96/144/192/512, icon-maskable-512, apple-touch-icon), README.md.

## Architecture rules
- No backend, no build step, no external dependencies. Keep the structure: markup in index.html, styles in css/style.css, logic in js/markup.js.
- Background is an unmodifiable canvas (downscaled to max 2400 px). Drawing goes on a separate transparent layer canvas.
- History = list of vector operations {t: pen|line|rect|circle|erase, c, w, points}. Undo pops the last op and replays the rest. The eraser is an op using destination-out on the drawing layer only.
- Zoom/pan = scale + offset (s, ox, oy) applied at render time. Pointer events for mouse/touch/pen; two-finger pinch zooms and pans; Move tool, Space, right/middle mouse and arrow keys also pan.
- Clear button: click = clear drawing, long press (700 ms) = also remove background; both use confirm() and are not undoable.
- Export: merge background + layer at full resolution to JPEG.
- localStorage keys: markup.bg (JPEG data URL), markup.ops (operations JSON), markup.prefs (color, draw width, erase width). Always wrap storage access in try/catch and warn the user if saving fails.
- Offline: sw.js uses stale-while-revalidate. When a cached file is added, add it to ASSETS. Version rule: CACHE in sw.js (currently markup-v27) and APP_VERSION in js/markup.js (shown in the app's bottom-right corner) always change together, and only (1) in the first code change after the owner announces that a new development cycle has begun, or (2) when the owner explicitly asks for a bump. Never bump them at any other time.
- Icons: Firefox Android ignores SVG for shortcuts, so keep raster icons and favicon.ico declared before the SVG in <head>.

## Working style
- When changing the app, edit the existing files rather than rewriting them, and list which files changed and need re-uploading.
- Keep the UI compact and touch-friendly (min 36 px tap targets), and keep it working on narrow screens.
- Say plainly when something has not been tested on a real device.

## Ideas not yet done
fill option for shapes, remembering the selected tool, text tool, offline update notification.

## Code conventions
- When converting a value to a number with unary plus in an assignment, always write `a=(+b)`, never `a=+b`, so it is not mistaken for `+=`.

- Snapshots: stored in localStorage `markup.snapshots` (array of {id,name,created,enc,data}; data = deflate+base64 of JSON {operations,preferences}, enc 'deflate', or plain JSON with enc 'json' when CompressionStream is missing). The background is NOT stored: it is always markup.bg, valid because every action that replaces the background calls resetSnapshots() (Open image, Empty image, Clear short/long, Import status). Restoring a snapshot only replaces ops/preferences and replays. Entries in older formats are dropped at load.
- js/diag.js: optional touch-diagnostics panel, enabled by settings.diag (Settings checkbox). It listens on window in the capture phase (passive) and never changes events. markup.js tells it about changes with the 'markup:diag' event; its close button fires 'markup:diag-closed'.
- Palm rejection lives in js/markup.js (palmOn, palmDown, palmUp, palmReset; settings.palm default false, settings.palmMs default 250). Every hook is guarded by `palmOn` first so the off state costs one boolean test; rejected pointers are kept in palmRej and never enter `ptrs`. Size ratios (0.6, 1.8) and the 1 s after-window are constants, not settings.

- Resize background: resampleCanvas(src,w,h,sharp) in js/markup.js. The 'scale' op carries `s` (0 legacy bicubic, 1 normal, 2 strong Lanczos-3 + clamped unsharp). Never change what s=0/missing produces, because saved histories replay it.
