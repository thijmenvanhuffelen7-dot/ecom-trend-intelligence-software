import { Image as ImageIcon } from "lucide-react";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { Placeholder } from "@/components/placeholder";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Images" };

export default async function ImagesPage() {
  await requireSession();
  const t = await getT();
  return (
    <>
      <ExplorerHeader count="—" countLabel={t("explorer.images").toLowerCase()} />
      <Placeholder module={t("explorer.images")} phase={9} icon={<ImageIcon />} />
    </>
  );
}
