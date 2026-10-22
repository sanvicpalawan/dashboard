"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
export function AdminNav({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) { const pathname = usePathname(); const active = href === "/admin" ? pathname === href : pathname.startsWith(href); return <Link href={href} className={cn(active && "active")}>{icon}{label}</Link>; }
