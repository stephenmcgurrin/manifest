import { GRID_SIZE, MARGIN, DRAG_INDEX, STATIC_INDEX } from "./globals";
import { snapToGrid, confirm, generateUUID, getLocalStorageItem, setLocalStorageItem, decreaseAllMemoIndexes, checkBounds, initStorage } from "./utils";
import {
  initThemes,
  getActiveTheme,
  applyTheme,
  toggleLastTheme,
  setOnThemeApplied
} from "./themes";

import "../sass/index.scss";

let activeMemo;

let main, canvas, board, selection;
let currentMouse, currentSize;
let footerHeight = 0;

// Per-interaction drag state. dragMemo / resizeMemo double as the idempotency
// guard for their cleanup path, exactly as `selection` does for the board drag
// (issue #9). activeMemo cannot serve that role because the textarea focus
// handler reassigns it during cleanup.
let dragMemo, dragOrigin, dragDelta;
let resizeMemo, pendingSize;
let pendingSelection;
let pendingFrame = null;
let closeLatch = null;
let closeInFlight = false;

/*
  Generic Event Handlers
*/

// Board selection uses Pointer Events + pointer capture so a lost native
// mouseup (see issue #7) cannot strand the #selection box.
function onPointerDown(e) {
  if (e.target === board) {
    handleBoardDragStart(e);
  }
};

// Pointer moves arrive faster than a transparent window can be composited, so
// every drag records its geometry and defers the DOM write to a single
// animation frame instead of writing once per event (issue #4). Only one drag
// can be live at a time — pointer capture guarantees it — so one slot is enough.
function scheduleRender(render) {
  if (pendingFrame !== null) { return; }

  pendingFrame = requestAnimationFrame(function () {
    pendingFrame = null;
    render();
  });
};

function cancelRender() {
  if (pendingFrame !== null) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
};

/*
  Memo Functions and Handlers
*/

function createMemo(id, text, position, size) {
  const memo = document.createElement("div");
  memo.setAttribute("data-id", id);
  memo.classList.add("memo");
  memo.style.top = `${position.top}px`;
  memo.style.left = `${position.left}px`;
  memo.style.width = `${size.width}px`;
  memo.style.height = `${size.height}px`;
  memo.style.zIndex = STATIC_INDEX;

  const textarea = document.createElement("textarea");
  textarea.classList.add("input");
  textarea.setAttribute("placeholder", "Add a short memo...");
  textarea.setAttribute("autocomplete", true);

  if (text) { textarea.value = text; }

  textarea.addEventListener("focus", function (e) {
    e.target.classList.add("active");

    decreaseAllMemoIndexes();

    activeMemo = e.target.parentNode;
    activeMemo.style.zIndex = STATIC_INDEX;
  });
  textarea.addEventListener("blur", function (e) { e.target.classList.remove("active"); }, { passive: false, useCapture: false });
  textarea.addEventListener("input", async function (e) {
    const memos = await getLocalStorageItem("manifest_memos");
    memos[id] = { ...memos[id], text: e.target.value };
    await setLocalStorageItem("manifest_memos", memos);
  }, { passive: false, useCapture: false });

  memo.appendChild(textarea);

  // Pointer Events throughout: one stream for mouse and touch, and pointer
  // capture on the handle so a mouseup the OS drops cannot strand the gesture
  // or leave the control inert (issues #9, #10).
  const drag = document.createElement("div");
  drag.classList.add("drag");
  drag.addEventListener("pointerdown", handleMemoDragStart, { passive: false, useCapture: false });
  memo.appendChild(drag);

  const close = document.createElement("div");
  close.classList.add("close");
  close.innerHTML = "–";
  close.addEventListener("pointerdown", handleMemoCloseStart, { passive: false, useCapture: false });
  memo.appendChild(close);

  const resize = document.createElement("div");
  resize.classList.add("resize");
  resize.addEventListener("pointerdown", handleMemoResizeStart, { passive: false, useCapture: false });
  memo.appendChild(resize);

  return memo;
};

