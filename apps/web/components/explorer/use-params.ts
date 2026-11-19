"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/** Werkt URL-zoekparameters bij (de bron van waarheid voor alle filters) en reset de paginering. */
export function useUpdateParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (updates: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") params.delete(k);
        else params.set(k, v);
      }
      if (!opts.keepPage && !("page" in updates)) params.delete("page");
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [router, pathname, searchParams],
  );

  return { update, pending, searchParams };
}
