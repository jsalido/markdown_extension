// Content scripts can't read file:// directories (fetch has no file: support
// and file pages have opaque origins), so directory listings are read by an
// offscreen document, which as an extension page can XHR file:// URLs once
// "Allow access to file URLs" is enabled.

let offscreenReady = null;

function ensureOffscreen() {
  offscreenReady ??= (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Read and parse file:// directory listings.",
    });
  })().catch((err) => {
    offscreenReady = null;
    throw err;
  });
  return offscreenReady;
}

async function listDir(url) {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "md-list-dir",
      url,
    });
  } catch (err) {
    // The offscreen document may have been closed; recreate it next time.
    offscreenReady = null;
    throw err;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "md-list-dir" || msg.target) return;
  if (typeof msg.url !== "string" || !/^file:\/\/.*\/$/.test(msg.url)) {
    sendResponse({ error: "Only file:// directory URLs are supported" });
    return;
  }
  listDir(msg.url).then(sendResponse, (err) =>
    sendResponse({ error: String(err) })
  );
  return true;
});
