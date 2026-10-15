# Markup

A serverless, client-side web app for drawing over an image. Open a picture, annotate it with lines, rectangles and circles, erase mistakes, and export the result as a JPEG. Everything runs in the browser: there is no backend, and your work is stored in the browser's local storage.

It works on laptops and on mobile browsers (Chrome is the primary target) and can be installed to the home screen and used offline.

## Features

- **Background image:** load any image; it is used as an unmodifiable background. Images larger than 2400 px on the long side are downscaled so they fit in browser storage.
- **Drawing tools:** freehand pen, a **Fill** (flood fill) tool, plus a **Shapes** menu with straight line, arrow (a line with a pointed head on the end point of the drag), rectangle, circle and a classic 5-pointed star (the circle and the star are dragged from the center outward; the star has one point up and is inscribed in the circle you drag). The Shapes button shows the icon of the shape you picked last.
- **Placing shapes:** a rectangle, circle or star is not committed when you release the drag. It stays as a preview with a round **Move** button next to it, and you can adjust it before it is placed: drag **Move** to reposition it; for a rectangle drag the two **corner handles** (top-left and bottom-right) to resize it; for a circle or star drag the **handle on the opposite side of Move** (at the top) to change its radius; picking another color or changing the line width recolors or re-thickens the shape. The shape is placed in the image, as one single history entry with its final position, size, color and width, as soon as you do anything else: tap or click elsewhere on the canvas, start a new drag, pick another tool, undo/redo, save or export. Pinching or scrolling to zoom does not place it. Moving, resizing and restyling during the preview are not part of the history.
- **Fill:** tap an area to flood-fill it with the selected color. The background image is ignored: only what you drew (lines, shapes, earlier fills) acts as a boundary, so a closed shape can be filled, and tapping on a blank area with nothing around it fills the whole image. Tapping on something you already drew or filled recolors the connected area of that same color. The fill is an ordinary history entry, so Undo and Redo work on it.
- **Color and width:** a built-in custom color picker (it looks the same in every browser) plus 16 quick-select swatches, and a width slider with a box next to it where you can type the width (1 to 80). A valid number moves the slider at once; an invalid entry is outlined in red, and when you leave the box (or press Enter) a number out of range is set to the nearest limit while anything that is not a number goes back to the current width. The pen, line and shape tools share one width setting; the eraser has its own.
- **Rotation:** when the view changes shape (for example the device is rotated between portrait and landscape) the zoom level is kept and the part of the image that was in the center of the view stays in the center.
- **Toolbar position:** the toolbar can be attached to the top (default) or to the left of the screen, which leaves more vertical room for drawing on a phone held in landscape. The button to the left of **Move** switches between the two (its icon shows where a click sends the toolbar). Holding it for about half a second selects **automatic** mode: left in landscape, top in portrait. On the left, the toolbar is arranged in rows whose buttons share the full width of the toolbar equally (the menu button keeps its size), and the color and width controls are collapsed into buttons. The choice is saved in local storage on each device (it is not part of Export status).
- **Responsive toolbar:** the line-width slider stays inline while it has at least about 250 px; when the toolbar is too narrow for that it collapses into a button (showing the current width) that opens a popup with a longer slider. Below about 1040 px the quick-color circles also move into the color picker popup.
- **Eraser:** removes only your drawing, never the background. While the eraser is selected, a translucent circle of the eraser width follows the mouse (or your finger or pen while it touches the screen), showing the area that will be cleaned. It is only an overlay and is never part of the drawing, the history or the exported image. Picking a color while the eraser is active switches back to the drawing tool you used before it (the pen if there was none), so you can go on drawing with the new color.
- **Undo and redo:** every stroke or shape is an operation in a history list (drawing operations and frame changes). Undo (or Ctrl/Cmd+Z) removes the last one and Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y) puts it back. The redo list is emptied as soon as you draw something new, and it is not saved between sessions. Holding Undo (about half a second; the button fills up while you hold) jumps to the very first step, i.e. undoes everything; holding Redo jumps to the very last step. Both are fully reversible with the other button.
- **Clear:** a click clears the drawing and keeps the background and its resize / crop steps in the history (they can still be undone); a long press (about 0.7 s) removes the background too. Both ask for confirmation, and neither can be undone.
- **Zoom and pan:** mouse wheel, pinch, or the −, Fit and + buttons to zoom. To pan, use the Move tool, two fingers, Space + drag, the right or middle mouse button, or the arrow keys.
- **Temporary zoom and move gestures:** *double click / double tap and keep the second press down* switches to a temporary **zoom** mode: moving up zooms in, moving down zooms out, around the point you pressed (the − and + buttons light up while it is active). *Triple click / triple tap and keep the third press down* switches to a temporary **move** mode: the Move button lights up and any movement pans the canvas. When you release, the app is back to normal and the tool you had selected (pen, fill, a shape...) is active again; the selected tool is never changed by the gesture. The quick taps before the held press are not kept as drawing (a pen dot or a fill made by them is removed again, and the redo list is restored). A "tap" is a press shorter than a quarter of a second that hardly moves; the next press must follow within about a third of a second and close to the previous one.
- **Settings (☰ → Settings):** the interface language (a dropdown of the available languages, or Automatic) and the default width and height of a new image (16–2400 px). They are saved in local storage and applied when the app loads. Changing the language reloads the app.
- **Resize frame (☰ → Resize → Resize frame):** adds a border around the image. You enter how many pixels to add on the top, right, bottom and left edges and pick a fill color; the dialog shows the resulting size (at most 2400 px per side). The image grows, everything already drawn keeps its look, and the new area is filled with the color. It is an ordinary history entry: Undo removes the frame (the image shrinks back) and Redo restores it. It is saved with the history, exported with *Export status*, and *Clear* (drawing only) keeps the enlarged background. Note that Fill ignores the background, so filling on blank space also fills the frame area.
- **Resize background (☰ → Resize → Resize background):** scales the background image up or down to new dimensions in pixels (16–2400 per side) using bicubic interpolation (the same method as Pillow's BICUBIC; when shrinking the filter is widened so the result stays smooth). The fields start with the current size, and *Keep aspect ratio* (on by default) makes the other dimension follow when you change one; with it off the two are independent. It is only possible while the history is empty: otherwise you are asked to clear the image first (or undo everything). The resize is the first entry of the history, so it can be undone and redone; the original background is kept and the result is recomputed from it. *Clear* (drawing only) keeps the resized background. A *Sharpness* choice (default Normal) picks the method: Off = the original smooth bicubic; Normal / Strong = Lanczos-3 followed, when the image is reduced, by an unsharp mask clamped to each pixel's 3×3 neighbourhood (no halos), which keeps text and thin lines crisper. The last choice is remembered in `markup.prefs` (key `sharp`, like the pen widths) and preselected next time. It is stored in the `scale` operation as `s` (0/1/2; a missing value means 0, so older saves, snapshots and status files look exactly as before).
- **Crop background (☰ → Resize → Crop background):** shows two corner handles (top-left, bottom-right) on the background, thin lines on the edges of the selection (the rest is dimmed) and a check button next to the top-right corner; drag the handles, then tap the check to keep only that area. While cropping, one finger pans and two fingers zoom/pan; an X button under the check (or Escape) cancels. Like resizing, it is only possible before any drawing mark exists (resize frame / resize background / crop can be chained in any order, any number of times). It is a `crop` operation `{x,y,w,h}` in the history, so it can be undone and redone. The background produced by the leading resize/crop operations is cached, so undo, redo and cancelled strokes do not redo them.
- **Snapshots (☰ → Snapshots):** named copies of the whole work (same content as *Export status*) kept in this browser's local storage. A snapshot stores only the list of operations and the color/width settings, deflate-compressed (about 3x smaller; stored uncompressed if the browser has no `CompressionStream`); the background is not copied, since it is the one already saved for the current work (every action that replaces it also clears the snapshots). Many snapshots therefore fit in the storage quota. The submenu has two entries. *New snapshot* asks for a name (default: the number of existing snapshots + 1, two digits, e.g. `03`). *Existing snapshots* is disabled when there are none; otherwise it opens a popup next to it listing the snapshots newest first, kept inside the visible screen and scrollable when long. Clicking a name restores it, after warning that it overrides the current work; the trash icon deletes it, after a confirmation. Snapshots are not included in *Export status*, and the list is cleared by *Open image*, *Empty image*, *Import status* and *Clear* (short or long click). Restoring a snapshot keeps the list.

- **Palm rejection (☰ → Settings → Palm rejection):** opt-in, off by default (when off, the pointer handlers only test one boolean). For a stylus on a touch screen. Rules are relative, with no pixel thresholds: while one contact is down, a second must land within the window (default 250 ms, 0 disables this rule) or it is ignored, so a two-finger pinch still works; if that late contact is much smaller (under 0.6×) than the first, the first was the palm: it is dropped (its stroke cancelled) and the small one is kept; for 1 s after a contact ends, a new contact more than 1.8× larger is ignored. Ignored contacts are never tracked and cause no pan, pinch or tap. Limits: a slow pinch is ignored; a finger down first and then the stylus is borderline; hardware that cuts the stylus itself when a palm lands cannot be fixed from a web page. Settings keys: `palm`, `palmMs`.
- **Help icons in Settings:** the Palm rejection and touch diagnostics entries have a circled ? button that shows or hides their explanation (hidden by default).
- **Touch diagnostics (☰ → Settings → Show touch diagnostics):** an on-screen panel (`js/diag.js`) that only observes input. It lists the pointers on the screen now and the latest events, with the type the browser reports (`pen`, `touch`, `mouse`), the contact size, pressure and tilt, plus the older touch-event data (radius, force, `touchType`), and totals by type (size ranges and maximum pressure). Its header shows the browser and the pointer capabilities. *Copy* puts the whole log on the clipboard to paste into a message; *Clear* resets it. It is meant for finding out whether a device can tell a stylus tip, a finger and a palm apart.

- **Main menu (☰):** *New* offers *Open image* and *Empty image* (you choose the width and height, up to 2400 px, and the background color; white by default). *Save JPEG* asks for a file name and downloads the background and drawing merged at the background's full resolution. *Export status* asks for a file name and downloads a JSON file with the background, the full list of operations and the saved settings (color and widths). *Import status* restores such a file, for example on another device. *Reload application* (after *Settings*) discards the service worker and its cached files, re-downloads every file listed in `sw.js` (translations included) bypassing the browser's HTTP cache, and reloads the page, which is the way to pick up a new version right away; your work and settings are kept. It needs a connection.
- **Image size:** a small label in the bottom-left corner of the canvas area shows the size of the image being edited in pixels (after the 2400 px downscale, if any). The bottom-right label shows the application version.
- **Persistence:** the background, the full operation list, the selected color and the tool widths are saved automatically and restored on reopening.
- **Installable and offline:** a web app manifest and a service worker let you add the app to the home screen and use it without a connection.

## Project structure

```
index.html              page markup
css/style.css           styles
js/markup.js            the application logic
js/colorpicker.js       custom color picker (same look in every browser; also used by the new-image dialog)
js/i18n.js              loads the locale file and provides translation helpers
locale/languages.json   list of selectable languages (code and name)
locale/en.json          all user-visible text (English, the base language)
locale/it.json          Italian translation; add more languages here
sw.js                   service worker (offline support) – must stay in the root
manifest.webmanifest    web app manifest (home screen install)
img/
  favicon.ico, favicon.svg
  icon-48.png, icon-96.png, icon-144.png, icon-192.png, icon-512.png
  icon-maskable-512.png icon with padding for Android adaptive icons
  apple-touch-icon.png  iOS home screen icon
```

`sw.js` is kept in the root on purpose: a service worker can only control pages at or below its own folder, so moving it into `js/` would stop offline support from working (unless your server sends a `Service-Worker-Allowed` header).

There is no build step and no dependencies.

## Running locally

The service worker and local storage need `http(s)`, so serve the folder rather than opening the file directly:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploying

Upload all the files and folders to any static host (GitHub Pages, Netlify, Nginx, and so on) in the same folder. Notes:

- Serve over **HTTPS** so the service worker and the install option work (`localhost` is also fine for testing).
- Serve `manifest.webmanifest` as `application/manifest+json` (or `application/json`).
- To publish a new version, change the `CACHE` name at the top of `sw.js` (for example `markup-v27`) so installed copies drop the old files. Also update `APP_VERSION` at the top of `js/markup.js` so the version label shown in the bottom-right corner of the app matches.

### GitHub Pages

1. Push the files to a repository.
2. In **Settings → Pages**, choose the branch and the root folder.
3. Open the published URL.

## Localization

All user-visible text (labels, tooltips, messages, dialogs) is kept in `locale/<language>.json`, flat files of `"key": "text"` pairs. `locale/en.json` is always loaded first as the base, then the language chosen on top of it, so a partial translation simply falls back to English for the missing keys.

The language is chosen in this order: `?lang=xx` in the URL (handy for testing), the language saved in **Settings** (☰ → Settings), and finally the browser's language list (for example `it-IT` is tried as `it-IT`, then `it`). In Settings the default is *Automatic*, which uses the browser's language list.

English (`en`) and Italian (`it`) are included. To add a language:

1. Add an entry `{"code": "xx", "name": "Language name"}` to `locale/languages.json` (it feeds the language dropdown in Settings).
2. Copy `locale/en.json` to `locale/<code>.json` (for example `locale/it.json`) and translate the values, leaving the keys unchanged. Keep placeholders such as `{version}`, `{min}`, `{max}` and `{color}` in the text.
3. Optionally add `'./locale/<code>.json'` to `ASSETS` in `sw.js` so it is cached for offline use right away, and bump the cache name.
4. Select it in Settings, or open the app with `?lang=<code>`, to check it.

In the code, HTML elements use `data-i18n="key"` (text), `data-i18n-title="key"` (tooltip) and `data-i18n-aria-label="key"`, and scripts call `t('key')` or `t('key', {name: value})`. A key that is missing from every file is shown as the key itself.

Not localized: the name and short name in `manifest.webmanifest`, and the file extensions of the saved files.

## How it works

- The background is kept in its own canvas and is never modified. Drawing happens on a separate transparent layer.
- The history is stored as vector operations (type, color, width, points) rather than pixels, so it stays small and Undo simply replays the remaining operations onto the layer. The eraser is an operation too, using the `destination-out` blend mode on the drawing layer.
- Zoom and pan are a scale and offset applied when the canvas is rendered. Pointer events handle mouse, touch and pen uniformly.
- Local storage keys: `markup.bg` (the original background as a JPEG data URL; frames added with Resize frame and the Resize background scaling are replayed from the operation list), `markup.ops` (operation list) and `markup.prefs` (color and widths) `markup.settings` (language and default new-image size) `markup.snapshots` (the snapshots list: name, date and the compressed operations) and `markup.names` (last file names used for Save JPEG and Export status; forgotten when the canvas is cleared or replaced).

## Limitations

- A fill is stored as a seed point plus a tolerance and recomputed when the history is replayed (Undo, reload, import). Fills on large images can take a fraction of a second, and Undo is slower the more fills there are. A drawn boundary must be closed: a gap, even a single pixel wide, lets the fill leak out.
- Local storage is limited to a few MB per site, so very large images may not be saved. The app shows a message if saving fails.
- Work is stored per browser and per device; it is not synced anywhere.
- Exported images are JPEG only, so there is no transparency.

## Browser support

Developed for Chrome (desktop and Android). It uses standard APIs (canvas, pointer events, service workers) and should also work in current Firefox, Edge and Safari, though those have been tested less.

## License

Add a license of your choice (for example MIT) before publishing.
