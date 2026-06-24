import { getLocalStorageItem, setLocalStorageItem } from "./utils";

// ---------------------------------------------------------------------------
// Built-in theme presets
// Catppuccin mapping: foreground=Text, background=Base, gray=Surface0,
//   darkGray=Surface1, gridDot=Overlay0
// ---------------------------------------------------------------------------

const BUILTIN_THEMES = [
  {
    name: "Light",
    builtin: true,
    foreground: "#000000",
    background: "#ffffff",
    gray: "rgba(0, 0, 0, 0.05)",
    darkGray: "rgba(0, 0, 0, 0.25)",
    gridDot: "rgba(0, 0, 0, 0.5)"
  },
  {
    name: "Dark",
    builtin: true,
    foreground: "#ffffff",
    background: "#000000",
    gray: "rgba(255, 255, 255, 0.1)",
    darkGray: "rgba(255, 255, 255, 0.1)",
    gridDot: "rgba(255, 255, 255, 0.4)"
  },
  {
    name: "Catppuccin Latte",
    builtin: true,
    foreground: "#4c4f69",
    background: "#eff1f5",
    gray: "#ccd0da",
    darkGray: "#bcc0cc",
    gridDot: "#9ca0b0"
  },
  {
    name: "Catppuccin Frappé",
    builtin: true,
    foreground: "#c6d0f5",
    background: "#303446",
    gray: "#414559",
    darkGray: "#51576d",
    gridDot: "#737994"
  },
  {
    name: "Catppuccin Macchiato",
    builtin: true,
    foreground: "#cad3f5",
    background: "#24273a",
    gray: "#363a4f",
    darkGray: "#494d64",
    gridDot: "#6e738d"
  },
  {
    name: "Catppuccin Mocha",
    builtin: true,
    foreground: "#cdd6f4",
    background: "#1e1e2e",
    gray: "#313244",
    darkGray: "#45475a",
    gridDot: "#6c7086"
  },
  {
    name: "Dracula",
    builtin: true,
    foreground: "#f8f8f2",
    background: "#282a36",
    gray: "#44475a",
    darkGray: "#6272a4",
    gridDot: "#6272a4"
  },
  {
    name: "Nord",
    builtin: true,
    foreground: "#d8dee9",
    background: "#2e3440",
    gray: "#3b4252",
    darkGray: "#434c5e",
    gridDot: "#4c566a"
  },
  {
    name: "Tokyo Night",
    builtin: true,
    foreground: "#c0caf5",
    background: "#1a1b26",
    gray: "#292e42",
    darkGray: "#414868",
    gridDot: "#565f89"
  },
  {
    name: "Gruvbox Dark",
    builtin: true,
    foreground: "#ebdbb2",
    background: "#282828",
    gray: "#3c3836",
    darkGray: "#504945",
    gridDot: "#665c54"
  },
  {
    name: "Gruvbox Light",
    builtin: true,
    foreground: "#3c3836",
    background: "#fbf1c7",
    gray: "#ebdbb2",
    darkGray: "#d5c4a1",
    gridDot: "#bdae93"
  },
  {
    name: "Solarized Dark",
    builtin: true,
    foreground: "#839496",
    background: "#002b36",
    gray: "#073642",
    darkGray: "#586e75",
    gridDot: "#657b83"
  },
  {
    name: "Solarized Light",
    builtin: true,
    foreground: "#657b83",
    background: "#fdf6e3",
    gray: "#eee8d5",
    darkGray: "#93a1a1",
    gridDot: "#839496"
  },
  {
    name: "Rosé Pine",
    builtin: true,
    foreground: "#e0def4",
    background: "#191724",
    gray: "#1f1d2e",
    darkGray: "#26233a",
    gridDot: "#6e6a86"
  }
];

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let userThemes = [];
let activeThemeName = "Light";
let previousThemeName = null;
let onThemeApplied = null; // callback for canvas redraw

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidColor(str) {
  if (!str || typeof str !== "string") return false;
  // Accept hex, rgb(), rgba(), hsl(), hsla(), and named CSS colors
  return CSS.supports("color", str.trim());
}