function handleMemoDragStart(e) {
  // Primary pointer / left button only; e.which is deprecated and never set on
  // pointer events (issue #9).
  if (e.button > 0 || !e.isPrimary) { return; }

  // Prevent the native drag/selection so the pointer stream stays with us.
  e.preventDefault();
  // Capture guarantees pointerup/pointercancel are delivered to the handle even
  // if the OS swallows the native mouseup mid-drag (issue #9, same defect as #7).
  e.target.setPointerCapture(e.pointerId);

  decreaseAllMemoIndexes();

  activeMemo = e.target.parentNode;
  activeMemo.classList.add("active");
  activeMemo.style.zIndex = STATIC_INDEX;

  dragMemo = activeMemo;

  const textarea = activeMemo.querySelectorAll(".input")[0];
  textarea.blur();

  e.target.style.backgroundColor = "var(--gray)";
  e.target.style.cursor = "grabbing";

  document.body.style.cursor = "grabbing";

  const x = snapToGrid(e.clientX, GRID_SIZE);
  const y = snapToGrid(e.clientY, GRID_SIZE);

  currentMouse = { x, y };

  // The drag is driven by transform so the compositor moves an existing layer
  // rather than relaying out and repainting the board every frame (issue #4).
  // dragOrigin is the layout position the transform is measured from; the real
  // top/left — and therefore the stored coordinates — are written once on end.
  dragOrigin = { top: activeMemo.offsetTop, left: activeMemo.offsetLeft };
  dragDelta = { x: 0, y: 0 };

  // With capture active these fire on the handle for the captured pointer.
  e.target.addEventListener("pointermove", handleMemoDragMove, { passive: false, useCapture: false });
  e.target.addEventListener("pointerup", handleMemoDragEnd, { passive: false, useCapture: false });
  e.target.addEventListener("pointercancel", handleMemoDragEnd, { passive: false, useCapture: false });
  e.target.addEventListener("lostpointercapture", handleMemoDragEnd, { passive: false, useCapture: false });
};

function handleMemoDragMove(e) {
  // A racing end handler may already have finished the drag, and onResize()
  // clears currentMouse out from under a live one (issue #9).
  if (!dragMemo || !currentMouse) { return; }

  const x = snapToGrid(e.clientX, GRID_SIZE);
  const y = snapToGrid(e.clientY, GRID_SIZE);

  // Snapped deltas telescope, so total-from-origin equals the old per-frame sum.
  dragDelta = { x: x - currentMouse.x, y: y - currentMouse.y };

  scheduleRender(renderMemoDrag);
};

function renderMemoDrag() {
  if (!dragMemo) { return; }

  // translate3d, not translate: the stylesheet promotes memos with
  // translateZ(0) and an inline transform would otherwise drop that (issue #4).
  dragMemo.style.transform = `translate3d(${dragDelta.x}px, ${dragDelta.y}px, 0)`;
};

// Cursor, classes, listeners and capture teardown. Kept separate so it can run
// from a finally, ahead of the awaited storage writes (issue #9).
function endMemoDrag(memo, e) {
  const drag = memo.querySelectorAll(".drag")[0];

  drag.removeEventListener("pointermove", handleMemoDragMove, { passive: false, useCapture: false });
  drag.removeEventListener("pointerup", handleMemoDragEnd, { passive: false, useCapture: false });
  drag.removeEventListener("pointercancel", handleMemoDragEnd, { passive: false, useCapture: false });
  drag.removeEventListener("lostpointercapture", handleMemoDragEnd, { passive: false, useCapture: false });

  if (e && e.pointerId !== undefined && drag.hasPointerCapture(e.pointerId)) {
    drag.releasePointerCapture(e.pointerId);
  }

  // Drop the inline transform so the stylesheet's promotion applies again and
  // the memo sits at the layout position just committed (issue #4).
  memo.style.transform = "";
  memo.classList.remove("active");

  drag.style.cursor = "grab";
  drag.style.backgroundColor = "transparent";

  document.body.style.cursor = null;

  const textarea = memo.querySelectorAll(".input")[0];
  textarea.focus();

  activeMemo = null;
  currentMouse = null;
  dragOrigin = null;
  dragDelta = null;
};

