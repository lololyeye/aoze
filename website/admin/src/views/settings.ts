import * as data from "../data";
import { html, type Html } from "../html";
import { card, panel, pill, row, toast } from "../ui";

const GLASS_KEY = "aoze-admin-glass";

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

export async function settings(): Promise<Html> {
  const security = await data.security();
  return html`<div class="grid">
    ${panel("Mesure d'audience", html`<dl class="kvs">
      ${row("État", pill("muted", "Pas encore installée"))}
      ${row("Sur le site", "aucun cookie, aucun script de mesure, comme l'annonce la politique de confidentialité")}
      ${row("Conservation", html`<span class="muted">Se réglera ici une fois la mesure installée.</span>`)}
    </dl>`, { icon: "analytics" })}

    ${card("Confidentialité de l'admin", security, (s) => html`<dl class="kvs">
      ${row("Accès à /admin", s.hidden ? pill("ok", "Masqué") : pill("warn", "Visible par tous"))}
      ${row("Connexions enregistrées", "date, résultat, adresse IP et navigateur, pour repérer les tentatives d'intrusion")}
      ${row("Durée", html`<span class="muted">Sans purge automatique pour l'instant.</span>`)}
    </dl>`, { icon: "lock" })}

    ${panel("Préférences de ce navigateur", html`<label class="switch">
      <input type="checkbox" data-pref-glass ${glassEnabled() ? "checked" : ""} />
      <span class="switch-track" aria-hidden="true"></span>
      <span><strong>Effets de transparence</strong><small>Flou derrière le menu, la barre du haut et les fenêtres. À couper si l'affichage rame.</small></span>
    </label>`, { wide: true, icon: "settings" })}
  </div>`;
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
}
