export type WidgetItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
  url?: string;
  progress?: number;
  value?: string;
};

export type WidgetData = {
  kind: "metric" | "list" | "table" | "board" | "series" | "health" | "notes" | "links" | "image" | "embed" | "state";
  value?: string;
  label?: string;
  secondary?: string;
  items?: WidgetItem[];
  columns?: { key: string; label: string }[];
  rows?: Record<string, string>[];
  groups?: { title: string; items: WidgetItem[] }[];
  series?: { label: string; value: number; secondary?: number }[];
  text?: string;
  imageUrl?: string;
  embedUrl?: string;
  state?: "empty" | "disconnected" | "error" | "loading";
  message?: string;
  source?: string;
  fetchedAt?: string;
  stale?: boolean;
  demo?: boolean;
};

export type DashboardWidgetDTO = {
  id: string;
  dashboardId: string;
  definitionKey: string;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
  refreshInterval: number;
  visible: boolean;
  enabled: boolean;
  userConfigurable: boolean;
  settings: Record<string, unknown>;
};

export type DashboardDTO = {
  id: string;
  name: string;
  slug: string;
  description: string;
  audience: string;
  status: string;
  isDefault: boolean;
  allowCustomization: boolean;
  version: number;
  teamId: string | null;
  ownerId: string | null;
  updatedAt: string;
};
