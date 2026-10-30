import { bars } from "../charts";
import * as data from "../data";
import { downloadTotals, publicReleases } from "../downloads";
import { formatNumber } from "../format";
import { html, type Html } from "../html";
import type { IconName } from "../icons";
import { card, empty, kpi, kpis, panel } from "../ui";

/** Until the charts are connected, these pages say what they will show, never a made-up number. */
async function notMeasured(iconName: IconName, list: string[]): Promise<Html> {
  const settings = await data.analyticsSettings();
  const on = settings.state === "live" && settings.data.enabled;
  return html`<div class="grid">${panel("Mesure d'audience", empty({
    icon: iconName,
    title: on ? "Mesure active" : "Pas encore active",
    text: on
      ? `${formatNumber(settings.data.sessions)} visites enregistrées pour l'instant. Les graphiques de cette page ne sont pas encore branchés ; ils montreront :`
      : "Le site ne compte pas encore ses visites. La mesure sera activée après la mise à jour de la politique de confidentialité ; cette page montrera alors :",
    list,
    action: html`<a class="btn btn-ghost btn-sm" href="#/settings">Voir les réglages</a>`,
  }), { wide: true })}</div>`;
}

export const traffic = (): Promise<Html> => notMeasured("analytics", [
  "Pages vues", "Visiteurs uniques", "Visiteurs qui reviennent", "Sessions", "Durée moyenne", "Pages par session", "Évolution jour, semaine, mois",
]);

export const visitors = (): Promise<Html> => notMeasured("users", [
  "Pays", "Navigateurs", "Systèmes", "Appareils", "Nouveaux et réguliers", "Pages d'entrée et de sortie",
]);

export const acquisition = (): Promise<Html> => notMeasured("link", [
  "Accès direct", "Moteurs de recherche", "Discord", "TikTok", "Autres sites", "Campagnes UTM",
]);

export const pages = (): Promise<Html> => notMeasured("file", [
  "Pages les plus vues", "Français et anglais", "Temps de lecture", "Pages d'arrivée", "Taux de sortie", "Visites de la page Téléchargement",
]);

export const conversions = (): Promise<Html> => notMeasured("funnel", [
  "Arrivée sur le site", "Section de téléchargement vue", "Clic sur Télécharger", "Téléchargement demandé", "Par langue", "Par source",
]);

export async function downloads(): Promise<Html> {
  const list = await data.releases();
  const totals = list.state === "live" ? downloadTotals(list.data) : null;
  const value = (n: number | undefined) => (n === undefined ? html`<span class="muted">Indisponible</span>` : formatNumber(n));
  return html`
    ${kpis([
      kpi({ icon: "download", label: "Installeur (site et GitHub)", value: value(totals?.installer), hint: "requêtes comptées par GitHub" }),
      kpi({ icon: "update", label: "Installeur (auto-update)", value: value(totals?.updater), hint: "version actuelle seulement" }),
      kpi({ icon: "pulse", label: "Vérifications de mise à jour", value: value(totals?.checks), hint: "lectures de latest.json" }),
      kpi({ icon: "check", label: "Téléchargements terminés", value: html`<span class="muted">Non mesurable</span>`, hint: "GitHub ne le dit pas" }),
    ])}
    <div class="grid">
      ${card("Installeur téléchargé, par version", list, (rows) => {
        const published = [...publicReleases(rows)].reverse();
        return published.length
          ? bars(published.map((r) => ({ label: r.version, value: r.installer?.downloads ?? 0 })), "Téléchargements de l'installeur par version")
          : html`<p class="unavailable">Aucune release publiée.</p>`;
      }, { wide: true, icon: "analytics", action: html`<a class="card-link" href="#/application/distribution">Par fichier</a>` })}

      ${panel("Ce que ces chiffres veulent dire", html`<ul class="facts">
        <li><strong>Compté par GitHub.</strong> Chaque requête du fichier, y compris les relances, les gestionnaires de téléchargement et les robots. Pas de date, pas de pays, pas de système.</li>
        <li><strong>Pas une preuve de téléchargement.</strong> Un clic ou une requête ne dit pas que le fichier est arrivé en entier.</li>
        <li><strong>Pas un nombre de personnes.</strong> La même personne peut télécharger plusieurs fois.</li>
      </ul>`, { icon: "info" })}

      ${panel("Demandes de téléchargement sur aoze.fr", empty({
        icon: "funnel",
        title: "Pas encore mesurées",
        text: "Avec la mesure d'audience, chaque demande passera par aoze.fr avant GitHub : elle sera datée et rattachée à sa version, au système et à la source de la visite.",
      }), { icon: "download" })}
    </div>`;
}
