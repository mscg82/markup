# Markup

A serverless, client-side web app for drawing over an image. Open a picture, annotate it with lines, rectangles and circles, erase mistakes, and export the result as a JPEG. Everything runs in the browser: there is no backend, and your work is stored in the browser's local storage.

It works on laptops and on mobile browsers (Chrome is the primary target) and can be installed to the home screen and used offline.

## Features

- **Background image:** load any image; it is used as an unmodifiable background. Images larger than 2400 px on the long side are downscaled so they fit in browser storage.
- **Drawing tools:** freehand pen, plus a **Shapes** menu with straight line, rectangle and circle (the circle is dragged from the center outward). The Shapes button shows the icon of the shape you picked last.
- **Color and width:** a built-in custom color picker (it looks the same in every browser) plus 16 quick-select swatches, and a width slider. The pen, line and shape tools share one width setting; the eraser has its own.
- **Eraser:** removes only your drawing, never the background.
- **Undo and redo:** every stroke or shape is an operation in a history list. Undo (or Ctrl/Cmd+Z) removes the last one and Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y) puts it back. The redo list is emptied as soon as you draw something new, and it is not saved between sessions.
- **Clear:** a click clears the drawing and keeps the background; a long press (about 0.7 s) removes the background too. Both ask for confirmation, and neither can be undone.
- **Zoom and pan:** mouse wheel, pinch, or the −, Fit and + buttons to zoom. To pan, use the Move tool, two fingers, Space + drag, the right or middle mouse button, or the arrow keys.
- **Main menu (☰):** *New* offers *Open image* and *Empty image* (you choose the width and height, up to 2400 px, and the background color; white by default). *Save JPEG* asks for a file name and downloads the background and drawing merged at the background's full resolution. *Export status* asks for a file name and downloads a JSON file with the background, the full list of operations and the saved settings (color and widths). *Import status* restores such a file, for example on another device.
- **Persistence:** the background, the full operation list, the selected color and the tool widths are saved automatically and restored on reopening.
- **Installable and offline:** a web app manifest and a service worker let you add the app to the home screen and use it without a connection.

## Project structure

```
index.html              page markup
css/style.css           styles
js/markup.js            the application logic
js/colorpicker.js       custom color picker (same look in every browser; also used by the new-image dialog)
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
- To publish a new version, change the `CACHE` name at the top of `sw.js` (for example `markup-v13`) so installed copies drop the old files. Also update `APP_VERSION` at the top of `js/markup.js` so the version label shown in the bottom-right corner of the app matches.

### GitHub Pages

1. Push the files to a repository.
2. In **Settings → Pages**, choose the branch and the root folder.
3. Open the published URL.

## How it works

- The background is kept in its own canvas and is never modified. Drawing happens on a separate transparent layer.
- The history is stored as vector operations (type, color, width, points) rather than pixels, so it stays small and Undo simply replays the remaining operations onto the layer. The eraser is an operation too, using the `destination-out` blend mode on the drawing layer.
- Zoom and pan are a scale and offset applied when the canvas is rendered. Pointer events handle mouse, touch and pen uniformly.
- Local storage keys: `markup.bg` (background as a JPEG data URL), `markup.ops` (operation list) and `markup.prefs` (color and widths) and `markup.names` (last file names used for Save JPEG and Export status; forgotten when the canvas is cleared or replaced).

## Limitations

- Local storage is limited to a few MB per site, so very large images may not be saved. The app shows a message if saving fails.
- Work is stored per browser and per device; it is not synced anywhere.
- Exported images are JPEG only, so there is no transparency.

## Browser support

Developed for Chrome (desktop and Android). It uses standard APIs (canvas, pointer events, service workers) and should also work in current Firefox, Edge and Safari, though those have been tested less.

## License

Add a license of your choice (for example MIT) before publishing.