async function handleMemoDragEnd(e) {
  // pointerup, pointercancel and lostpointercapture all route here; guard so the
  // shared cleanup runs exactly once regardless of which arrives first (issue #9).
  if (!dragMemo) { return; }

  const memo = dragMemo;

  // A coalesced frame may still be pending; flush it so bounds are measured
  // against the box the user last saw (issue #4).
  renderMemoDrag();
  cancelRender();

  dragMemo = null;

  // Derived from what is on screen rather than from e.clientX/Y: pointercancel
  // and lostpointercapture carry no meaningful coordinates (issue #9).
  let top = dragOrigin.top + dragDelta.y;
  let left = dragOrigin.left + dragDelta.x;

  let id;

  try {
    const bounds = checkBounds(board.getBoundingClientRect(), memo.getBoundingClientRect());

    if (bounds) {
      if (bounds.edge === "top") {
        top = bounds.offset;
      } else if (bounds.edge === "bottom") {
        top = bounds.offset;
      } else if (bounds.edge === "left") {
        left = bounds.offset;
      } else if (bounds.edge === "right") {
        left = bounds.offset;
      }
    }

    // The one layout write of the drag, in the same coordinate space as before,
    // so manifest-data.json keeps its existing schema (issue #4).
    memo.style.top = `${top}px`;
    memo.style.left = `${left}px`;

    id = memo.dataset.id;
  } finally {
    endMemoDrag(memo, e);
  }

  const memos = await getLocalStorageItem("manifest_memos");
  memos[id] = { ...memos[id], position: { top, left } };
  await setLocalStorageItem("manifest_memos", memos);
};

// Latch the control on pointerdown and take capture, then act on whichever
// terminal event arrives first. pointerup alone is not enough — it is precisely
// the event this window loses, which is what left the control inert when it was
// bound to mouseup (issue #10) — so lostpointercapture is a second route into
// the same one-shot handler.
function handleMemoCloseStart(e) {
  if (e.button > 0 || !e.isPrimary || closeLatch) { return; }

  e.preventDefault();
  e.target.setPointerCapture(e.pointerId);

  closeLatch = e.target;

  e.target.addEventListener("pointerup", handleMemoClose, { passive: false, useCapture: false });
  e.target.addEventListener("pointercancel", handleMemoClose, { passive: false, useCapture: false });
  e.target.addEventListener("lostpointercapture", handleMemoClose, { passive: false, useCapture: false });
};

async function handleMemoClose(e) {
  // The latch makes the three routes above fire the dialog exactly once.
  if (closeLatch !== e.currentTarget) { return; }

  const close = closeLatch;
  closeLatch = null;

  close.removeEventListener("pointerup", handleMemoClose, { passive: false, useCapture: false });
  close.removeEventListener("pointercancel", handleMemoClose, { passive: false, useCapture: false });
  close.removeEventListener("lostpointercapture", handleMemoClose, { passive: false, useCapture: false });

  if (e.pointerId !== undefined && close.hasPointerCapture(e.pointerId)) {
    close.releasePointerCapture(e.pointerId);
  }

  // pointercancel means the gesture was taken over, not completed — abort.
  if (e.type === "pointercancel") { return; }

  // confirm() is a native Tauri dialog — asynchronous and non-blocking — so one
  // press must not be able to open a second one (issue #10).
  if (closeInFlight) { return; }
  closeInFlight = true;

  // Resolve the memo and its id before awaiting the dialog; the tree can change
  // while it is open (issue #10).
  const memo = close.parentNode;
  const id = memo.dataset.id;

  try {
    if (!await confirm("Are you sure you want to remove this memo?")) { return; }

    const memos = await getLocalStorageItem("manifest_memos");
    delete memos[id];
    await setLocalStorageItem("manifest_memos", memos);

    // removeChild throws NotFoundError if the node has already been detached.
    if (memo.isConnected) { memo.remove(); }
  } finally {
    closeInFlight = false;
  }
};

function handleMemoResizeStart(e) {
  // Primary pointer / left button only; e.which is deprecated and never set on
  // pointer events (issue #9).
  if (e.button > 0 || !e.isPrimary) { return; }

  // Prevent the native drag/selection so the pointer stream stays with us.
  e.preventDefault();
  // Capture guarantees pointerup/pointercancel are delivered to the handle even
  // if the OS swallows the native mouseup mid-drag (issue #9, same defect as #7).
  e.target.setPointerCapture(e.pointerId);

  decreaseAllMemoIndexes();

  activeMemo = e.target.parentNode;
  activeMemo.classList.add("active");
  activeMemo.style.zIndex = STATIC_INDEX;

  resizeMemo = activeMemo;

  const textarea = activeMemo.querySelectorAll(".input")[0];
  textarea.blur();

  document.body.style.cursor = "nw-resize";

  e.target.style.backgroundColor = "var(--gray)";

  const x = snapToGrid(e.clientX, GRID_SIZE);
  const y = snapToGrid(e.clientY, GRID_SIZE);

  const rect = activeMemo.getBoundingClientRect();
  const width = parseInt(rect.width, 10);
  const height = parseInt(rect.height, 10);

  currentMouse = { x, y };
  currentSize = { width, height };
  // Seeded with the zero-movement result the old end handler produced, so a
  // press-and-release with no move behaves exactly as it did.
  pendingSize = { width: width - 2, height: height - 2 };

  // With capture active these fire on the handle for the captured pointer.
  e.target.addEventListener("pointermove", handleMemoResizeMove, { passive: false, useCapture: false });
  e.target.addEventListener("pointerup", handleMemoResizeEnd, { passive: false, useCapture: false });
  e.target.addEventListener("pointercancel", handleMemoResizeEnd, { passive: false, useCapture: false });
  e.target.addEventListener("lostpointercapture", handleMemoResizeEnd, { passive: false, useCapture: false });
};