function validateTheme(theme) {
  const errors = [];
  if (!theme.name || typeof theme.name !== "string" || !theme.name.trim()) {
    errors.push("Missing or empty name");
  }
  for (const field of ["foreground", "background", "gray", "darkGray", "gridDot"]) {
    if (!isValidColor(theme[field])) {
      errors.push(`Invalid color for "${field}": ${theme[field]}`);
    }
  }
  return errors;
}

function normalizeTheme(theme) {
  return {
    name: theme.name.trim(),
    foreground: theme.foreground.trim(),
    background: theme.background.trim(),
    gray: theme.gray.trim(),
    darkGray: theme.darkGray.trim(),
    gridDot: theme.gridDot.trim(),
    builtin: theme.builtin || false
  };
}

function findThemeByName(name) {
  const all = getAllThemes();
  return all.find((t) => t.name === name) || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load themes from storage, merge built-ins, resolve active theme.
 * Call once on app startup.
 * @returns {string} The resolved active theme name
 */
export async function initThemes() {
  let stored;

  try {
    stored = await getLocalStorageItem("manifest_themes");
  } catch (_) {
    stored = null;
  }

  if (stored && stored.userThemes && Array.isArray(stored.userThemes)) {
    userThemes = stored.userThemes.filter(
      (t) => t && t.name && !BUILTIN_THEMES.some((b) => b.name === t.name)
    );
    activeThemeName = stored.activeTheme || "Light";
  } else {
    // First launch or corrupted — seed with empty user themes
    userThemes = [];

    // Migration: if old manifest_theme exists, use it
    try {
      const oldPref = await getLocalStorageItem("manifest_theme");
      if (oldPref === "dark") {
        activeThemeName = "Dark";
      } else if (oldPref === "light") {
        activeThemeName = "Light";
      }
    } catch (_) {
      // No old preference — detect OS
    }

    // If no saved preference at all, detect OS
    if (
      !activeThemeName &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      activeThemeName = "Dark";
    }

    await persistThemes();
  }

  // Ensure active theme actually exists
  if (!findThemeByName(activeThemeName)) {
    activeThemeName = "Light";
  }

  return activeThemeName;
}

/**
 * Persist current state to storage.
 */
async function persistThemes() {
  await setLocalStorageItem("manifest_themes", {
    userThemes: userThemes,
    activeTheme: activeThemeName
  });
  // Also keep manifest_theme for backward compat
  await setLocalStorageItem("manifest_theme", activeThemeName);
}

/**
 * Apply a theme: set CSS custom properties and notify callback.
 */
/**
 * Strip alpha from a CSS color, returning the opaque hex equivalent.
 */
function toOpaqueHex(color) {
  // Already a hex without alpha
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return "#" + color.slice(1, 7);
  // rgb() or rgba() — extract r,g,b, ignore alpha
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, "0");
    const g = parseInt(m[2]).toString(16).padStart(2, "0");
    const b = parseInt(m[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return color; // fallback
}

export function applyTheme(name) {
  const theme = findThemeByName(name);
  if (!theme) return false;

  const root = document.documentElement;
  root.style.setProperty("--foreground", theme.foreground);
  root.style.setProperty("--background", theme.background);
  // --surface is always the opaque version of --background, for UI chrome
  root.style.setProperty("--surface", toOpaqueHex(theme.background));
  root.style.setProperty("--gray", theme.gray);
  root.style.setProperty("--dark-gray", theme.darkGray);

  previousThemeName = activeThemeName;
  activeThemeName = name;

  // Persist the active choice (fire-and-forget)
  persistThemes();

  // Notify for grid redraw etc.
  if (onThemeApplied) onThemeApplied();

  return true;
}

/**
 * Register a callback invoked after every applyTheme().
 */
export function setOnThemeApplied(fn) {
  onThemeApplied = fn;
}

/**
 * Get the active theme object (includes gridDot).
 */
export function getActiveTheme() {
  return findThemeByName(activeThemeName) || findThemeByName("Light");
}

/**
 * Get active theme name.
 */
export function getActiveThemeName() {
  return activeThemeName;
}

/**
 * Get all available themes (built-ins first, then user-created).
 */
export function getAllThemes() {
  return [...BUILTIN_THEMES, ...userThemes];
}

/**
 * Toggle between current and previously-used theme (Alt+T).
 * On first call with no previous, toggles Light↔Dark.
 */
export function toggleLastTheme() {
  let target;
  if (previousThemeName && findThemeByName(previousThemeName)) {
    target = previousThemeName;
  } else {
    target = activeThemeName === "Light" ? "Dark" : "Light";
  }
  applyTheme(target);
}

/**
 * Add a user-created theme.
 * @returns {{ success: boolean, errors?: string[] }}
 */
export async function addTheme(theme) {
  const errors = validateTheme(theme);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Check for duplicate name (including built-ins)
  if (findThemeByName(theme.name.trim())) {
    return { success: false, errors: [`A theme named "${theme.name.trim()}" already exists.`] };
  }

  const normalized = normalizeTheme(theme);
  userThemes.push(normalized);
  await persistThemes();

  // Immediately activate the new theme
  applyTheme(normalized.name);

  return { success: true };
}

/**
 * Edit a user-created theme by name.
 * @returns {{ success: boolean, errors?: string[] }}
 */
export async function editTheme(name, updates) {
  const idx = userThemes.findIndex((t) => t.name === name);
  if (idx === -1) {
    return { success: false, errors: ["Theme not found or is built-in."] };
  }

  const merged = { ...userThemes[idx], ...updates, builtin: false };
  const errors = validateTheme(merged);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // If name changed, check no collision
  if (updates.name && updates.name.trim() !== name) {
    if (findThemeByName(updates.name.trim())) {
      return { success: false, errors: [`A theme named "${updates.name.trim()}" already exists.`] };
    }
    // Update active reference if the renamed theme was active
    if (activeThemeName === name) {
      activeThemeName = updates.name.trim();
    }
  }

  userThemes[idx] = normalizeTheme(merged);
  await persistThemes();

  // Re-apply if this was the active theme
  if (activeThemeName === userThemes[idx].name) {
    applyTheme(activeThemeName);
  }

  return { success: true };
}

/**
 * Delete a user-created theme by name.
 * @returns {{ success: boolean, errors?: string[] }}
 */
export async function deleteTheme(name) {
  const idx = userThemes.findIndex((t) => t.name === name);
  if (idx === -1) {
    return { success: false, errors: ["Theme not found or is built-in."] };
  }

  userThemes.splice(idx, 1);

  // Fall back to Light if the deleted theme was active
  if (activeThemeName === name) {
    activeThemeName = "Light";
    applyTheme("Light");
  }

  await persistThemes();
  return { success: true };
}

/**
 * Duplicate a theme (built-in or user) as a new user preset.
 * @returns {{ success: boolean, errors?: string[], newName?: string }}
 */
export async function duplicateTheme(name) {
  const source = findThemeByName(name);
  if (!source) {
    return { success: false, errors: ["Source theme not found."] };
  }

  // Generate a unique copy name
  let copyName = `${source.name} (copy)`;
  let suffix = 2;
  while (findThemeByName(copyName)) {
    copyName = `${source.name} (copy ${suffix})`;
    suffix++;
  }

  const copy = normalizeTheme({ ...source, name: copyName, builtin: false });
  userThemes.push(copy);
  await persistThemes();
  applyTheme(copyName);

  return { success: true, newName: copyName };
}

/**
 * Export all user-created themes as a JSON string.
 */
export function exportUserThemes() {
  return JSON.stringify(userThemes, null, 2);
}

/**
 * Import themes from a JSON string.
 * @returns {{ added: number, skipped: number, errors: string[] }}
 */
export async function importThemes(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return { added: 0, skipped: 0, errors: [`Invalid JSON: ${e.message}`] };
  }

  const themes = Array.isArray(parsed) ? parsed : [parsed];
  const result = { added: 0, skipped: 0, errors: [] };

  for (const theme of themes) {
    const errors = validateTheme(theme);
    if (errors.length > 0) {
      result.errors.push(`"${theme.name || "(unnamed)"}" skipped: ${errors.join("; ")}`);
      result.skipped++;
      continue;
    }

    // Check for duplicate name
    if (findThemeByName(theme.name.trim())) {
      result.errors.push(`"${theme.name.trim()}" skipped: name already exists.`);
      result.skipped++;
      continue;
    }

    userThemes.push(normalizeTheme(theme));
    result.added++;
  }

  if (result.added > 0) {
    await persistThemes();
  }

  return result;
}
