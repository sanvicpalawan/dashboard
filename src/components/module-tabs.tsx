"use client";

import { useState } from "react";
import { ResourceModule } from "@/components/resource-module";
import type { SessionUser } from "@/lib/permissions";
import { MODULES } from "@/lib/module-config";
import { cn } from "@/lib/utils";

export function ModuleTabs({ user, tabs, defaultTab, title, eyebrow, description }: { user: SessionUser; tabs: string[]; defaultTab: string; title: string; eyebrow: string; description: string }) {
  const [active, setActive] = useState(defaultTab);
  return <><div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-description">{description}</p></div><div className="heading-actions"><div className="segmented">{tabs.map((tab) => <button key={tab} className={cn(active === tab && "active")} onClick={() => setActive(tab)}>{MODULES[tab].title}</button>)}</div></div></div><ResourceModule key={active} resource={active} user={user} embedded /></>;
}
