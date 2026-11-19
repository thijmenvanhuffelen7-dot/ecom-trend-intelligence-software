import { Mail } from "lucide-react";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { Placeholder } from "@/components/placeholder";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Emails" };

export default async function EmailsPage() {
  await requireSession();
  const t = await getT();
  return (
    <>
      <ExplorerHeader count="—" countLabel={t("explorer.emails").toLowerCase()} />
      <Placeholder module={t("explorer.emails")} phase={7} icon={<Mail />} />
    </>
  );
}