function handleMemoResizeMove(e) {
  // A racing end handler may already have finished the resize, and onResize()
  // clears currentMouse/currentSize out from under a live one (issue #9).
  if (!resizeMemo || !currentMouse || !currentSize) { return; }

  const x = snapToGrid(e.clientX, GRID_SIZE);
  const y = snapToGrid(e.clientY, GRID_SIZE);

  pendingSize = {
    width: (currentSize.width + (x - currentMouse.x)) - 2,
    height: (currentSize.height + (y - currentMouse.y)) - 2
  };

  scheduleRender(renderMemoResize);
};

// A resize genuinely changes layout size, so transform is no substitute here;
// coalescing to one write per frame is the mitigation available (issue #4).
function renderMemoResize() {
  if (!resizeMemo) { return; }

  resizeMemo.style.width = `${pendingSize.width}px`;
  resizeMemo.style.height = `${pendingSize.height}px`;
};

// Cursor, classes, listeners and capture teardown. Kept separate so it can run
// from a finally, ahead of the awaited storage writes (issue #9).
function endMemoResize(memo, e) {
  const resize = memo.querySelectorAll(".resize")[0];

  resize.removeEventListener("pointermove", handleMemoResizeMove, { passive: false, useCapture: false });
  resize.removeEventListener("pointerup", handleMemoResizeEnd, { passive: false, useCapture: false });
  resize.removeEventListener("pointercancel", handleMemoResizeEnd, { passive: false, useCapture: false });
  resize.removeEventListener("lostpointercapture", handleMemoResizeEnd, { passive: false, useCapture: false });

  if (e && e.pointerId !== undefined && resize.hasPointerCapture(e.pointerId)) {
    resize.releasePointerCapture(e.pointerId);
  }

  memo.classList.remove("active");

  resize.style.cursor = "nw-resize";
  resize.style.backgroundColor = "transparent";

  document.body.style.cursor = null;

  const textarea = memo.querySelectorAll(".input")[0];
  textarea.focus();

  activeMemo = null;
  currentMouse = null;
  currentSize = null;
  pendingSize = null;
};

async function handleMemoResizeEnd(e) {
  // pointerup, pointercancel and lostpointercapture all route here; guard so the
  // shared cleanup runs exactly once regardless of which arrives first (issue #9).
  if (!resizeMemo) { return; }

  const memo = resizeMemo;

  // A coalesced frame may still be pending; flush it so bounds are measured
  // against the box the user last saw (issue #4).
  renderMemoResize();
  cancelRender();

  resizeMemo = null;

  // Derived from what is on screen rather than from e.clientX/Y: pointercancel
  // and lostpointercapture carry no meaningful coordinates (issue #9).
  const width = pendingSize.width;
  const height = pendingSize.height;

  let id;

  try {
    const bounds = checkBounds(board.getBoundingClientRect(), memo.getBoundingClientRect());

    if (bounds) {
      let top = memo.offsetTop;
      let left = memo.offsetLeft;

      if (bounds.edge === "top") {
        top = bounds.offset;
      } else if (bounds.edge === "bottom") {
        top = bounds.offset;
      } else if (bounds.edge === "left") {
        left = bounds.offset;
      } else if (bounds.edge === "right") {
        left = bounds.offset;
      }

      memo.style.top = `${top}px`;
      memo.style.left = `${left}px`;
    }

    id = memo.dataset.id;
  } finally {
    endMemoResize(memo, e);
  }

  const memos = await getLocalStorageItem("manifest_memos");
  memos[id] = { ...memos[id], size: { width, height } };
  await setLocalStorageItem("manifest_memos", memos);
};

/*
  Board Functions and Handlers
*/

