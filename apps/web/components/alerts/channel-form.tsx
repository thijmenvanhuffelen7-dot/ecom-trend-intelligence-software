"use client";

import { useState, useTransition } from "react";
import { Plug } from "lucide-react";
import { CHANNEL_TYPES, type ChannelType } from "@trendscope/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { createChannel } from "@/server/actions/alerts";

export function ChannelForm() {
  const t = useT();
  const [type, setType] = useState<ChannelType>("slack");
  const [v, setV] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      <Input value={v[k] ?? ""} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} name={k} autoComplete="off" {...props} />
    </label>
  );
  return (
    <form
      className="space-y-3"
      data-testid="channel-form"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        const config =
          type === "email" ? { type, to: v.to ?? "" }
          : type === "telegram" ? { type, botToken: v.botToken ?? "", chatId: v.chatId ?? "" }
          : type === "webhook" ? { type, url: v.url ?? "", secret: v.secret ?? "" }
          : { type, url: v.url ?? "" };
        start(async () => {
          const res = await createChannel({ name: v.name || t(`alerts.channelTypes.${type}`), config: config as never });
          if (res.ok) {
            setV({});
            setMessage("✓");
          } else setMessage(t("alerts.invalid", { error: res.error }));
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Type</span>
          <select className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm shadow-sm" value={type} onChange={(e) => { setType(e.target.value as ChannelType); setV({}); }} name="type">
            {CHANNEL_TYPES.map((c) => <option key={c} value={c}>{t(`alerts.channelTypes.${c}`)}</option>)}
          </select>
        </label>
        {field("name", t("alerts.channelName"), { maxLength: 60 })}
      </div>
      {type === "email" && field("to", t("alerts.to"), { type: "email" })}
      {(type === "slack" || type === "discord" || type === "webhook") && field("url", t("alerts.url"), { type: "url", placeholder: type === "slack" ? "https://hooks.slack.com/services/…" : type === "discord" ? "https://discord.com/api/webhooks/…" : "https://" })}
      {type === "telegram" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("botToken", t("alerts.botToken"), { type: "password" })}
          {field("chatId", t("alerts.chatId"))}
        </div>
      )}
      {type === "webhook" && (
        <>
          {field("secret", t("alerts.secret"), { type: "password", minLength: 16 })}
          <p className="text-xs text-fg-subtle">{t("alerts.webhookHint")}</p>
        </>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}><Plug className="size-4" /> {t("alerts.save")}</Button>
        {message && <span className="text-sm text-fg-muted" role="status">{message}</span>}
      </div>
    </form>
  );
}
