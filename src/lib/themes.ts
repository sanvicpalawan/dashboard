export type ThemePreset = {
  name: string;
  slug: string;
  description: string;
  mode: "dark" | "light";
  colors: Record<string, string>;
  typography: string;
  density: "compact" | "comfortable";
  cardStyle: "bordered" | "soft" | "flat";
  sidebarStyle: "solid" | "contrast" | "floating";
  isDefault?: boolean;
};

export const THEME_PRESETS: ThemePreset[] = [
  { name: "MerQato Midnight", slug: "merqato-midnight", description: "Dark neutral surfaces with an electric periwinkle accent.", mode: "dark", colors: { background: "#0b0c10", surface: "#12141a", elevated: "#191c24", text: "#f1f2f5", muted: "#9197a8", border: "#272b35", accent: "#91a0ff", accentText: "#0b0c10" }, typography: "inter", density: "comfortable", cardStyle: "bordered", sidebarStyle: "solid", isDefault: true },
  { name: "Palawan Dusk", slug: "palawan-dusk", description: "Deep ocean neutrals, sea-glass highlights and warm text.", mode: "dark", colors: { background: "#091211", surface: "#101b19", elevated: "#172522", text: "#edf4f0", muted: "#8da49b", border: "#263a34", accent: "#68d6b2", accentText: "#07110e" }, typography: "inter", density: "comfortable", cardStyle: "soft", sidebarStyle: "contrast" },
  { name: "Studio Paper", slug: "studio-paper", description: "Warm light canvas with crisp ink and cobalt details.", mode: "light", colors: { background: "#f4f3ef", surface: "#ffffff", elevated: "#fafaf8", text: "#202127", muted: "#71727b", border: "#dfdfd9", accent: "#4f61d9", accentText: "#ffffff" }, typography: "inter", density: "comfortable", cardStyle: "bordered", sidebarStyle: "solid" },
  { name: "Limestone", slug: "limestone", description: "A bright mineral palette with dense, practical data surfaces.", mode: "light", colors: { background: "#eef0f1", surface: "#f9faf9", elevated: "#ffffff", text: "#202728", muted: "#697476", border: "#d6dcdd", accent: "#167c72", accentText: "#ffffff" }, typography: "inter", density: "compact", cardStyle: "flat", sidebarStyle: "contrast" },
  { name: "Graphite Signal", slug: "graphite-signal", description: "Compact graphite workspace with a precise amber signal color.", mode: "dark", colors: { background: "#11100f", surface: "#191816", elevated: "#22201d", text: "#f3f0e9", muted: "#9d968a", border: "#332f2a", accent: "#e3b45c", accentText: "#17120a" }, typography: "inter", density: "compact", cardStyle: "flat", sidebarStyle: "solid" },
  { name: "Orchid Mono", slug: "orchid-mono", description: "Cool monochrome with a restrained orchid accent for reviews.", mode: "dark", colors: { background: "#0e0d12", surface: "#16151c", elevated: "#1e1c26", text: "#f2eff7", muted: "#9a93a6", border: "#2c2936", accent: "#c4a1ed", accentText: "#150d1d" }, typography: "mono", density: "comfortable", cardStyle: "soft", sidebarStyle: "floating" },
];

export function themeVariables(theme: Partial<ThemePreset> & { colors?: Record<string, string> }, accent?: string | null) {
  const colors = theme.colors ?? THEME_PRESETS[0].colors;
  return {
    "--bg": colors.background ?? THEME_PRESETS[0].colors.background,
    "--surface": colors.surface ?? THEME_PRESETS[0].colors.surface,
    "--elevated": colors.elevated ?? THEME_PRESETS[0].colors.elevated,
    "--text": colors.text ?? THEME_PRESETS[0].colors.text,
    "--muted": colors.muted ?? THEME_PRESETS[0].colors.muted,
    "--border": colors.border ?? THEME_PRESETS[0].colors.border,
    "--accent": accent || colors.accent || THEME_PRESETS[0].colors.accent,
    "--accent-text": colors.accentText ?? "#ffffff",
  } as React.CSSProperties;
}
