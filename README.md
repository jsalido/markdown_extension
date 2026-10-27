# Markdown Reader

A Chrome extension that renders Markdown files (`.md`, `.markdown`, `.mdown`, `.mkd`) as styled HTML instead of plain text. GitHub-flavored markdown, automatic dark mode, and clickable heading anchors.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this folder.
4. On the extension's card, click **Details** and enable **Allow access to file URLs** — required for local `.md` files.

## Use

Open any markdown file in Chrome — drag a `.md` file into a tab, or press `Cmd+O` and pick one. Remote markdown files (raw URLs ending in `.md`) render too.

- Click the **Raw** button in the top-right corner (or press <kbd>r</kbd>) to toggle between the rendered view and the raw source.
- `#heading` fragment links work: headings get GitHub-style ids.
- The tab title becomes the document's first heading.
- The **Files** panel (top-left button, or press <kbd>t</kbd>) shows a collapsible tree of the markdown files in the current file's folder, plus any subfolders that contain markdown (up to 6 levels deep; hidden folders and `node_modules` are skipped). The current file is highlighted; click any file to open it. A folder's README is always listed first, and clicking the name of a folder that has a README opens it (click the arrow to just expand the folder). Open/closed state is remembered. Use **↑** in the panel header to go to the parent folder: if it has a README, that README opens; otherwise the tree just moves up a level (repeat to keep going up). The folder name in the header also links to its README; the folders leading back to the current file open automatically, and **⌂** returns to the current file's folder.
- Zoom mermaid diagrams with the toolbar that appears on hover (−, +, **Fit**), or with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + scroll or a trackpad pinch over the diagram. Drag to pan when zoomed in.

## Features

- GitHub-flavored markdown via [marked](https://github.com/markedjs/marked) (tables, task lists, strikethrough, autolinks)
- Mermaid diagrams: ```` ```mermaid ```` code blocks render as SVG ([mermaid](https://github.com/mermaid-js/mermaid), strict security level)
- Light/dark theme follows the system preference
- Sanitized output: scripts, iframes, event handlers, and `javascript:` links are stripped before rendering
- File tree panel for local folders, and for remote folders whose server publishes an HTML directory index
- Leaves real HTML pages alone even if their URL ends in `.md`

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | Detects raw markdown pages, renders and sanitizes them, builds the file tree panel |
| `background.js` | Service worker that relays `file://` directory listing requests |
| `offscreen.html` / `offscreen.js` | Offscreen page that reads and parses `file://` directory listings |
| `marked.min.js` | Bundled markdown parser (marked v12) |
| `mermaid.min.js` | Bundled diagram renderer (mermaid v12) |
| `styles.css` | GitHub-style theme, light and dark |
