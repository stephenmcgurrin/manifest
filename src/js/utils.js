import { GRID_SIZE } from "./globals";

// Async storage layer. Names kept (setLocalStorageItem/getLocalStorageItem) to
// minimise call-site churn — they now wrap Tauri fs in desktop and localStorage in browser.
// Writes are synchronous-per-call: the file is ~1 KB and writeTextFile is microseconds,
// so the prior debounce/quit-flush dance was not worth its complexity.

// eslint 6's browser globals list predates structuredClone; it is present in
// every Tauri webview, and the browser path never reaches it.
/* global structuredClone */

const DATA_FILE = "manifest-data.json";
let initPromise = null;
let isTauri = false;
let cache = {};
let fsApi = null;
let baseDir = null;

function detectTauri() {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window);
}

async function loadFromDisk() {
  const { readTextFile, mkdir, writeTextFile, exists, BaseDirectory } = fsApi;
  baseDir = BaseDirectory.AppData;

  // mkdir with recursive:true is idempotent; no need for a separate existence probe.
  await mkdir("", { baseDir, recursive: true });

  const fileExists = await exists(DATA_FILE, { baseDir });
  if (!fileExists) {
    cache = {};
    await writeTextFile(DATA_FILE, JSON.stringify(cache), { baseDir });
    return;
  }

  try {
    const raw = await readTextFile(DATA_FILE, { baseDir });
    cache = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("Failed to read manifest-data.json, resetting.", err);
    cache = {};
  }
}

export function initStorage() {
  if (initPromise) { return initPromise; }
  initPromise = (async function () {
    isTauri = detectTauri();
    if (isTauri) {
      fsApi = await import("@tauri-apps/plugin-fs");
      await loadFromDisk();
    }
  })();
  return initPromise;
}

export async function setLocalStorageItem(item, value) {
  if (!initPromise) { await initStorage(); } else { await initPromise; }
  if (isTauri) {
    // Clone in as well as out. The cache must own its values outright, or a
    // caller that keeps the object it wrote (themes.js keeps userThemes) goes
    // on mutating the cache in place after the write has been serialised.
    cache[item] = structuredClone(value);
    try {
      await fsApi.writeTextFile(DATA_FILE, JSON.stringify(cache), { baseDir });
    } catch (err) {
      console.error("Failed to persist manifest-data.json", err);
    }
    return;
  }
  return window.localStorage.setItem(`${item}`, JSON.stringify(value));
}

export async function getLocalStorageItem(item) {
  if (!initPromise) { await initStorage(); } else { await initPromise; }
  if (isTauri) {
    // Hand back a copy, never the cache entry itself: the browser path returns a
    // fresh object from JSON.parse and callers mutate what they are given.
    return item in cache ? structuredClone(cache[item]) : null;
  }
  return JSON.parse(window.localStorage.getItem(item));
}

export async function confirm(text) {
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return await ask(text, { title: "Manifest", kind: "warning" });
  }
  return window.confirm(text);
};

export function snapToGrid(value, grid) {
  return (grid) * Math.round(value / (grid));
};

export function checkBounds(parent, child) {
  let bounds = null;

  if (parent.top > child.top) { bounds = { edge: "top", offset: 0 }; }
  if (parent.left > child.left) { bounds = { edge: "left", offset: 0 }; }
  if ((parent.top + parent.height) < (child.top + child.height)) { bounds = { edge: "bottom", offset: snapToGrid(parent.height - child.height, GRID_SIZE) }; }
  if ((parent.left + parent.width) < (child.left + child.width)) { bounds = { edge: "right", offset: snapToGrid(parent.width - child.width, GRID_SIZE) }; }

  return bounds;
};

export function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0; var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export function decreaseAllMemoIndexes() {
  const memos = document.getElementsByClassName("memo");
  for (const memo of memos) {
    let index = memo.style.zIndex;
    memo.style.zIndex = --index;
  }
};
