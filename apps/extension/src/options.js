import { DEFAULT_BASE, isValidKey, normalizeBase, originPattern } from "./lib.js";

const $ = (id) => document.getElementById(id);
const status = (text) => ($("status").textContent = text);

const { base = DEFAULT_BASE, apiKey = "", autoLookup = true } = await chrome.storage.local.get(["base", "apiKey", "autoLookup"]);
$("base").value = base;
$("apiKey").value = apiKey;
$("autoLookup").checked = autoLookup;

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = normalizeBase($("base").value || DEFAULT_BASE);
  const key = $("apiKey").value.trim();
  if (!b) return status("Ongeldig adres: gebruik https:// (of http://localhost voor ontwikkeling).");
  if (!isValidKey(key)) return status("Dit lijkt geen Trendscope-sleutel (ts_live_ gevolgd door 32 tekens).");
  // Alleen toegang vragen tot je eigen Trendscope-omgeving, niet tot alle websites
  const granted = await chrome.permissions.request({ origins: [originPattern(b)] });
  if (!granted) return status("Zonder toegang tot je Trendscope-adres kan de extensie niets opzoeken.");
  await chrome.storage.local.set({ base: b, apiKey: key, autoLookup: $("autoLookup").checked });
  await chrome.storage.session.clear();
  try {
    const res = await fetch(`${b}/api/v1/me`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      const { data } = await res.json();
      status(`Gekoppeld met ${data.workspace.name} (${data.workspace.plan}).`);
    } else status(res.status === 401 ? "Sleutel geweigerd: controleer of hij niet is ingetrokken." : `Opgeslagen, maar de test gaf ${res.status}.`);
  } catch {
    status("Opgeslagen, maar Trendscope is niet bereikbaar op dit adres.");
  }
});
