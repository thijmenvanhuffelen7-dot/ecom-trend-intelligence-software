import Link from "next/link";
import { Clapperboard, Eye, Heart, Info, Mail, Package, Radio, ShoppingBag, Sparkles, Star, Store, Users, Video } from "lucide-react";
import { getDb } from "@trendscope/db";
import { ClearFilters, MultiFilter, Pagination, SelectFilter } from "@/components/explorer/filters";
import { SearchBar } from "@/components/explorer/search-bar";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { EstimateValue } from "@/components/ui/estimate";
import { EmptyState, Flag, Thumb } from "@/components/ui/misc";
import { Sparkline } from "@/components/ui/sparkline";
import { Tooltip } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import { NICHE_EMOJI } from "@/lib/niches";
import { cn, formatCompact, formatDateTime, formatMoney } from "@/lib/utils";
import type { SearchParams } from "@/server/queries/params";
import {
  CREATOR_PLATFORMS, parseSocialFilters, SOCIAL_PAGE, SOCIAL_TABS, socialCreators, socialLives, socialProducts, socialShops, socialVideos,
  type SocialFilters, type SocialTab,
} from "@/server/queries/social";

export const metadata = { title: "Social" };

const head = "px-4 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";
const FILTERS = ["q", "niche", "platform", "minfollowers", "mineng", "contact"];

function Table({ children, min = 1100 }: { children: React.ReactNode; min?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="scroll-area overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: min }} data-testid="social-table">
          {children}
        </table>
      </div>
    </div>
  );
}

function HeadHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip content={hint}>
      <span className="inline-flex cursor-help items-center gap-1">
        {label} <Info className="size-3.5 text-fg-subtle" />
      </span>
    </Tooltip>
  );
}

