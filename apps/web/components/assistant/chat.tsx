"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Database, Loader2, Sparkles } from "lucide-react";
import { Markdown } from "./markdown";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; text: string; tools?: { name: string }[] };

export function Chat({ conversationId, initial, suggestions }: { conversationId?: string; initial: Msg[]; suggestions: string[] }) {
  const t = useT();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "", tools: [] }]);
    const patch = (fn: (a: Msg) => Msg) => setMessages((m) => [...m.slice(0, -1), fn(m[m.length - 1]!)]);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: convId, message: text }) });
      if (res.status === 402) {
        patch((a) => ({ ...a, text: t("assistant.limit") }));
        return;
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; id?: string; message?: string };
          if (ev.type === "conversation" && ev.id && !convId) {
            setConvId(ev.id);
            window.history.replaceState(null, "", `/assistant?c=${ev.id}`);
          }
          if (ev.type === "text" && ev.text) patch((a) => ({ ...a, text: a.text + ev.text }));
          if (ev.type === "tool" && ev.name) patch((a) => ({ ...a, tools: [...(a.tools ?? []), { name: ev.name! }] }));
          if (ev.type === "error") patch((a) => ({ ...a, text: a.text + `\n\n${ev.message}` }));
        }
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    } catch {
      patch((a) => ({ ...a, text: t("assistant.error") }));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="mx-auto max-w-2xl pt-10 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong"><Sparkles className="size-6" /></span>
            <h2 className="mt-4 text-xl font-semibold">{t("assistant.emptyTitle")}</h2>
            <p className="mt-1 text-fg-muted">{t("assistant.emptyHint")}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm hover:bg-surface-hover">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("mx-auto flex max-w-3xl", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <p className="max-w-[80%] rounded-2xl bg-fg px-4 py-2.5 text-[15px] text-bg">{m.text}</p>
            ) : (
              <div className="w-full space-y-2" data-testid="assistant-message">
                {!!m.tools?.length && (
                  <p className="flex flex-wrap gap-1.5">
                    {m.tools.map((tl, ti) => (
                      <span key={ti} className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-2.5 py-1 text-xs text-fg-muted"><Database className="size-3" /> {t(`assistant.tools.${tl.name as "search_products"}`)}</span>
                    ))}
                  </p>
                )}
                {m.text ? <Markdown text={m.text} /> : busy && i === messages.length - 1 ? <Loader2 className="size-4 animate-spin text-fg-subtle" /> : null}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="border-t border-border bg-bg px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-sm focus-within:ring-2 focus-within:ring-accent/25">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={t("assistant.placeholder")}
            rows={1}
            maxLength={2000}
            name="message"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] focus:outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label={t("assistant.send")} className="grid size-10 place-items-center rounded-xl bg-accent text-accent-fg disabled:opacity-40">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-fg-subtle">{t("assistant.disclaimer")}</p>
      </form>
    </div>
  );
}
