import { LayoutGrid } from "lucide-react";
import { Placeholder } from "@/components/placeholder";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Boards" };

export default async function BoardsPage() {
  await requireSession();
  const t = await getT();
  return <Placeholder module={t("nav.boards")} phase={3} icon={<LayoutGrid />} />;
}