function handleBoardDragStart(e) {
  // Primary pointer / left button only; ignore right-click and secondary touches.
  if (e.button > 0 || !e.isPrimary) { return; }

  // Prevent the native drag/selection so the pointer stream stays with us.
  e.preventDefault();
  // Capture guarantees pointerup/pointercancel are delivered here even if the
  // OS swallows the native mouseup mid-drag.
  board.setPointerCapture(e.pointerId);

  // preventDefault suppresses the compatibility mousedown, so blur any focused
  // memo textarea explicitly to match handleMemoDragStart / handleMemoResizeStart.
  const focused = document.activeElement;
  if (focused && focused.classList.contains("input")) {
    focused.blur();
  }

  document.body.style.cursor = "crosshair";

  board.classList.add("active");

  const rect = board.getBoundingClientRect();
  const x = snapToGrid(e.clientX - rect.left, GRID_SIZE);
  const y = snapToGrid(e.clientY - rect.top, GRID_SIZE);

  currentMouse = { x, y };

  selection = document.createElement("div");
  selection.setAttribute("id", "selection");
  selection.style.zIndex = DRAG_INDEX;
  // The box is anchored at the board origin and moved by transform, so only its
  // size touches layout each frame (issue #4).
  selection.style.top = "0px";
  selection.style.left = "0px";

  pendingSelection = null;

  board.appendChild(selection);

  // With capture active these fire on the board for the captured pointer.
  board.addEventListener("pointermove", handleBoardDragMove, { passive: false, useCapture: false });
  board.addEventListener("pointerup", handleBoardDragEnd, { passive: false, useCapture: false });
  board.addEventListener("pointercancel", handleBoardDragEnd, { passive: false, useCapture: false });
  board.addEventListener("lostpointercapture", handleBoardDragEnd, { passive: false, useCapture: false });
};

function handleBoardDragMove(e) {
  if (!selection || !currentMouse) { return; }

  const rect = board.getBoundingClientRect();
  const x = snapToGrid(e.clientX - rect.left, GRID_SIZE);
  const y = snapToGrid(e.clientY - rect.top, GRID_SIZE);

  // Record only; the DOM write is coalesced into one frame (issue #4).
  pendingSelection = {
    top: (y - currentMouse.y < 0) ? y : currentMouse.y,
    left: (x - currentMouse.x < 0) ? x : currentMouse.x,
    width: Math.abs(x - currentMouse.x) + 1,
    height: Math.abs(y - currentMouse.y) + 1
  };

  scheduleRender(renderBoardDrag);
};

function renderBoardDrag() {
  if (!selection || !pendingSelection) { return; }

  // translate3d, not translate: the stylesheet promotes #selection with
  // translateZ(0) and an inline transform would otherwise drop that (issue #4).
  selection.style.transform = `translate3d(${pendingSelection.left}px, ${pendingSelection.top}px, 0)`;
  selection.style.width = `${pendingSelection.width}px`;
  selection.style.height = `${pendingSelection.height}px`;
};

async function handleBoardDragEnd(e) {
  // pointerup, pointercancel and lostpointercapture all route here; guard so the
  // shared cleanup runs exactly once regardless of which arrives first.
  if (!selection) { return; }

  const currentSelection = selection;

  // A coalesced frame may still be pending; flush it so the box we measure is
  // the box the user last saw (issue #4).
  renderBoardDrag();
  cancelRender();

  selection = null;
  pendingSelection = null;

  board.removeEventListener("pointermove", handleBoardDragMove, { passive: false, useCapture: false });
  board.removeEventListener("pointerup", handleBoardDragEnd, { passive: false, useCapture: false });
  board.removeEventListener("pointercancel", handleBoardDragEnd, { passive: false, useCapture: false });
  board.removeEventListener("lostpointercapture", handleBoardDragEnd, { passive: false, useCapture: false });

  if (e.pointerId !== undefined && board.hasPointerCapture(e.pointerId)) {
    board.releasePointerCapture(e.pointerId);
  }

  const boardRect = board.getBoundingClientRect();
  const selectionRect = currentSelection.getBoundingClientRect();

  const width = selectionRect.width - 2;
  const height = selectionRect.height - 2;

  let top = selectionRect.top - boardRect.top;
  let left = selectionRect.left - boardRect.left;

  // Cursor and box teardown happen here, before the awaited storage writes
  // below, so a throw in the storage path cannot strand either (issue #9).
  document.body.style.cursor = null;
  board.classList.remove("active");
  if (currentSelection.isConnected) { currentSelection.remove(); }

  const bounds = checkBounds(boardRect, selectionRect);

  if (bounds) {
    if (bounds.edge === "top") {
      top = bounds.offset;
    } else if (bounds.edge === "bottom") {
      top = bounds.offset;
    } else if (bounds.edge === "left") {
      left = bounds.offset;
    } else if (bounds.edge === "right") {
      left = bounds.offset;
    }
  }

  if (width >= 80 && height >= 80) {
    const id = generateUUID();
    const memo = createMemo(id, null, { top, left }, { width, height });
    board.appendChild(memo);

    const textarea = memo.querySelectorAll(".input")[0];
    textarea.focus();

    const memos = await getLocalStorageItem("manifest_memos");
    memos[id] = { text: null, position: { top, left }, size: { width, height } };
    await setLocalStorageItem("manifest_memos", memos);

    activeMemo = memo;
  }
};