async function ProductsTab({ f, t, nicheName }: { f: SocialFilters; t: Translator; nicheName: Record<string, string> }) {
  const { total, rows } = await socialProducts(f);
  const L = t.locale;
  return {
    total,
    node: (
      <Table>
        <thead className="border-b border-border bg-bg-subtle/50">
          <tr>
            <th className={`${head} pl-5`}>{t("social.col.product")}</th>
            <th className={head}>{t("social.col.shop")}</th>
            <th className={`${head} text-right`}>{t("social.col.price")}</th>
            <th className={`${head} text-right`}>{t("social.col.sold30")}</th>
            <th className={head}>{t("social.col.trend")}</th>
            <th className={`${head} text-right`}><HeadHint label={t("social.col.gmv30")} hint={t("social.gmvHint")} /></th>
            <th className={`${head} text-right`}>{t("social.col.commission")}</th>
            <th className={`${head} pr-5 text-right`}>{t("social.col.videos")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-subtle/60">
              <td className="py-3 pr-4 pl-5">
                <div className="flex items-center gap-3">
                  <Thumb src={r.image} alt={r.title} className="size-12" />
                  <div className="min-w-0">
                    {r.cluster_id ? (
                      <Link href={`/explorer/products/${r.cluster_id}`} className="block max-w-[300px] truncate font-semibold hover:underline">{r.title}</Link>
                    ) : (
                      <span className="block max-w-[300px] truncate font-semibold">{r.title}</span>
                    )}
                    {r.niche_slug && <span className="text-xs text-fg-muted">{NICHE_EMOJI[r.niche_slug]} {nicheName[r.niche_slug] ?? r.niche_slug}</span>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm">{r.shop_name}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{formatMoney(r.price, r.currency ?? "EUR", L)}</td>
              <td className="tabular px-4 py-3 text-right font-semibold">{r.orders_30d != null ? formatCompact(r.orders_30d, L) : "—"}</td>
              <td className="px-4 py-3"><Sparkline values={r.spark} width={110} height={32} /></td>
              <td className="tabular px-4 py-3 text-right text-sm">≈ {formatMoney(r.gmv30, r.currency ?? "EUR", L, true)}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.commission_rate != null ? `${Math.round(r.commission_rate * 100)}%` : "—"}</td>
              <td className="tabular py-3 pr-5 pl-4 text-right text-sm">{r.videos}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    ),
  };
}

async function ShopsTab({ f, t }: { f: SocialFilters; t: Translator }) {
  const { total, rows } = await socialShops(f);
  const L = t.locale;
  return {
    total,
    node: (
      <Table>
        <thead className="border-b border-border bg-bg-subtle/50">
          <tr>
            <th className={`${head} pl-5`}>{t("social.col.shop")}</th>
            <th className={`${head} text-right`}>{t("social.col.rating")}</th>
            <th className={`${head} text-right`}>{t("social.col.followers")}</th>
            <th className={`${head} text-right`}>{t("social.col.products")}</th>
            <th className={`${head} text-right`}>{t("social.col.sold30")}</th>
            <th className={`${head} text-right`}><HeadHint label={t("social.col.gmv30")} hint={t("social.gmvHint")} /></th>
            <th className={`${head} pr-5 text-right`}>{t("social.col.lives")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-subtle/60">
              <td className="py-3 pr-4 pl-5">
                <div className="flex items-center gap-3">
                  <Thumb src={r.image} alt={r.name} className="size-11" />
                  <div className="min-w-0">
                    <p className="font-semibold">{r.name} <Flag country={r.country} className="ml-1 text-[13px]" /></p>
                    <p className="max-w-[320px] truncate text-xs text-fg-muted">{r.top_product}</p>
                  </div>
                  {r.store_id && (
                    <Link href={`/explorer/shops/${r.store_id}`} className="ml-2"><Badge tone="outline"><Store /> webshop</Badge></Link>
                  )}
                </div>
              </td>
              <td className="tabular px-4 py-3 text-right text-sm"><Star className="mr-1 inline size-3 fill-warning text-warning" />{r.rating ?? "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.followers != null ? formatCompact(r.followers, L) : "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.product_count}</td>
              <td className="tabular px-4 py-3 text-right font-semibold">{r.sold_30d != null ? formatCompact(r.sold_30d, L) : "—"}</td>
              <td className="px-4 py-3 text-right text-sm"><EstimateValue estimate={r.gmv} t={t} /></td>
              <td className="tabular py-3 pr-5 pl-4 text-right text-sm">{r.lives_14d}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    ),
  };
}

async function CreatorsTab({ f, t }: { f: SocialFilters; t: Translator }) {
  const { total, rows } = await socialCreators(f);
  const L = t.locale;
  return {
    total,
    node: (
      <Table min={1200}>
        <thead className="border-b border-border bg-bg-subtle/50">
          <tr>
            <th className={`${head} pl-5`}>{t("social.col.creator")}</th>
            <th className={`${head} text-right`}>{t("social.col.followers")}</th>
            <th className={head}>{t("social.col.growth7")}</th>
            <th className={`${head} text-right`}>{t("social.col.engagement")}</th>
            <th className={`${head} text-right`}>{t("social.col.avgViews")}</th>
            <th className={head}>{t("social.col.niches")}</th>
            <th className={`${head} text-right`}>{t("social.col.products")}</th>
            <th className={`${head} text-right`}><HeadHint label={t("social.col.gmv30")} hint={t("social.creatorGmvHint")} /></th>
            <th className={`${head} pr-5`}>{t("social.col.contact")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group relative border-b border-border last:border-0 hover:bg-bg-subtle/60">
              <td className="py-3 pr-4 pl-5">
                <div className="flex items-center gap-3">
                  <Thumb src={r.avatar_url} alt={r.handle} className="size-10" rounded="rounded-full" />
                  <div className="min-w-0">
                    <Link href={`/social/creators/${r.id}`} className="font-semibold after:absolute after:inset-0 hover:underline">@{r.handle}</Link>
                    <p className="text-xs text-fg-muted">
                      {({ tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" } as Record<string, string>)[r.platform] ?? r.platform}
                      {r.country && <Flag country={r.country} className="ml-1.5 text-[12px]" />}
                    </p>
                  </div>
                </div>
              </td>
              <td className="tabular px-4 py-3 text-right font-semibold">{r.followers != null ? formatCompact(r.followers, L) : "—"}</td>
              <td className="px-4 py-3">{r.followers_growth_7d != null ? <DeltaBadge value={r.followers_growth_7d} /> : <span className="text-fg-subtle">—</span>}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.engagement_rate != null ? `${(r.engagement_rate * 100).toFixed(1)}%` : "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.avg_views != null ? formatCompact(r.avg_views, L) : "—"}</td>
              <td className="px-4 py-3 text-sm">{r.niches.map((n) => NICHE_EMOJI[n] ?? n).join(" ") || "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.products}</td>
              <td className="relative z-10 px-4 py-3 text-right text-sm"><EstimateValue estimate={r.gmv} t={t} /></td>
              <td className="py-3 pr-5 pl-4">
                {r.hasContact ? (
                  <Tooltip content={t("social.contactPublic")}><Mail className="size-4 text-accent-strong" /></Tooltip>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    ),
  };
}

async function VideosTab({ f, t }: { f: SocialFilters; t: Translator }) {
  const { total, rows } = await socialVideos(f);
  const L = t.locale;
  return {
    total,
    node: (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5" data-testid="social-videos">
        {rows.map((v) => (
          <article key={v.id} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <a href={v.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="relative block">
              <Thumb src={v.thumbnail_url} alt="" className="aspect-[9/12] w-full border-0" rounded="rounded-none" />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-3 pt-8 pb-2 text-xs font-semibold text-white">
                <span className="flex items-center gap-1"><Eye className="size-3.5" /> {formatCompact(Number(v.views ?? 0), L)}</span>
                {v.views_24h ? <span className="rounded bg-accent px-1.5 py-0.5 text-accent-fg">+{formatCompact(Number(v.views_24h), L)}</span> : null}
                <span className="flex items-center gap-1"><Heart className="size-3.5" /> {formatCompact(Number(v.likes ?? 0), L)}</span>
              </div>
              <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">{v.platform}</span>
            </a>
            <div className="space-y-1.5 p-3">
              <p className="line-clamp-2 text-sm">{v.caption}</p>
              <Link href={`/social/creators/${v.creator_id}`} className="flex items-center gap-2 text-xs font-medium hover:underline">
                <Thumb src={v.avatar_url} alt={v.handle} className="size-5 border-0" rounded="rounded-full" /> @{v.handle}
              </Link>
              {v.cluster_id ? (
                <Link href={`/explorer/products/${v.cluster_id}`} className="block truncate text-xs text-accent-strong hover:underline">
                  <ShoppingBag className="mr-1 inline size-3" />{v.product_title ?? t("social.anchored")}
                </Link>
              ) : (
                <p className="text-xs text-fg-subtle">{t("social.noProduct")}</p>
              )}
              <p className="text-[11px] text-fg-subtle">{v.posted_at ? formatDateTime(v.posted_at, L) : ""}</p>
            </div>
          </article>
        ))}
      </div>
    ),
  };
}

async function LivesTab({ f, t }: { f: SocialFilters; t: Translator }) {
  const { total, rows } = await socialLives(f);
  const L = t.locale;
  return {
    total,
    node: (
      <Table>
        <thead className="border-b border-border bg-bg-subtle/50">
          <tr>
            <th className={`${head} pl-5`}>{t("social.col.live")}</th>
            <th className={head}>{t("social.col.creator")}</th>
            <th className={`${head} text-right`}>{t("social.col.viewers")}</th>
            <th className={`${head} text-right`}>{t("social.col.duration")}</th>
            <th className={`${head} text-right`}>{t("social.col.units")}</th>
            <th className={`${head} text-right`}><HeadHint label="GMV" hint={t("social.gmvHint")} /></th>
            <th className={`${head} pr-5`}>{t("social.col.products")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-subtle/60">
              <td className="py-3 pr-4 pl-5">
                <p className="font-semibold">
                  {r.status === "live" && <Badge tone="danger" className="mr-2"><Radio /> {t("social.liveNow")}</Badge>}
                  {r.title}
                </p>
                <p className="text-xs text-fg-muted">{formatDateTime(r.started_at, L)}{r.shop_name ? ` · ${r.shop_name}` : ""}</p>
              </td>
              <td className="px-4 py-3 text-sm"><Link href={`/social/creators/${r.creator_id}`} className="hover:underline">@{r.handle}</Link></td>
              <td className="tabular px-4 py-3 text-right text-sm">{r.peak_viewers != null ? formatCompact(r.peak_viewers, L) : "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm">{t("social.minutes", { n: r.duration_min ?? 0 })}</td>
              <td className="tabular px-4 py-3 text-right font-semibold">{r.units_sold ?? "—"}</td>
              <td className="px-4 py-3 text-right text-sm"><EstimateValue estimate={r.gmvEst} t={t} /></td>
              <td className="max-w-[320px] truncate py-3 pr-5 pl-4 text-xs text-fg-muted">{r.products.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    ),
  };
}

export default async function SocialPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const f = parseSocialFilters(sp);
  const tab: SocialTab = f.tab;
  const niches = await getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute();
  const { total, node } = await {
    products: ProductsTab, shops: ShopsTab, creators: CreatorsTab, videos: VideosTab, lives: LivesTab,
  }[tab]({ f, t, nicheName: Object.fromEntries(niches.map((n) => [n.slug, t.locale === "nl" ? n.name_nl : n.name_en])) });
  const icons: Record<SocialTab, React.ReactNode> = { products: <Package />, shops: <Store />, creators: <Users />, videos: <Video />, lives: <Radio /> };
  const active = FILTERS.some((p) => sp[p]);

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong"><Clapperboard className="size-5" /></span>
              {t("social.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-fg-muted">{t("social.subtitle")}</p>
          </div>
          <div className="w-80"><SearchBar placeholder={t(`social.tabs.${tab}`)} /></div>
        </div>
        <nav className="mt-6 flex gap-1" aria-label="Social">
          {SOCIAL_TABS.map((k) => (
            <Link
              key={k}
              href={k === "products" ? "/social" : `/social?tab=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn("inline-flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-medium transition [&_svg]:size-4", tab === k ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
            >
              {icons[k]} {t(`social.tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </header>
      <div className="space-y-4 bg-bg-subtle/60 p-6">
        <section className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          {(tab === "products" || tab === "creators") && (
            <MultiFilter param="niche" label={t("products.filter.niche")} icon={<Sparkles />} options={niches.map((n) => ({ value: n.slug, label: t.locale === "nl" ? n.name_nl : n.name_en, prefix: <span>{NICHE_EMOJI[n.slug]}</span> }))} />
          )}
          {(tab === "creators" || tab === "videos") && (
            <MultiFilter param="platform" label={t("social.platform")} icon={<Clapperboard />} options={CREATOR_PLATFORMS.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} />
          )}
          {tab === "creators" && (
            <>
              <SelectFilter param="minfollowers" label={t("social.minFollowers")} icon={<Users />} options={[10_000, 50_000, 100_000, 500_000].map((v) => ({ value: String(v), label: `≥ ${formatCompact(v, t.locale)}` }))} />
              <SelectFilter param="mineng" label={t("social.minEngagement")} icon={<Heart />} options={[2, 4, 6, 8].map((v) => ({ value: String(v), label: `≥ ${v}%` }))} />
              <SelectFilter param="contact" label={t("social.col.contact")} icon={<Mail />} options={[{ value: "1", label: t("social.contactOnly") }]} />
            </>
          )}
          {active && <ClearFilters params={FILTERS} label={t("explorer.clearFilters")} />}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
            <Info className="size-3.5" /> {total} · {t("social.privacy")}
          </span>
        </section>
        {total === 0 ? (
          <div className="rounded-2xl border border-border bg-surface"><EmptyState icon={<Clapperboard />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} /></div>
        ) : (
          node
        )}
        <Pagination
          page={f.page}
          total={total}
          pageSize={SOCIAL_PAGE}
          labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: f.page, total: Math.max(1, Math.ceil(total / SOCIAL_PAGE)) }) }}
        />
        <p className="px-1 text-xs text-fg-subtle">{t("social.partnerNote")}</p>
      </div>
    </div>
  );
}
