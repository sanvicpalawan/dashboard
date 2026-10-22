import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./responsive.css";

export const metadata: Metadata = {
  title: { default: "Palawan Collective Command Center", template: "%s · Palawan Collective" },
  description: "Self-hosted agency operating system for Palawan Collective and merQato.digital: clients, projects, websites, finance, automation and dashboards.",
  applicationName: "Palawan Collective Command Center",
  authors: [{ name: "Palawan Collective", url: "https://merqato.digital" }],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0c10" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
