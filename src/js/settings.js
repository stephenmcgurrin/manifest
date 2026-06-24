import {
  getAllThemes,
  getActiveThemeName,
  applyTheme,
  addTheme,
  editTheme,
  deleteTheme,
  duplicateTheme,
  exportUserThemes,
  importThemes
} from "./themes";
import { confirm } from "./utils";

// ---------------------------------------------------------------------------
// DOM references (set after createSettingsPopup)
// ---------------------------------------------------------------------------

let backdrop, panel, themeList, formView;

// ---------------------------------------------------------------------------
// Create the popup DOM once, hidden, on first call
// ---------------------------------------------------------------------------

export function createSettingsPopup() {
  if (backdrop) return; // already created

  // Backdrop
  backdrop = document.createElement("div");
  backdrop.setAttribute("id", "settings-backdrop");
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeSettings();
  });

  // Panel
  panel = document.createElement("div");
  panel.setAttribute("id", "settings-panel");

  // Header
  const header = document.createElement("h2");
  header.textContent = "Settings";
  panel.appendChild(header);

  // ---- Theme list view ----
  themeList = document.createElement("div");
  themeList.setAttribute("id", "theme-list");
  panel.appendChild(themeList);

  // ---- Add / Edit form (hidden by default) ----
  formView = document.createElement("div");
  formView.setAttribute("id", "theme-form-view");
  formView.style.display = "none";
  panel.appendChild(formView);

  // ---- Action buttons ----
  const actions = document.createElement("div");
  actions.setAttribute("id", "settings-actions");

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add Theme";
  addBtn.addEventListener("click", showAddForm);
  actions.appendChild(addBtn);

  const importBtn = document.createElement("button");
  importBtn.textContent = "Import";
  importBtn.addEventListener("click", handleImport);
  actions.appendChild(importBtn);

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", handleExport);
  actions.appendChild(exportBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeSettings);
  actions.appendChild(closeBtn);

  panel.appendChild(actions);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

export function openSettings() {
  createSettingsPopup();
  showListView();
  backdrop.style.display = "flex";
}

export function closeSettings() {
  if (backdrop) backdrop.style.display = "none";
}

// ---------------------------------------------------------------------------
// Theme list view
// ---------------------------------------------------------------------------

function showListView() {
  formView.style.display = "none";
  themeList.style.display = "block";
  renderThemeList();
}

function renderThemeList() {
  themeList.innerHTML = "";

  const themes = getAllThemes();
  const activeName = getActiveThemeName();

  if (themes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "theme-empty";
    empty.textContent = "No themes available.";
    themeList.appendChild(empty);
    return;
  }

  for (const theme of themes) {
    const card = document.createElement("div");
    card.className = "theme-card";

    // Color swatch
    const swatch = document.createElement("span");
    swatch.className = "theme-swatch";
    swatch.style.backgroundColor = theme.background;
    swatch.style.borderColor = theme.foreground;
    card.appendChild(swatch);

    // Name
    const nameEl = document.createElement("span");
    nameEl.className = "theme-name";
    nameEl.textContent = theme.name;
    if (theme.name === activeName) {
      nameEl.classList.add("active");
      nameEl.textContent += " ✓";
    }
    card.appendChild(nameEl);

    // Badge
    if (theme.builtin) {
      const badge = document.createElement("span");
      badge.className = "theme-badge";
      badge.textContent = "built-in";
      card.appendChild(badge);
    }

    // Buttons
    const btns = document.createElement("span");
    btns.className = "theme-actions";

    if (theme.name !== activeName) {
      const useBtn = document.createElement("button");
      useBtn.textContent = "Use";
      useBtn.addEventListener("click", function () {
        applyTheme(theme.name);
        renderThemeList();
      });
      btns.appendChild(useBtn);
    }

    if (theme.builtin) {
      // Duplicate instead of edit
      const dupBtn = document.createElement("button");
      dupBtn.textContent = "Duplicate";
      dupBtn.addEventListener("click", async function () {
        await duplicateTheme(theme.name);
        renderThemeList();
      });
      btns.appendChild(dupBtn);
    } else {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        showEditForm(theme);
      });
      btns.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async function () {
        const ok = await confirm(
          `Delete theme "${theme.name}"? This cannot be undone.`
        );
        if (ok) {
          await deleteTheme(theme.name);
          renderThemeList();
        }
      });
      btns.appendChild(delBtn);
    }

    card.appendChild(btns);
    themeList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

let editingName = null; // null = adding, string = editing

