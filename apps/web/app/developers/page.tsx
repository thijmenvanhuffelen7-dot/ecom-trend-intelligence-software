import Link from "next/link";
import { LogoMark } from "@/components/shell/logo";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { API_RATE_PER_MINUTE } from "@/server/api/auth";
import { openApiDocument } from "@/server/api/openapi";

export const metadata = { title: "API-documentatie", description: "Trendscope REST API v1: producten, winkels, trends en leads." };

type Param = { name: string; in: string; required?: boolean; description?: string };
type Op = { summary: string; description?: string; parameters?: Param[] };

/** Gegenereerd uit dezelfde OpenAPI-specificatie als /api/v1/openapi.json, zodat docs en API niet uit elkaar lopen. */
export default async function DevelopersPage() {
  const t = await getT();
  const session = await getSession();
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const doc = openApiDocument(base);
  const ops = Object.entries(doc.paths as Record<string, { get: Op }>).map(([path, v]) => ({ path, ...v.get }));
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex items-center justify-between border-b border-border px-8 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold"><LogoMark /> Trendscope <span className="font-normal text-fg-muted">/ API</span></Link>
        <Link href={session ? "/settings/api" : "/login"} className="text-sm font-medium text-fg-muted hover:text-fg">{session ? `${t("api.keys")} →` : "Login →"}</Link>
      </header>
      <main className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[220px_1fr]">
        <nav className="hidden text-sm lg:block" aria-label="API">
          <ul className="sticky top-6 space-y-1.5">
            <li><a href="#auth" className="text-fg-muted hover:text-fg">{t("developers.auth")}</a></li>
            <li><a href="#limits" className="text-fg-muted hover:text-fg">{t("developers.limits")}</a></li>
            {ops.map((o) => <li key={o.path}><a href={`#${o.path}`} className="font-mono text-xs text-fg-muted hover:text-fg">GET {o.path}</a></li>)}
          </ul>
        </nav>
        <article className="min-w-0 space-y-10" data-testid="api-docs">
          <section>
            <h1 className="text-4xl font-semibold tracking-tight">{t("developers.title")}</h1>
            <p className="mt-3 max-w-2xl text-fg-muted">{t("developers.subtitle")}</p>
            <p className="mt-3 text-sm">
              Base URL: <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono">{base}/api/v1</code> · <a className="font-medium text-accent-strong hover:underline" href="/api/v1/openapi.json">openapi.json</a>
            </p>
          </section>
          <section id="auth" className="space-y-3">
            <h2 className="text-xl font-semibold">{t("developers.auth")}</h2>
            <p className="text-sm text-fg-muted">{t("developers.authBody")}</p>
            <pre className="overflow-x-auto rounded-xl bg-frame p-4 font-mono text-xs text-white">{`curl -H "Authorization: Bearer ts_live_…" \\\n  "${base}/api/v1/products?phase=emerging&sort=growth"`}</pre>
          </section>
          <section id="limits" className="space-y-3">
            <h2 className="text-xl font-semibold">{t("developers.limits")}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
              <li>{t("developers.rate", { rate: API_RATE_PER_MINUTE })}</li>
              <li>{t("developers.quota")}</li>
              <li>{t("developers.errors")}</li>
              <li>{t("developers.estimates")}</li>
            </ul>
          </section>
          {ops.map((o) => (
            <section key={o.path} id={o.path} className="space-y-3 border-t border-border pt-8">
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent-strong">GET</span>
                <code className="font-mono">{o.path}</code>
                <span className="text-sm font-normal text-fg-muted">— {o.summary}</span>
              </h3>
              {o.description && <p className="text-sm text-fg-muted">{o.description}</p>}
              {!!o.parameters?.length && (
                <table className="w-full text-sm">
                  <tbody>
                    {o.parameters.map((p) => (
                      <tr key={p.name} className="border-b border-border/60 align-top last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{p.name}{p.required ? " *" : ""}</td>
                        <td className="py-1.5 text-fg-muted">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}
