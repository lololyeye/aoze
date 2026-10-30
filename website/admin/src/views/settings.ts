import { api, ApiError } from "../api";
import * as data from "../data";
import { formatAgo, formatDate, formatNumber } from "../format";
import { html, type Html } from "../html";
import type { AnalyticsSettings } from "../types";
import { card, confirmAction, panel, pill, row, toast } from "../ui";

const GLASS_KEY = "aoze-admin-glass";
const RETENTION_LABELS: Record<number, string> = { 90: "3 mois", 180: "6 mois", 365: "12 mois", 760: "25 mois (maximum de la CNIL)" };

function glassEnabled(): boolean {
  try {
    return localStorage.getItem(GLASS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Per-browser display preference: the blur can be heavy on a weak GPU. */
export function applyPreferences(): void {
  document.documentElement.toggleAttribute("data-solid", !glassEnabled());
}

const switchInput = (attr: string, on: boolean, title: string, text: string): Html => html`<label class="switch">
  <input type="checkbox" ${attr} ${on ? "checked" : ""} />
  <span class="switch-track" aria-hidden="true"></span>
  <span><strong>${title}</strong><small>${text}</small></span>
</label>`;

function stored(s: AnalyticsSettings): string {
  if (!s.sessions && !s.downloads) return "Rien pour l'instant";
  const since = s.oldestAt ? `, depuis le ${formatDate(s.oldestAt)}` : "";
  const count = (n: number, one: string, many: string) => `${formatNumber(n)} ${n > 1 ? many : one}`;
  return `${count(s.sessions, "visite", "visites")} et ${count(s.downloads, "demande de téléchargement", "demandes de téléchargement")}${since}`;
}

export async function settings(): Promise<Html> {
  const [security, analytics] = await Promise.all([data.security(), data.analyticsSettings()]);
  return html`<div class="grid">
    ${card("Mesure d'audience", analytics, (s) => html`
      ${switchInput("data-analytics-enabled", s.enabled, "Mesurer la fréquentation du site",
        "Visites, pages, sources et demandes de téléchargement, sur aoze.fr uniquement. À activer une fois la politique de confidentialité à jour.")}
      <dl class="kvs settings-rows">
        ${row("État", s.enabled ? pill("ok", "Active") : pill("muted", "Désactivée"))}
        ${row("Conservation des visites", html`<select class="select" data-retention aria-label="Durée de conservation">
          ${s.retentionChoices.map((d) => html`<option value="${d}" ${d === s.retentionDays ? "selected" : ""}>${RETENTION_LABELS[d] ?? `${d} jours`}</option>`)}
        </select>`)}
        ${row("Enregistré", stored(s))}
        ${row("Pays des visiteurs", s.geoMonth ? `base DB-IP de ${s.geoMonth}` : html`<span class="muted">base pas encore téléchargée</span>`)}
        ${row("Dernier entretien", s.maintainedAt ? formatAgo(s.maintainedAt) : html`<span class="muted">pas encore</span>`)}
      </dl>
      <p class="note">Jamais d'adresse IP enregistrée : elle donne le pays, puis elle est oubliée. Un cookie propre au site (13 mois, jamais prolongé) reconnaît un visiteur qui revient. Après la durée choisie, il ne reste que des totaux par jour, sans identifiant, 25 mois au plus.</p>`,
    { wide: true, icon: "analytics" })}

    ${card("Confidentialité de l'admin", security, (s) => html`<dl class="kvs">
      ${row("Accès à /admin", s.hidden ? pill("ok", "Masqué") : pill("warn", "Visible par tous"))}
      ${row("Connexions enregistrées", "date, résultat, adresse IP et navigateur, pour repérer les tentatives d'intrusion")}
      ${row("Conservation", "90 jours pour les connexions, 12 mois pour le journal, puis effacement automatique")}
    </dl>`, { icon: "lock" })}

    ${panel("Préférences de ce navigateur", switchInput("data-pref-glass", glassEnabled(), "Effets de transparence",
      "Flou derrière le menu, la barre du haut et les fenêtres. À couper si l'affichage rame."), { icon: "settings" })}
  </div>`;
}

async function saveAnalytics(change: { enabled?: boolean; retentionDays?: number }, done: string): Promise<void> {
  try {
    await api("analytics/settings", change);
    toast(done);
  } catch (err) {
    toast(err instanceof ApiError ? err.message : "Le serveur ne répond pas.", "bad");
  }
  window.dispatchEvent(new Event("admin:refresh"));
}

export function bindSettings(root: HTMLElement): void {
  root.querySelector<HTMLInputElement>("[data-pref-glass]")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    try {
      localStorage.setItem(GLASS_KEY, on ? "on" : "off");
    } catch {
      toast("Ce navigateur ne garde pas la préférence : elle s'applique jusqu'au rechargement.", "muted");
    }
    document.documentElement.toggleAttribute("data-solid", !on);
  });

  root.querySelector<HTMLInputElement>("[data-analytics-enabled]")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const enabled = input.checked;
    const ok = await confirmAction(enabled
      ? { title: "Activer la mesure d'audience ?", text: "Le site commencera à compter les visites et à déposer son cookie de mesure. La politique de confidentialité doit déjà l'expliquer.", confirm: "Activer" }
      : { title: "Désactiver la mesure d'audience ?", text: "Le site arrêtera de compter les visites. Ce qui est déjà enregistré reste, jusqu'à la fin de sa durée de conservation.", confirm: "Désactiver", danger: true });
    if (!ok) {
      input.checked = !enabled;
      return;
    }
    await saveAnalytics({ enabled }, enabled ? "Mesure d'audience activée." : "Mesure d'audience désactivée.");
  });

  root.querySelector<HTMLSelectElement>("[data-retention]")?.addEventListener("change", async (e) => {
    const select = e.target as HTMLSelectElement;
    const days = Number(select.value);
    const ok = await confirmAction({
      title: "Changer la durée de conservation ?",
      text: "Si elle est plus courte, les visites plus anciennes seront effacées au prochain entretien, dans l'heure. Les totaux par jour restent.",
      confirm: "Changer",
    });
    if (!ok) {
      select.value = String(select.querySelector("option[selected]")?.getAttribute("value") ?? days);
      return;
    }
    await saveAnalytics({ retentionDays: days }, `Visites conservées ${RETENTION_LABELS[days] ?? `${days} jours`}.`);
  });
}