function buildForm(theme) {
  formView.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = editingName ? `Edit "${editingName}"` : "New Theme";
  formView.appendChild(title);

  const form = document.createElement("form");
  form.setAttribute("id", "theme-form");

  const fields = [
    { name: "name", label: "Name", type: "text", placeholder: "My Theme" },
    { name: "foreground", label: "Foreground", type: "color" },
    { name: "background", label: "Background", type: "color" },
    { name: "gray", label: "Gray (subtle)", type: "color" },
    { name: "darkGray", label: "Dark Gray (borders)", type: "color" },
    { name: "gridDot", label: "Grid Dot", type: "color" }
  ];

  for (const field of fields) {
    const row = document.createElement("div");
    row.className = "form-row";

    const label = document.createElement("label");
    label.textContent = field.label;
    row.appendChild(label);

    // Tauri/webView on macOS doesn't always render <input type="color">
    // well, so we pair a color input with a text input for the hex value.
    const wrapper = document.createElement("span");
    wrapper.className = "color-input-wrapper";

    if (field.type === "color") {
      const storedVal = theme ? theme[field.name] || "#000000" : "#000000";

      // Parse stored value into hex + opacity
      let hex = "#000000";
      let opacity = 100;
      const rgbaMatch = storedVal.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (rgbaMatch) {
        const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, "0");
        const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, "0");
        const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, "0");
        hex = `#${r}${g}${b}`;
        opacity = rgbaMatch[4] ? Math.round(parseFloat(rgbaMatch[4]) * 100) : 100;
      } else if (storedVal.startsWith("#")) {
        hex = storedVal;
        opacity = 100;
      }

      // Color picker
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.name = field.name;
      colorInput.value = CSS.supports("color", hex) ? hex : "#000000";
      wrapper.appendChild(colorInput);

      // Opacity slider
      const opacityWrapper = document.createElement("span");
      opacityWrapper.className = "opacity-slider-wrapper";

      const opacityLabel = document.createElement("span");
      opacityLabel.className = "opacity-label";
      opacityLabel.textContent = opacity + "%";
      opacityWrapper.appendChild(opacityLabel);

      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.name = field.name + "_opacity";
      opacitySlider.min = "0";
      opacitySlider.max = "100";
      opacitySlider.value = opacity;
      opacitySlider.className = "opacity-slider";
      opacitySlider.addEventListener("input", function () {
        opacityLabel.textContent = opacitySlider.value + "%";
      });
      opacityWrapper.appendChild(opacitySlider);

      wrapper.appendChild(opacityWrapper);
    } else {
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.name = field.name;
      textInput.value = theme ? theme[field.name] || "" : "";
      textInput.placeholder = field.placeholder || "";
      wrapper.appendChild(textInput);
    }

    row.appendChild(wrapper);
    form.appendChild(row);
  }

  // Error display
  const errorEl = document.createElement("div");
  errorEl.className = "form-errors";
  errorEl.style.display = "none";
  form.appendChild(errorEl);

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.className = "form-buttons";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Save";
  btnRow.appendChild(submitBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", showListView);
  btnRow.appendChild(cancelBtn);

  form.appendChild(btnRow);

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorEl.style.display = "none";
    errorEl.textContent = "";

    // Combine color picker + opacity slider into rgba or hex
    const colorFields = ["foreground", "background", "gray", "darkGray", "gridDot"];
    const data = { name: form.elements.name.value.trim() };
    for (const f of colorFields) {
      const hex = form.elements[f] ? form.elements[f].value.trim() : "#000000";
      const opacityEl = form.elements[f + "_opacity"];
      const opacity = opacityEl ? parseInt(opacityEl.value, 10) : 100;
      if (opacity === 100) {
        data[f] = hex;
      } else {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        data[f] = `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
      }
    }

    let result;
    if (editingName) {
      result = await editTheme(editingName, data);
    } else {
      result = await addTheme(data);
    }

    if (!result.success) {
      errorEl.style.display = "block";
      errorEl.textContent = result.errors.join("\n");
      return;
    }

    editingName = null;
    showListView();
  });

  formView.appendChild(form);
}

function showAddForm() {
  editingName = null;
  formView.style.display = "block";
  themeList.style.display = "none";
  buildForm(null);
}

function showEditForm(theme) {
  editingName = theme.name;
  formView.style.display = "block";
  themeList.style.display = "none";
  buildForm(theme);
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

async function handleExport() {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const json = exportUserThemes();

  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        title: "Export Themes",
        defaultPath: "manifest-themes.json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (path) {
        await writeTextFile(path, json);
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed: " + err.message);
    }
  } else {
    // Browser fallback: download as file
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "manifest-themes.json";
    a.click();
    URL.revokeObjectURL(url);
  }
}

async function handleImport() {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  let contents;

  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const selected = await open({
        title: "Import Themes",
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false
      });
      if (!selected) return;
      contents = await readTextFile(selected);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed: " + err.message);
      return;
    }
  } else {
    // Browser fallback: file input
    contents = await new Promise(function (resolve, reject) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = function () {
        const file = input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsText(file);
      };
      input.click();
    });
    if (!contents) return;
  }

  const result = await importThemes(contents);

  let msg = `Import complete.\n\nAdded: ${result.added}\nSkipped: ${result.skipped}`;
  if (result.errors.length > 0) {
    msg += `\n\nDetails:\n${result.errors.join("\n")}`;
  }
  alert(msg);

  // Refresh the list
  if (formView.style.display === "none") {
    renderThemeList();
  }
}