/*
  App Functions
*/

async function handleTheme() {
  const activeName = await initThemes();
  applyTheme(activeName);
}

function onKeydown(e) {
  if ((e.code === "KeyT" || e.keyCode === 84) && e.altKey) {
    toggleLastTheme();
  }
}

function onResize() {
  const viewHeight = window.innerHeight - footerHeight;

  main.style.width = `${window.innerWidth}px`;
  main.style.height = `${viewHeight}px`;

  const width = (window.innerWidth - MARGIN) - 1;
  const height = (viewHeight - MARGIN) + 1;

  canvas.setAttribute("width", width);
  canvas.setAttribute("height", height);

  canvas.style.top = `${MARGIN / 2}px`;
  canvas.style.left = `${MARGIN / 2}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d");
  const gridDotColor = getActiveTheme().gridDot;

  for (let x = 0; x <= width; x += GRID_SIZE) {
    for (let y = 0; y <= height; y += GRID_SIZE) {
      context.fillStyle = gridDotColor;
      context.beginPath();
      context.rect(x, y, 1, 1);
      context.fill();
    }
  }

  board.style.top = `${MARGIN / 2}px`;
  board.style.left = `${MARGIN / 2}px`;
  board.style.width = `${width}px`;
  board.style.height = `${height}px`;

  currentMouse = null;
  currentSize = null;
};

async function onLoad() {
  await initStorage();
  await handleTheme();

  // Redraw canvas whenever theme changes
  setOnThemeApplied(() => onResize());

  main = document.createElement("main");
  main.setAttribute("id", "app");

  canvas = document.createElement("canvas");
  canvas.setAttribute("id", "grid");

  board = document.createElement("section");
  board.setAttribute("id", "board");

  board.addEventListener("pointerdown", onPointerDown, { passive: false, useCapture: false });

  main.appendChild(canvas);
  main.appendChild(board);
  document.body.appendChild(main);

  document.body.addEventListener("touchmove", function (event) {
    event.preventDefault();
  }, { passive: false, useCapture: false });

  const memos = await getLocalStorageItem("manifest_memos");
  if (memos) {
    for (const key of Object.keys(memos)) {
      const memo = createMemo(key, memos[key].text, memos[key].position, memos[key].size);
      board.appendChild(memo);
    }
  }

  const footer = document.createElement("footer");
  footer.setAttribute("id", "attribution");

  // Settings gear icon
  const gearIcon = document.createElement("span");
  gearIcon.setAttribute("id", "settings-gear");
  gearIcon.textContent = "\u2699";
  gearIcon.title = "Settings";
  gearIcon.addEventListener("click", async function (e) {
    e.stopPropagation();
    const { openSettings } = await import("./settings.js");
    openSettings();
  });
  footer.appendChild(gearIcon);

  const link1 = document.createElement("span");
  link1.className = "attribution-link";
  link1.dataset.url = "https://github.com/jonathontoon/manifest";
  link1.textContent = "Jonathon Toon";

  const link2 = document.createElement("span");
  link2.className = "attribution-link";
  link2.dataset.url = "https://github.com/stephenmcgurrin/manifest";
  link2.textContent = "Stephen McGurrin";

  footer.appendChild(document.createTextNode("Original creator: "));
  footer.appendChild(link1);
  footer.appendChild(document.createTextNode(" | Desktop GUI Wrapper: "));
  footer.appendChild(link2);

  footer.addEventListener("click", async function (e) {
    const link = e.target.closest(".attribution-link");
    if (link && link.dataset.url) {
      e.preventDefault();
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(link.dataset.url);
    }
  });

  document.body.appendChild(footer);
  footerHeight = 24;

  onResize();
};

window.addEventListener("resize", onResize);
window.addEventListener("load", onLoad);
window.addEventListener("keydown", onKeydown);
