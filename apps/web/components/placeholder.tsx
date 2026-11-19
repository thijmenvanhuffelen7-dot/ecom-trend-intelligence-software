import { Sparkles } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/** Nette "komt in fase X"-pagina voor modules die nog gebouwd worden. */
export async function Placeholder({ module, phase, icon }: { module: string; phase: number; icon?: React.ReactNode }) {
  const t = await getT();
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-accent-soft text-accent-strong [&_svg]:size-7">{icon ?? <Sparkles />}</div>
        <h2 className="mt-6 text-xl font-semibold tracking-tight">{t("placeholder.title", { module, phase })}</h2>
        <p className="mt-2 text-fg-muted">{t("placeholder.body")}</p>
      </div>
    </div>
  );
}
