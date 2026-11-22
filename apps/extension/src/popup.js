// Popup: toont wat Trendscope weet over de winkel in het actieve tabblad.
// Alle tekst gaat via textContent (nooit innerHTML), zodat winkelnamen of producttitels geen HTML kunnen injecteren.
import { DEFAULT_BASE, formatCompact, formatEstimate, hostnameOf } from "./lib.js";

const root = document.getElementById("root");
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c ?? "")));
  return node;
};
const show = (...nodes) => root.replaceChildren(...nodes);
const safeHref = (url, base) => {
  try {
    const u = new URL(url);
    return u.origin === new URL(base).origin ? u.href : base; // alleen links naar onze eigen app
  } catch {
    return base;
  }
};

function stat(value, label) {
  return el("div", { className: "stat" }, el("b", {}, value), el("span", {}, label));
}

function render(store, base) {
  const nodes = [el("h1", {}, store.name || store.domain), el("div", { className: "domain" }, `${store.domain} · ${store.platform}${store.country ? ` · ${store.country}` : ""}`)];
  nodes.push(
    el(
      "div",
      { className: "grid" },
      stat(formatEstimate(store.monthly_revenue, "nl-NL", "EUR"), "omzet / maand (schatting)"),
      stat(formatEstimate(store.monthly_visits, "nl-NL"), "bezoeken / maand (schatting)"),
      stat(formatCompact(store.live_ads), "live ads"),
      stat(formatCompact(store.product_count), "producten"),
    ),
  );
  const apps = (store.technologies || []).filter((t) => t.type === "app").slice(0, 10);
  if (apps.length) nodes.push(el("h2", {}, "Apps"), el("div", { className: "chips" }, ...apps.map((a) => el("span", { className: "chip" }, a.name))));
  if (store.top_products?.length) {
    nodes.push(
      el("h2", {}, "Sterkste producten"),
      el(
        "ul",
        {},
        ...store.top_products.map((p) =>
          el("li", {}, el("a", { href: safeHref(p.url, base), target: "_blank", rel: "noopener" }, p.title), el("span", { className: "score" }, p.opportunity == null ? "—" : Math.round(p.opportunity))),
        ),
      ),
    );
  }
  nodes.push(el("a", { className: "cta", href: safeHref(store.url, base), target: "_blank", rel: "noopener" }, "Open in Trendscope →"));
  nodes.push(el("p", { className: "note" }, "Omzet en bezoeken zijn schattingen op basis van publieke signalen."));
  show(...nodes);
}

function message(text, action) {
  show(el("p", { className: "empty" }, text), ...(action ? [action] : []));
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const domain = hostnameOf(tab?.url ?? "");
  if (!domain) return message("Open een webshop om te zien wat Trendscope erover weet.");
  const { base = DEFAULT_BASE } = await chrome.storage.local.get("base");
  const result = await chrome.runtime.sendMessage({ type: "lookup", domain });
  const openSettings = el("button", { className: "link", onclick: () => chrome.runtime.openOptionsPage() }, "Instellingen openen");
  switch (result?.status) {
    case "ok":
      return render(result.store, base);
    case "not_found":
      return message(`Trendscope volgt ${domain} (nog) niet.`);
    case "no_key":
      return message("Koppel eerst je Trendscope-account met een API-sleutel.", openSettings);
    case "no_permission":
      return message("Geef de extensie toegang tot je Trendscope-omgeving.", openSettings);
    case "unauthorized":
      return message("Deze sleutel is ongeldig of ingetrokken.", openSettings);
    case "forbidden":
      return message("De extensie staat niet aan voor je workspace of plan.");
    case "rate_limited":
      return message("Even te veel verzoeken; probeer het zo opnieuw.");
    default:
      return message("Trendscope is nu niet bereikbaar.");
  }
}

main();
