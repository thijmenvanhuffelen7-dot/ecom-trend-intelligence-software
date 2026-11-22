// Service worker: zet per tabblad een badge zodra je een webshop bezoekt die Trendscope kent.
// Leest alleen de hostnaam van het actieve tabblad; geen paginainhoud, geen browsegeschiedenis naar de server behalve die hostnaam.
import { badgeFor, CACHE_TTL_MS, DEFAULT_BASE, hostnameOf, isFresh, lookupStore } from "./lib.js";

async function settings() {
  const { base = DEFAULT_BASE, apiKey = "", autoLookup = true } = await chrome.storage.local.get(["base", "apiKey", "autoLookup"]);
  return { base, apiKey, autoLookup };
}

/** Lookup met cache (chrome.storage.session, per domein, 10 minuten) zodat we de API niet bij elke tabwissel aanroepen. */
export async function cachedLookup(domain, { force = false } = {}) {
  const { base, apiKey } = await settings();
  if (!apiKey) return { status: "no_key" };
  const cacheKey = `lookup:${domain}`;
  if (!force) {
    const hit = (await chrome.storage.session.get(cacheKey))[cacheKey];
    if (isFresh(hit, Date.now(), CACHE_TTL_MS)) return hit.result;
  }
  const granted = await chrome.permissions.contains({ origins: [`${new URL(base).origin}/*`] });
  if (!granted) return { status: "no_permission" };
  const result = await lookupStore(fetch, base, apiKey, domain);
  if (result.status === "ok" || result.status === "not_found") await chrome.storage.session.set({ [cacheKey]: { at: Date.now(), result } });
  return result;
}

async function updateBadge(tabId, url) {
  const domain = hostnameOf(url ?? "");
  const { autoLookup } = await settings();
  if (!domain || !autoLookup) return chrome.action.setBadgeText({ tabId, text: "" });
  const badge = badgeFor(await cachedLookup(domain));
  await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  await chrome.action.setBadgeText({ tabId, text: badge.text });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.active) updateBadge(tabId, tab.url).catch(() => undefined);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) updateBadge(tabId, tab.url).catch(() => undefined);
});

// De popup vraagt de gegevens op via de service worker (één plek voor cache en sleutel)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== "lookup" || typeof msg.domain !== "string") return false;
  cachedLookup(msg.domain, { force: !!msg.force }).then(reply, () => reply({ status: "error", message: "internal" }));
  return true; // asynchroon antwoord
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
