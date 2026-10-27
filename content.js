(function () {
  "use strict";

  // Chrome shows raw text files as a document whose body is a single <pre>.
  // If that's not what we have, this URL is a real HTML page that merely
  // ends in .md — leave it alone.
  const pre = document.body && document.body.firstElementChild;
  if (
    !pre ||
    pre.tagName !== "PRE" ||
    document.body.children.length !== 1 ||
    document.contentType === "text/html"
  ) {
    return;
  }

  const source = pre.textContent;

  // GitHub renders .md files without turning single newlines into <br>.
  marked.use({
    gfm: true,
    breaks: false,
  });

  const rawHtml = marked.parse(source);

  // Sanitize with DOMPurify (allowlist-based, handles URL obfuscation and
  // SVG/MathML tricks) before anything touches the live DOM. <style> and
  // forms are dropped too, as on GitHub, so a document can't restyle or
  // spoof the reader UI.
  const doc = new DOMParser().parseFromString(
    DOMPurify.sanitize(rawHtml, { FORBID_TAGS: ["style", "form"] }),
    "text/html"
  );

  // Turn ```mermaid code blocks into placeholders that mermaid renders once
  // the content is in the live DOM (it needs layout to measure text).
  // Each diagram sits in a frame so its zoom toolbar stays put while the
  // diagram itself scrolls.
  doc.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
    const frame = document.createElement("div");
    frame.className = "mermaid-frame";
    const diagram = document.createElement("div");
    diagram.className = "mermaid";
    diagram.textContent = code.textContent;
    frame.appendChild(diagram);
    code.parentElement.replaceWith(frame);
  });

  // Add ids to headings so #fragment links work.
  const usedIds = new Set();
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.id) return;
    // Same rules as GitHub: keep letters (any script), digits, "-" and "_".
    let base = h.textContent
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    if (!base) base = "heading";
    let id = base;
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    h.id = id;
  });

  // Build the rendered page.
  const container = document.createElement("article");
  container.className = "markdown-body";
  container.append(...doc.body.childNodes);

  document.body.classList.add("markdown-reader");

  // Chrome's plain-text page has no viewport meta; add one so the layout
  // scales correctly on narrow/mobile-width screens.
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.appendChild(viewport);

  // Use the first heading (or filename) as the tab title.
  const firstHeading = container.querySelector("h1, h2");
  document.title = firstHeading
    ? firstHeading.textContent.trim()
    : decodeURIComponent(location.pathname.split("/").pop());

  // Toggle between rendered and raw views — via the corner button or "r" key.
  let showingRaw = false;
  const rawPre = document.createElement("pre");
  rawPre.className = "markdown-raw";
  rawPre.textContent = source;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "markdown-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "Raw";
  toggleBtn.title = 'Toggle raw markdown source (shortcut: "r")';

  function showView() {
    document.body.textContent = "";
    document.body.appendChild(showingRaw ? rawPre : container);
    document.body.appendChild(toggleBtn);
    if (tree) document.body.append(tree.panel, tree.button);
    toggleBtn.textContent = showingRaw ? "Rendered" : "Raw";
  }

  function toggleView() {
    showingRaw = !showingRaw;
    showView();
  }

  toggleBtn.addEventListener("click", toggleView);
  document.addEventListener("keydown", (e) => {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      document.activeElement !== document.body
    ) {
      return;
    }
    if (e.key === "r") toggleView();
    else if (e.key === "t" && tree) tree.setOpen(!tree.isOpen());
  });

  // Collapsible side panel listing the markdown files in this file's
  // directory, plus subdirectories that (eventually) contain markdown.
  // Filled in asynchronously once the directory scan finishes; stays null
  // when the directory can't be listed (e.g. remote servers without an index).
  let tree = null;

  showView();

  buildTree()
    .then((t) => {
      if (!t) return;
      tree = t;
      document.body.append(tree.panel, tree.button);
    })
    .catch((err) => console.debug("markdown tree:", err));

  async function buildTree() {
    const MD_RE = /\.(md|markdown|mdown|mkd)$/i;
    const README_RE = /^readme\.(md|markdown|mdown|mkd)$/i;
    const SKIP_DIRS = new Set(["node_modules"]);
    const MAX_DEPTH = 6;
    const MAX_DIRS = 300;

    const dirUrl = new URL(".", location.href);
    dirUrl.search = dirUrl.hash = "";
    const currentPath = decodeURIComponent(location.pathname);
    const currentDirPath = decodeURIComponent(dirUrl.pathname);

    // True for directories on the way from the tree root down to this file;
    // they're never skipped and start expanded.
    const leadsToCurrent = (url) =>
      currentDirPath.startsWith(decodeURIComponent(new URL(url).pathname));

    // List one directory as [{name, url, isDir}].
    async function listDir(url) {
      if (url.startsWith("file:")) {
        const res = await chrome.runtime.sendMessage({ type: "md-list-dir", url });
        if (!res || res.error) throw new Error(res ? res.error : "no response");
        return res.entries.map((e) => ({
          name: e.name,
          isDir: e.isDir,
          url: new URL(e.href + (e.isDir && !e.href.endsWith("/") ? "/" : ""), url).href,
        }));
      }

      // Remote: only works where the server serves an HTML index page
      // (Apache/nginx autoindex, python -m http.server, ...).
      const res = await fetch(url, { credentials: "same-origin" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("text/html")) {
        throw new Error(`No directory index at ${url}`);
      }
      const base = new URL(url);
      const html = new DOMParser().parseFromString(await res.text(), "text/html");
      const seen = new Set();
      const entries = [];
      for (const a of html.querySelectorAll("a[href]")) {
        let u;
        try {
          u = new URL(a.getAttribute("href"), base);
        } catch {
          continue;
        }
        if (u.origin !== base.origin || u.search || u.hash) continue;
        if (!u.pathname.startsWith(base.pathname)) continue;
        const m = u.pathname.slice(base.pathname.length).match(/^([^/]+)(\/?)$/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        entries.push({
          name: decodeURIComponent(m[1]),
          isDir: m[2] === "/",
          url: u.href,
        });
      }
      return entries;
    }

    // Recursively collect markdown files under rootUrl; drop directories
    // without any. Throws if rootUrl itself can't be listed.
    async function scanTree(rootUrl) {
      const state = { budget: MAX_DIRS, truncated: false };
      const root = await scan(rootUrl, 0, state);
      return { root, truncated: state.truncated };
    }

    async function scan(url, depth, state) {
      let entries;
      try {
        entries = await listDir(url);
      } catch (err) {
        if (depth === 0) throw err;
        return null;
      }
      const files = [];
      const subdirs = [];
      for (const e of entries) {
        if (e.isDir) {
          const skip = e.name.startsWith(".") || SKIP_DIRS.has(e.name);
          if (!skip || leadsToCurrent(e.url)) subdirs.push(e);
        } else if (e.name.startsWith(".")) {
          continue;
        } else if (MD_RE.test(e.name)) {
          files.push(e);
        }
      }

      let dirs = [];
      if (depth < MAX_DEPTH) {
        const results = await Promise.all(
          subdirs.map((d) => {
            if (state.budget <= 0) {
              state.truncated = true;
              return null;
            }
            state.budget--;
            return scan(d.url, depth + 1, state);
          })
        );
        dirs = subdirs
          .map((d, i) => results[i] && { name: d.name, url: d.url, ...results[i] })
          .filter((d) => d && (d.files.length || d.dirs.length));
      } else if (subdirs.length) {
        state.truncated = true;
      }

      // README always first, then alphabetical.
      const byName = (a, b) =>
        README_RE.test(b.name) - README_RE.test(a.name) ||
        a.name.localeCompare(b.name, undefined, { numeric: true });
      files.sort(byName);
      dirs.sort(byName);
      const readme = files.find((f) => README_RE.test(f.name));
      return { files, dirs, readme };
    }

    const initial = await scanTree(dirUrl.href);

    function renderList(node) {
      const ul = document.createElement("ul");
      ul.className = "md-tree-list";
      for (const dir of node.dirs) {
        const li = document.createElement("li");
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.className = "md-tree-dir";
        summary.title = dir.name;
        // A folder with a README opens it when its name is clicked; the
        // chevron (or the row outside the name) still expands/collapses.
        const name = document.createElement(dir.readme ? "a" : "span");
        name.className = "md-tree-dir-name";
        name.textContent = dir.name;
        if (dir.readme) {
          name.href = dir.readme.url;
          name.title = `Open ${dir.name}/${dir.readme.name}`;
        }
        summary.appendChild(name);
        details.open = leadsToCurrent(dir.url);
        details.append(summary, renderList(dir));
        li.appendChild(details);
        ul.appendChild(li);
      }
      for (const file of node.files) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "md-tree-file";
        a.href = file.url;
        a.textContent = file.name;
        a.title = file.name;
        if (decodeURIComponent(new URL(file.url).pathname) === currentPath) {
          a.classList.add("is-current");
          a.setAttribute("aria-current", "page");
        }
        li.appendChild(a);
        ul.appendChild(li);
      }
      return ul;
    }

    const panel = document.createElement("nav");
    panel.className = "md-tree";
    panel.setAttribute("aria-label", "Markdown files in this directory");

    const header = document.createElement("div");
    header.className = "md-tree-header";
    const makeHeaderButton = (text, label, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "md-tree-btn";
      btn.textContent = text;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", onClick);
      return btn;
    };
    const upBtn = makeHeaderButton("↑", "Show parent folder", () =>
      showRoot(new URL("..", rootUrl).href, { openReadme: true })
    );
    // An <a> so it can link to the folder's README; without an href it's
    // plain text.
    const title = document.createElement("a");
    title.className = "md-tree-title";
    const homeBtn = makeHeaderButton(
      "⌂",
      "Back to this file's folder",
      () => showRoot(dirUrl.href)
    );
    const closeBtn = makeHeaderButton(
      "×",
      'Hide file tree (shortcut: "t")',
      () => setOpen(false)
    );
    closeBtn.classList.add("md-tree-close");
    header.append(upBtn, title, homeBtn, closeBtn);

    const body = document.createElement("div");
    body.className = "md-tree-body";
    panel.append(header, body);

    function addNote(text) {
      const note = document.createElement("p");
      note.className = "md-tree-note";
      note.textContent = text;
      body.appendChild(note);
    }

    // Show the tree rooted at rootUrl (this file's folder or an ancestor).
    let rootUrl = dirUrl.href;
    let rootToken = 0;
    function render(url, { root, truncated }) {
      rootUrl = url;
      const path = decodeURIComponent(new URL(url).pathname);
      title.textContent = path.split("/").filter(Boolean).pop() || "/";
      title.title = path;
      if (root.readme) {
        title.href = root.readme.url;
        title.title = `Open ${path}${root.readme.name}`;
      } else {
        title.removeAttribute("href");
      }
      upBtn.disabled = path === "/";
      homeBtn.hidden = url === dirUrl.href;
      body.textContent = "";
      body.appendChild(renderList(root));
      if (truncated) addNote("Some deeply nested folders were not scanned.");
      body.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
    }

    // With openReadme, a folder that has a README opens it (the new page
    // shows that folder's tree) instead of just re-rooting the panel.
    async function showRoot(url, { openReadme = false } = {}) {
      const token = ++rootToken;
      panel.setAttribute("aria-busy", "true");
      try {
        const result = await scanTree(url);
        if (token !== rootToken) return;
        const readme = result.root.readme;
        const isCurrent =
          readme && decodeURIComponent(new URL(readme.url).pathname) === currentPath;
        if (openReadme && readme && !isCurrent) {
          location.href = readme.url;
          return;
        }
        render(url, result);
      } catch (err) {
        if (token !== rootToken) return;
        console.debug("markdown tree:", err);
        body.querySelector(".md-tree-note.is-error")?.remove();
        addNote("Couldn't read that folder.");
        body.lastElementChild.classList.add("is-error");
      } finally {
        if (token === rootToken) panel.removeAttribute("aria-busy");
      }
    }

    render(dirUrl.href, initial);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-tree-toggle";
    button.textContent = "Files";
    button.title = 'Show markdown files in this folder (shortcut: "t")';

    // Keep focus on the body so the keyboard shortcuts keep working.
    for (const el of [button, upBtn, homeBtn, closeBtn]) {
      el.addEventListener("mousedown", (e) => e.preventDefault());
    }

    const isOpen = () => document.body.classList.contains("md-tree-open");
    const setOpen = (open) => {
      document.body.classList.toggle("md-tree-open", open);
      button.setAttribute("aria-expanded", String(open));
      chrome.storage.local.set({ treeOpen: open }).catch(() => {});
    };
    button.addEventListener("click", () => setOpen(true));

    let stored;
    try {
      stored = (await chrome.storage.local.get("treeOpen")).treeOpen;
    } catch {}
    // On narrow screens the panel overlays the page, so always start closed.
    const open = innerWidth >= 900 && (stored ?? innerWidth >= 1100);
    document.body.classList.toggle("md-tree-open", open);
    button.setAttribute("aria-expanded", String(open));

    return { panel, button, isOpen, setOpen };
  }

  // Render mermaid diagrams. "strict" keeps diagram labels from running
  // scripts or embedding raw HTML, matching the sanitizer above.
  if (container.querySelector(".mermaid")) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "default",
    });
    const diagrams = container.querySelectorAll(".mermaid");
    mermaid
      .run({ nodes: diagrams })
      .catch((err) => console.error("mermaid:", err))
      .then(() => diagrams.forEach(makeZoomable));
  }

  // Zoom controls for a rendered diagram: toolbar buttons, Ctrl/Cmd+wheel
  // (which is also what trackpad pinch sends), and drag-to-pan when zoomed.
  // Scale is relative to the diagram's natural size; null means "fit", i.e.
  // mermaid's own sizing (full width, capped at natural size).
  function makeZoomable(viewport) {
    const svg = viewport.querySelector("svg");
    const box = svg && svg.viewBox.baseVal;
    if (!box || !box.width || !box.height) return;

    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 5;
    const ZOOM_STEP = 1.25;
    const fitStyle = svg.getAttribute("style") || "";
    const fitHeight = svg.getAttribute("height");
    let scale = null;

    const toolbar = document.createElement("div");
    toolbar.className = "mermaid-zoom";
    const makeButton = (text, title, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.addEventListener("click", onClick);
      return btn;
    };
    const label = document.createElement("span");
    label.className = "mermaid-zoom-level";
    toolbar.append(
      makeButton("\u2212", "Zoom out", () => zoomBy(1 / ZOOM_STEP)),
      label,
      makeButton("+", "Zoom in", () => zoomBy(ZOOM_STEP)),
      makeButton("Fit", "Fit to width", fit)
    );
    // Keep focus on the body so the "r" shortcut keeps working after a click.
    toolbar.addEventListener("mousedown", (e) => e.preventDefault());
    viewport.parentElement.appendChild(toolbar);

    const currentScale = () =>
      scale ?? svg.getBoundingClientRect().width / box.width;

    function updateLabel() {
      label.textContent = `${Math.round(currentScale() * 100)}%`;
    }

    // Resize the svg, keeping the point under (clientX, clientY) fixed.
    function setScale(next, clientX, clientY) {
      next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      const before = svg.getBoundingClientRect();
      const fx = (clientX - before.left) / before.width;
      const fy = (clientY - before.top) / before.height;

      scale = next;
      viewport.classList.add("is-zoomed");
      svg.removeAttribute("height");
      svg.style.maxWidth = "none";
      svg.style.width = `${box.width * scale}px`;
      svg.style.height = `${box.height * scale}px`;

      const after = svg.getBoundingClientRect();
      viewport.scrollLeft += after.left + fx * after.width - clientX;
      viewport.scrollTop += after.top + fy * after.height - clientY;
      updateLabel();
    }

    function zoomBy(factor) {
      const r = viewport.getBoundingClientRect();
      setScale(
        currentScale() * factor,
        r.left + r.width / 2,
        r.top + Math.min(r.height, innerHeight - r.top) / 2
      );
    }

    function fit() {
      scale = null;
      viewport.classList.remove("is-zoomed");
      svg.setAttribute("style", fitStyle);
      if (fitHeight !== null) svg.setAttribute("height", fitHeight);
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      updateLabel();
    }

    viewport.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const delta = Math.max(-20, Math.min(20, e.deltaY));
        setScale(currentScale() * Math.exp(-delta * 0.01), e.clientX, e.clientY);
      },
      { passive: false }
    );

    let pan = null;
    viewport.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || scale === null) return;
      pan = {
        x: e.clientX,
        y: e.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("is-panning");
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!pan) return;
      viewport.scrollLeft = pan.left - (e.clientX - pan.x);
      viewport.scrollTop = pan.top - (e.clientY - pan.y);
    });
    const endPan = () => {
      pan = null;
      viewport.classList.remove("is-panning");
    };
    viewport.addEventListener("pointerup", endPan);
    viewport.addEventListener("pointercancel", endPan);

    addEventListener("resize", () => scale === null && updateLabel());
    updateLabel();
  }

  // Honor an incoming #fragment now that ids exist and content is in the DOM.
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
})();
