/**
 * Semantic design tokens for the Coordina ADG mobile app.
 *
 * These values are converted from the sibling web artifact's index.css HSL
 * variables to hex so both artifacts share the same visual identity:
 *  - primary  : institutional blue (215 100% 35%)
 *  - secondary: Canarias gold (45 100% 50%)
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#1b2232",
    tint: "#0050b3",

    // Core surfaces
    background: "#fbfaf9",
    foreground: "#1b2232",

    // Cards / elevated surfaces
    card: "#ffffff",
    cardForeground: "#1b2232",

    // Primary action color (buttons, links, active states)
    primary: "#0050b3",
    primaryForeground: "#ffffff",

    // Secondary / Canarias gold accent
    secondary: "#ffbf00",
    secondaryForeground: "#1b2232",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#f0f2f4",
    mutedForeground: "#627084",

    // Accent highlights (badges, selected items, focus rings)
    accent: "#e9eef6",
    accentForeground: "#0050b3",

    // Destructive actions (delete, error states)
    destructive: "#ef4444",
    destructiveForeground: "#ffffff",

    // Positive / success states
    success: "#16a34a",

    // Borders and input outlines
    border: "#e2e5e9",
    input: "#e2e5e9",
  },

  dark: {
    text: "#f0f2f4",
    tint: "#3b82f6",

    background: "#121721",
    foreground: "#f0f2f4",

    card: "#171e2b",
    cardForeground: "#f0f2f4",

    primary: "#2f7ff0",
    primaryForeground: "#ffffff",

    secondary: "#e6ac00",
    secondaryForeground: "#1b2232",

    muted: "#1d2533",
    mutedForeground: "#94a0b0",

    accent: "#1f2c40",
    accentForeground: "#9cc2ff",

    destructive: "#f87171",
    destructiveForeground: "#ffffff",

    success: "#22c55e",

    border: "#243042",
    input: "#243042",
  },

  // Border radius (in px). Synced from web --radius (0.75rem = 12px).
  radius: 12,
};

export default colors;
