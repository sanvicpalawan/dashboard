import { redirect } from "next/navigation";
import { ensureBootstrap } from "@/db/bootstrap";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { BRAND_LINE, BRAND_LOCKUP_SRC } from "@/components/brand-logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await ensureBootstrap();
  if (await getCurrentUser()) redirect("/");
  const demo = process.env.DEMO_MODE !== "false";
  return <main className="login-page">
    <section className="login-brand-panel" aria-label="Palawan Collective brand">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND_LOCKUP_SRC} alt="Palawan Collective" width={942} height={596} />
        <div className="login-brand-line">{BRAND_LINE} · Agency operating system</div>
      </div>
      <div className="login-positioning"><div className="eyebrow">Build once, run the whole agency</div><h1>One workspace.<br /><span>Every client, project and peso.</span></h1><p>Clients, delivery, websites, pricing, finance and automation for a digital agency rooted in Palawan. Self-hosted, database-backed and ours end to end.</p></div>
      <div className="login-foot">Palawan Collective · merQato.digital · Puerto Princesa, Palawan</div>
    </section>
    <section className="login-form-panel"><LoginForm demo={demo} /></section>
  </main>;
}
