import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./responsive.css";

export const metadata: Metadata = {
  title: { default: "MerQato Command Center", template: "%s · MerQato" },
  description: "The self-hosted agency operating system for Palawan Collective + MerQato.digital.",
  applicationName: "MerQato Command Center",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0c10" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
