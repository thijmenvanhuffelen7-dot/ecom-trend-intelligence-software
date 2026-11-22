"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Plug, Send, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { connectShopify, disconnectShopify, pushToShopify } from "@/server/actions/shopify";

export function ConnectShopify() {
  const t = useT();
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      data-testid="connect-shopify"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await connectShopify({ domain, token });
          if (r.ok) { setDomain(""); setToken(""); setError(null); } else setError(r.error);
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input required placeholder="mijn-winkel.myshopify.com" aria-label={t("shopify.domain")} value={domain} onChange={(e) => setDomain(e.target.value)} className="min-w-[200px] flex-1" />
        <Input required type="password" autoComplete="off" placeholder="shpat_…" aria-label={t("shopify.token")} value={token} onChange={(e) => setToken(e.target.value)} className="min-w-[200px] flex-1" />
        <Button type="submit" variant="accent" disabled={pending}><Plug className="size-4" /> {t("shopify.connect")}</Button>
      </div>
      <p className="text-xs text-fg-muted">{t("shopify.howTo")}</p>
      {error && <p className="text-sm text-danger" role="alert">{t(`shopify.errors.${error as "auth"}`)}</p>}
    </form>
  );
}

export function DisconnectShopify({ id }: { id: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await disconnectShopify(id)))}><Unplug className="size-4" /> {t("shopify.disconnect")}</Button>;
}

export function PushToStore({ clusterId, connections, defaults }: { clusterId: number; connections: { id: string; label: string }[]; defaults: { title: string; description: string; price: number } }) {
  const t = useT();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description);
  const [price, setPrice] = useState(String(defaults.price));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ url?: string; error?: string } | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="push-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await pushToShopify({ clusterId, connectionId, title, description, price: Number(price.replace(",", ".")) });
          setResult(r.ok ? { url: r.adminUrl } : { error: r.error });
        });
      }}
    >
      {connections.length > 1 && (
        <select className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} aria-label={t("shopify.store")}>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("shopify.title")} maxLength={255} required />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} aria-label={t("shopify.description")} rows={4} maxLength={5000} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          {t("shopify.price")} €
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label={t("shopify.price")} className="w-24" required />
        </label>
        <Button type="submit" variant="accent" disabled={pending || !connectionId}><Send className="size-4" /> {t("shopify.push")}</Button>
      </div>
      <p className="text-xs text-fg-muted">{t("shopify.pushNote")}</p>
      {result?.url && (
        <p className="text-sm text-accent-strong" role="status">
          {t("shopify.pushed")} <a href={result.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium underline">{t("shopify.openInShopify")} <ExternalLink className="size-3.5" /></a>
        </p>
      )}
      {result?.error && <p className="text-sm text-danger" role="alert">{t(`shopify.errors.${result.error as "auth"}`)}</p>}
    </form>
  );
}
