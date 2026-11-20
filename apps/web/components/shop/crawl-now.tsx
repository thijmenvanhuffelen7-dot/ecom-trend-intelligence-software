"use client";

import { Check, Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { crawlNow } from "@/server/actions/crawl";

export function CrawlNowButton({ storeId, labels }: { storeId: number; labels: { crawlNow: string; queued: string } }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending || done}
      onClick={() => start(async () => setDone((await crawlNow({ storeId })).ok))}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium shadow-sm hover:bg-surface-hover disabled:opacity-70"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : done ? <Check className="size-3.5 text-accent" /> : <RefreshCw className="size-3.5" />}
      {done ? labels.queued : labels.crawlNow}
    </button>
  );
}
