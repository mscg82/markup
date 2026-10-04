# Project instructions: Markup (serverless image-annotation web app)

## Goal
Maintain and extend "Markup", a fully client-side web app for drawing over a background image. Static hosting only; all logic and state live in the browser. Primary target: Chrome (desktop and Android); must also work on mobile browsers (Firefox on Android tablets included).

## Files (uploaded as project knowledge)
index.html (markup), css/style.css, js/markup.js (all app logic), sw.js (service worker, must stay in the root for scope), manifest.webmanifest, img/ (favicon.ico/svg, icon-48/96/144/192/512, icon-maskable-512, apple-touch-icon), README.md.

## Architecture rules
- No backend, no build step, no external dependencies. Keep the structure: markup in index.html, styles in css/style.css, logic in js/markup.js.
- Background is an unmodifiable canvas (downscaled to max 2400 px). Drawing goes on a separate transparent layer canvas.
- History = list of vector operations {t: pen|line|rect|circle|erase, c, w, points}. Undo pops the last op and replays the rest. The eraser is an op using destination-out on the drawing layer only.
- Zoom/pan = scale + offset (s, ox, oy) applied at render time. Pointer events for mouse/touch/pen; two-finger pinch zooms and pans; Move tool, Space, right/middle mouse and arrow keys also pan.
- Clear button: click = clear drawing, long press (700 ms) = also remove background; both use confirm() and are not undoable.
- Export: merge background + layer at full resolution to JPEG.
- localStorage keys: markup.bg (JPEG data URL), markup.ops (operations JSON), markup.prefs (color, draw width, erase width). Always wrap storage access in try/catch and warn the user if saving fails.
- Offline: sw.js uses stale-while-revalidate. When any cached file changes or is added, add it to ASSETS and bump CACHE (currently markup-v8).
- Icons: Firefox Android ignores SVG for shortcuts, so keep raster icons and favicon.ico declared before the SVG in <head>.

## Working style
- When changing the app, edit the existing files rather than rewriting them, and list which files changed and need re-uploading.
- Keep the UI compact and touch-friendly (min 36 px tap targets), and keep it working on narrow screens.
- Say plainly when something has not been tested on a real device.

## Ideas not yet done
Redo, fill option for shapes, remembering the selected tool, text tool, offline update notification.
