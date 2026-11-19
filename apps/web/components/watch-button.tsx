"use client";

import { Check, Radar } from "lucide-react";
import { useState, useTransition } from "react";
import { toggleWatch } from "@/server/actions/watchlist";
import { cn } from "@/lib/utils";

export function WatchButton({ entityType, entityId, initial, labels }: { entityType: "store" | "product_cluster"; entityId: string; initial: boolean; labels: { track: string; tracking: string } }) {
  const [watching, setWatching] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="relative">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setWatching(!watching); // optimistisch
            const res = await toggleWatch({ entityType, entityId: Number(entityId) });
            if (res.ok) {
              setWatching(res.watching);
              setError(null);
            } else {
              setWatching(watching);
              setError(res.message);
            }
          })
        }
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
          watching ? "border border-accent/40 bg-accent-soft text-accent-strong" : "bg-accent text-accent-fg shadow-sm hover:brightness-95",
        )}
      >
        {watching ? <Check className="size-4" /> : <Radar className="size-4" />}
        {watching ? labels.tracking : labels.track}
      </button>
      {error && <p className="absolute top-full right-0 mt-1.5 w-64 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
