import { redirect } from "next/navigation";
import { ensureBootstrap } from "@/db/bootstrap";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await ensureBootstrap();
  if (await getCurrentUser()) redirect("/");
  const demo = process.env.DEMO_MODE !== "false";
  return <main className="login-page">
    <section className="login-brand-panel" aria-label="MerQato brand">
      <div className="brand"><div className="brand-mark">MQ</div><div className="brand-copy"><div className="brand-name">MerQato.digital</div><div className="brand-sub">BY PALAWAN COLLECTIVE</div></div></div>
      <div className="login-positioning"><div className="eyebrow">Agency operating system</div><h1>Local businesses.<br /><span>Distinct digital worlds.</span></h1><p>Thoughtful websites and digital systems for ambitious businesses. Rooted in Palawan. Made to work anywhere.</p></div>
      <div className="login-foot">One considered system for clients, delivery, infrastructure and commercial operations.</div>
    </section>
    <section className="login-form-panel"><LoginForm demo={demo} /></section>
  </main>;
}
