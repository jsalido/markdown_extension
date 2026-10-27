// Reads a file:// directory and parses Chrome's generated listing page, which
// describes each entry as a script call:
//   addRow("name", "url-encoded-name", isDir, size, "size", date, "date");
// The arguments are JSON-quoted, so each call parses as a JSON array.

function get(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.onload = () => resolve(xhr.responseText);
    xhr.onerror = () => reject(new Error(`Cannot read ${url}`));
    xhr.send();
  });
}

function parseListing(html) {
  const entries = [];
  for (const [, args] of html.matchAll(/addRow\((.*)\);/g)) {
    let row;
    try {
      row = JSON.parse(`[${args}]`);
    } catch {
      continue;
    }
    const [name, href, isDir] = row;
    if (typeof name !== "string" || name === "." || name === "..") continue;
    entries.push({ name, href, isDir: Boolean(isDir) });
  }
  return entries;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "md-list-dir") return;
  get(msg.url).then(
    (html) => sendResponse({ entries: parseListing(html) }),
    (err) => sendResponse({ error: String(err) })
  );
  return true;
});
