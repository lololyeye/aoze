import { bars, delta, donut, funnel, ranking, timeline, type Point, type Slice } from "../charts";
import * as data from "../data";
import { downloadTotals, publicReleases } from "../downloads";
import { formatAgo, formatDate, formatNumber } from "../format";
import { html, type Html } from "../html";
import { icon, type IconName } from "../icons";
import { currentPeriod, formatDay, periodLabel } from "../range";
import type { AnalyticsReport, PeriodSummary, SeriesPoint } from "../types";
import { card, empty, kpi, kpis, panel } from "../ui";

const SOURCES: Record<string, string> = {
  direct: "Accès direct", search: "Moteurs de recherche", discord: "Discord", tiktok: "TikTok", website: "Autres sites", campaign: "Campagnes (UTM)",
};
const DEVICES: Record<string, string> = { desktop: "Ordinateur", mobile: "Mobile", tablet: "Tablette" };
const LANGS: Record<string, string> = { fr: "Français", en: "Anglais" };
const DOWNLOAD_PAGE = /^\/(fr\/)?download\/$/;
const DBIP_URL = "https://db-ip.com";
const regions = new Intl.DisplayNames(["fr"], { type: "region" });

const country = (code: string): string => {
  if (!code) return "Inconnu";
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};

const percentOf = (part: number, total: number): string =>
  total ? `${formatNumber(Math.round((part / total) * 1000) / 10)} %` : "—";

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ""}`;
}

interface Context {
  report: AnalyticsReport;
  /** The previous period is fully measured, so a change against it means something. */
  comparable: boolean;
}

const total = (p: PeriodSummary, metric: string): number => p.totals[metric] ?? 0;

function dimension(r: AnalyticsReport, metric: string): [string, number][] {
  return Object.entries(r.current.dimensions[metric] ?? {}).sort((a, b) => b[1] - a[1]);
}

/** The largest entries, the rest added up as "Autres". */
function top(entries: [string, number][], label: (key: string) => string, limit = 8): Point[] {
  const points = entries.slice(0, limit).map(([key, value]) => ({ label: label(key), value }));
  const rest = entries.slice(limit).reduce((n, [, v]) => n + v, 0);
  return rest ? [...points, { label: "Autres", value: rest }] : points;
}

function slices(entries: [string, number][], label: (key: string) => string): Slice[] {
  return top(entries, label, 3).map((p) => ({ label: p.label, value: p.value }));
}

const named = (map: Record<string, string>) => (key: string): string => map[key] ?? (key || "Inconnu");

type Missing = { missing: Html };

/** Pages without any data say so; numbers only appear once something was really measured. */
async function load(): Promise<Context | Missing> {
  const period = currentPeriod();
  const set = await data.analyticsReport(period.from, period.to);
  if (set.state === "unavailable") return { missing: html`<p class="unavailable">${set.reason}</p>` };
  const report = set.data;
  if (!report.measuredSince) {
    return { missing: empty({
      icon: "analytics",
      title: report.enabled ? "Rien d'enregistré pour l'instant" : "Pas encore active",
      text: report.enabled
        ? "La mesure est active : les chiffres apparaîtront ici dès la première visite comptée."
        : "Le site ne compte pas ses visites. Activez la mesure dans les réglages une fois la politique de confidentialité en ligne.",
      action: html`<a class="btn btn-ghost btn-sm" href="#/settings">Voir les réglages</a>`,
    }) };
  }
  return { report, comparable: report.measuredSince <= report.previous.from };
}

const missingPage = (m: Missing): Html => html`<div class="grid">${panel("Mesure d'audience", m.missing, { wide: true })}</div>`;

function notices(c: Context): Html {
  const { report } = c;
  const list: Html[] = [];
  if (!report.enabled) list.push(html`<p class="notice notice-warn">${icon("alert")}<span>La mesure est désactivée : plus rien n'est compté depuis. <a href="#/settings">Réglages</a></span></p>`);
  if (report.measuredSince! > report.current.from) {
    list.push(html`<p class="notice">${icon("info")}<span>Mesure depuis le ${formatDate(report.measuredSince!)} : les jours d'avant sont à zéro et la comparaison n'est pas affichée.</span></p>`);
  }
  return html`${list}`;
}

/** KPI hint: change against the previous period when it can be compared. */
function versus(c: Context, current: number, previous: number, lowerIsBetter = false): Html | string {
  return c.comparable ? html`${delta(current, previous, lowerIsBetter)} vs période précédente` : periodLabel();
}

function series(c: Context, metric: keyof Omit<SeriesPoint, "day">, label: string): Html {
  const { current, previous } = c.report;
  return timeline({
    label,
    days: current.series.map((p) => p.day),
    values: current.series.map((p) => p[metric]),
    previous: c.comparable ? previous.series.map((p) => p[metric]) : undefined,
    dayLabel: formatDay,
  });
}

/** Several series in one card, switched by buttons (bound by bindAnalytics). */
function switchable(title: string, iconName: IconName, charts: [string, Html][]): Html {
  return panel(title, html`${charts.map(([, chart], i) => html`<div data-chart="${i}" ${i ? "hidden" : ""}>${chart}</div>`)}`, {
    wide: true,
    icon: iconName,
    action: html`<div class="segmented chart-switch" role="group" aria-label="Mesure affichée">
      ${charts.map(([label], i) => html`<button type="button" data-show-chart="${i}" aria-pressed="${String(!i)}">${label}</button>`)}
    </div>`,
  });
}

export function bindAnalytics(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".chart-switch").forEach((group) => group.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-show-chart]");
    if (!button) return;
    const cardEl = group.closest(".card")!;
    group.querySelectorAll("[data-show-chart]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    cardEl.querySelectorAll<HTMLElement>("[data-chart]").forEach((c) => (c.hidden = c.dataset.chart !== button.dataset.showChart));
  }));
}

function live(set: Awaited<ReturnType<typeof data.liveActivity>>): Html {
  return card("En ce moment", set, (l) => html`
    <div class="live-count"><span class="live-dot"></span><strong>${formatNumber(l.active)}</strong><span class="muted">${l.active > 1 ? "visites actives" : "visite active"} (5 dernières minutes)</span></div>
    ${l.recent.length
      ? html`<ul class="timeline compact">${l.recent.map((p) => html`<li><span class="when">${formatAgo(p.at)}</span><strong>${p.path}</strong><span>${country(p.country)}</span></li>`)}</ul>`
      : html`<p class="unavailable">Aucune page vue dans la dernière demi-heure.</p>`}`, { icon: "pulse" });
}

export async function traffic(): Promise<Html> {
  const [c, now] = await Promise.all([load(), data.liveActivity()]);
  if (!("report" in c)) return missingPage(c);
  const { current: cur, previous: prev } = c.report;
  const sessions = total(cur, "sessions");
  const prevSessions = total(prev, "sessions");
  const ratio = (p: PeriodSummary, metric: string) => (total(p, "sessions") ? total(p, metric) / total(p, "sessions") : 0);
  const visitors = cur.visitors ?? total(cur, "visitors");
  return html`${notices(c)}
    ${kpis([
      kpi({ icon: "users", label: "Visiteurs uniques", value: cur.visitors === null ? html`≤ ${formatNumber(visitors)}` : formatNumber(visitors),
        hint: cur.visitors === null ? "somme par jour : visites anciennes déjà effacées" : prev.visitors === null ? periodLabel() : versus(c, visitors, prev.visitors) }),
      kpi({ icon: "pulse", label: "Visites", value: formatNumber(sessions), hint: versus(c, sessions, prevSessions) }),
      kpi({ icon: "file", label: "Pages vues", value: formatNumber(total(cur, "pageviews")), hint: versus(c, total(cur, "pageviews"), total(prev, "pageviews")) }),
      kpi({ icon: "analytics", label: "Pages par visite", value: formatNumber(Math.round(ratio(cur, "pageviews") * 10) / 10),
        hint: html`${percentOf(total(cur, "bounces"), sessions)} repartent après une page` }),
      kpi({ icon: "clock", label: "Durée moyenne", value: formatDuration(ratio(cur, "engaged_ms")), hint: versus(c, ratio(cur, "engaged_ms"), ratio(prev, "engaged_ms")) }),
      kpi({ icon: "update", label: "Visiteurs qui reviennent", value: percentOf(total(cur, "returning_sessions"), sessions), hint: "part des visites" }),
    ])}
    <div class="grid">
      ${switchable("Évolution par jour", "analytics", [
        ["Visites", series(c, "sessions", "Visites par jour")],
        ["Visiteurs", series(c, "visitors", "Visiteurs par jour")],
        ["Pages vues", series(c, "pageviews", "Pages vues par jour")],
      ])}
      ${live(now)}
      ${panel("Nouveaux et connus", donut([
        { label: "Première visite", value: sessions - total(cur, "returning_sessions") },
        { label: "Visiteur déjà venu", value: total(cur, "returning_sessions") },
      ], { value: formatNumber(sessions), label: "visites" }), { icon: "users" })}
    </div>`;
}

export async function visitors(): Promise<Html> {
  const c = await load();
  if (!("report" in c)) return missingPage(c);
  const r = c.report;
  const sessions = total(r.current, "sessions");
  const center = { value: formatNumber(sessions), label: "visites" };
  return html`${notices(c)}
    <div class="grid">
      ${panel("Pays", html`${ranking(top(dimension(r, "country"), country, 10))}
        <p class="credit">Pays déduit de l'adresse IP avec <a href="${DBIP_URL}" target="_blank" rel="noopener">IP to Country Lite de DB-IP</a> (CC BY 4.0). L'adresse n'est pas enregistrée.</p>`, { icon: "website" })}
      ${panel("Appareils", donut(slices(dimension(r, "device"), named(DEVICES)), center), { icon: "application" })}
      ${panel("Navigateurs", ranking(top(dimension(r, "browser"), named({}))), { icon: "website" })}
      ${panel("Systèmes", ranking(top(dimension(r, "os"), named({}))), { icon: "settings" })}
      ${panel("Langue du site", donut(slices(dimension(r, "lang"), named(LANGS)), center), { icon: "file" })}
      ${panel("Nouveaux et connus", donut([
        { label: "Première visite", value: sessions - total(r.current, "returning_sessions") },
        { label: "Visiteur déjà venu", value: total(r.current, "returning_sessions") },
      ], center), { icon: "users" })}
    </div>`;
}

function conversionTable(r: AnalyticsReport, key: string, label: (k: string) => string, heading: string): Html {
  const rows = dimension(r, key);
  if (!rows.length) return html`<p class="unavailable">Aucune visite sur la période.</p>`;
  const step = (metric: string, k: string) => r.current.dimensions[`${metric}_by_${key === "source_type" ? "source" : "lang"}`]?.[k] ?? 0;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>${heading}</th><th class="num">Visites</th><th class="num">Clics sur Télécharger</th><th class="num">Téléchargement demandé</th><th class="num">Taux</th></tr></thead>
    <tbody>${rows.map(([k, visits]) => html`<tr>
      <td>${label(k)}</td><td class="num">${formatNumber(visits)}</td><td class="num">${formatNumber(step("clicked", k))}</td>
      <td class="num">${formatNumber(step("requested", k))}</td><td class="num">${percentOf(step("requested", k), visits)}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

export async function acquisition(): Promise<Html> {
  const c = await load();
  if (!("report" in c)) return missingPage(c);
  const r = c.report;
  const referrers = dimension(r, "source").filter(([k]) => k !== "");
  const campaigns = dimension(r, "campaign").filter(([k]) => k !== "");
  return html`${notices(c)}
    <div class="grid">
      ${panel("Sources", ranking(top(dimension(r, "source_type"), named(SOURCES))), { icon: "link" })}
      ${panel("Sites et applications", referrers.length ? ranking(top(referrers, (k) => k, 10)) : html`<p class="unavailable">Aucun site référent sur la période.</p>`, { icon: "external" })}
      ${panel("Visites et téléchargements par source", conversionTable(r, "source_type", named(SOURCES), "Source"), { wide: true, icon: "funnel" })}
      ${panel("Campagnes UTM", campaigns.length
        ? ranking(top(campaigns, (k) => k, 10))
        : html`<p class="unavailable">Aucune campagne sur la période. Ajoutez <code>?utm_source=…&amp;utm_campaign=…</code> aux liens partagés pour les suivre.</p>`, { wide: true, icon: "tag" })}
    </div>`;
}

export async function pages(): Promise<Html> {
  const c = await load();
  if (!("report" in c)) return missingPage(c);
  const r = c.report;
  const views = Object.fromEntries(dimension(r, "page"));
  const engaged = r.current.dimensions.page_engaged_ms ?? {};
  const entries = r.current.dimensions.entry ?? {};
  const exits = r.current.dimensions.exit ?? {};
  const pageviews = total(r.current, "pageviews");
  const downloadViews = Object.entries(views).filter(([p]) => DOWNLOAD_PAGE.test(p)).reduce((n, [, v]) => n + v, 0);
  const rows = dimension(r, "page").slice(0, 30);
  return html`${notices(c)}
    ${kpis([
      kpi({ icon: "file", label: "Pages vues", value: formatNumber(pageviews), hint: versus(c, pageviews, total(r.previous, "pageviews")) }),
      kpi({ icon: "download", label: "Vues de la page Téléchargement", value: formatNumber(downloadViews), hint: "en français et en anglais" }),
      kpi({ icon: "clock", label: "Temps moyen par page", value: formatDuration(pageviews ? total(r.current, "engaged_ms") / pageviews : 0), hint: "temps où la page est affichée" }),
      kpi({ icon: "pulse", label: "Une seule page vue", value: percentOf(total(r.current, "bounces"), total(r.current, "sessions")), hint: "part des visites" }),
    ])}
    <div class="grid">
      ${panel("Pages", rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Page</th><th class="num">Vues</th><th class="num">Temps moyen</th><th class="num">Entrées</th><th class="num">Sorties</th><th class="num">Taux de sortie</th></tr></thead>
        <tbody>${rows.map(([path, n]) => html`<tr>
          <td>${path}</td><td class="num">${formatNumber(n)}</td><td class="num">${formatDuration((engaged[path] ?? 0) / n)}</td>
          <td class="num">${formatNumber(entries[path] ?? 0)}</td><td class="num">${formatNumber(exits[path] ?? 0)}</td><td class="num">${percentOf(exits[path] ?? 0, n)}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p class="unavailable">Aucune page vue sur la période.</p>`, { wide: true, icon: "file" })}
      ${panel("Pages d'arrivée", ranking(top(dimension(r, "entry"), (k) => k)), { icon: "link" })}
      ${panel("Français et anglais", donut(slices(dimension(r, "page_lang"), named(LANGS)), { value: formatNumber(pageviews), label: "pages vues" }), { icon: "website" })}
    </div>`;
}

export async function downloads(): Promise<Html> {
  const [list, c] = await Promise.all([data.releases(), load()]);
  const totals = list.state === "live" ? downloadTotals(list.data) : null;
  const value = (n: number | undefined) => (n === undefined ? html`<span class="muted">Indisponible</span>` : formatNumber(n));
  const measured = "report" in c ? c : null;

  const firstParty = measured
    ? (() => {
        const r = measured.report;
        const requests = total(r.current, "downloads");
        return html`
          ${switchable("Demandes de téléchargement sur aoze.fr", "download", [
            ["Toutes", series(measured, "downloads", "Demandes de téléchargement par jour")],
            ["Depuis une visite", series(measured, "requested", "Visites qui ont demandé le téléchargement, par jour")],
          ])}
          ${panel("Sur la période", html`<div class="live-count"><strong>${formatNumber(requests)}</strong><span class="muted">${requests > 1 ? "demandes" : "demande"}, ${versus(measured, requests, total(r.previous, "downloads"))}</span></div>
            ${ranking(top(dimension(r, "download_version"), (k) => `Aoze ${k}`, 5))}`, { icon: "tag" })}
          ${panel("Par système", ranking(top(dimension(r, "download_os"), named({}))), { icon: "application" })}
          ${panel("Par source de la visite", ranking(top(dimension(r, "download_source"), named({ ...SOURCES, "": "Lien direct, sans visite" }))), { icon: "link" })}
          ${panel("Comptés par GitHub, par jour", r.github.since
            ? html`${timeline({
                label: "Téléchargements de l'installeur comptés par GitHub, par jour",
                days: r.github.series.map((p) => p.day),
                values: r.github.series.map((p) => p.installer),
                dayLabel: formatDay,
              })}<p class="note">Relevé à chaque entretien horaire depuis le ${formatDate(r.github.since)} : une hausse est datée du jour où elle est vue. L'auto-update n'est pas compté ici.</p>`
            : html`<p class="unavailable">Pas encore de relevé des compteurs de GitHub.</p>`, { wide: true, icon: "analytics" })}`;
      })()
    : panel("Demandes de téléchargement sur aoze.fr", (c as Missing).missing, { wide: true, icon: "download" });

  return html`
    ${measured ? notices(measured) : ""}
    ${kpis([
      kpi({ icon: "download", label: "Installeur (site et GitHub)", value: value(totals?.installer), hint: "depuis la publication, compté par GitHub" }),
      kpi({ icon: "update", label: "Installeur (auto-update)", value: value(totals?.updater), hint: "version actuelle seulement" }),
      kpi({ icon: "pulse", label: "Vérifications de mise à jour", value: value(totals?.checks), hint: "lectures de latest.json" }),
      kpi({ icon: "check", label: "Téléchargements terminés", value: html`<span class="muted">Non mesurable</span>`, hint: "ni GitHub ni le site ne le savent" }),
    ])}
    <div class="grid">
      ${firstParty}
      ${card("Installeur téléchargé, par version", list, (rows) => {
        const published = [...publicReleases(rows)].reverse();
        return published.length
          ? bars(published.map((r) => ({ label: r.version, value: r.installer?.downloads ?? 0 })), "Téléchargements de l'installeur par version")
          : html`<p class="unavailable">Aucune release publiée.</p>`;
      }, { wide: true, icon: "analytics", action: html`<a class="card-link" href="#/application/distribution">Par fichier</a>` })}

      ${panel("Ce que ces chiffres veulent dire", html`<ul class="facts">
        <li><strong>Une demande n'est pas un téléchargement terminé.</strong> Le site compte le clic qui part vers GitHub ; personne ne sait si le fichier est arrivé en entier.</li>
        <li><strong>Compté par GitHub.</strong> Chaque requête du fichier, y compris les relances, les gestionnaires de téléchargement et les robots.</li>
        <li><strong>Pas un nombre de personnes.</strong> La même personne peut télécharger plusieurs fois.</li>
      </ul>`, { wide: true, icon: "info" })}
    </div>`;
}

export async function conversions(): Promise<Html> {
  const c = await load();
  if (!("report" in c)) return missingPage(c);
  const r = c.report;
  const cur = r.current;
  const sessions = total(cur, "sessions");
  const rate = (p: PeriodSummary) => (total(p, "sessions") ? total(p, "requested") / total(p, "sessions") : 0);
  return html`${notices(c)}
    ${kpis([
      kpi({ icon: "funnel", label: "Taux de conversion", value: percentOf(total(cur, "requested"), sessions), hint: versus(c, rate(cur), rate(r.previous)) }),
      kpi({ icon: "download", label: "Visites avec téléchargement", value: formatNumber(total(cur, "requested")), hint: versus(c, total(cur, "requested"), total(r.previous, "requested")) }),
      kpi({ icon: "check", label: "Clics sur Télécharger", value: formatNumber(total(cur, "clicked")), hint: versus(c, total(cur, "clicked"), total(r.previous, "clicked")) }),
      kpi({ icon: "pulse", label: "Visites", value: formatNumber(sessions), hint: periodLabel() }),
    ])}
    <div class="grid">
      ${panel("Du passage au téléchargement", html`${funnel([
        { label: "Visites", value: sessions },
        { label: "Bouton de téléchargement vu", value: total(cur, "saw_download") },
        { label: "Clic sur Télécharger", value: total(cur, "clicked") },
        { label: "Avertissement Windows accepté", value: total(cur, "confirmed") },
        { label: "Téléchargement demandé", value: total(cur, "requested") },
      ])}<p class="note">Chaque étape compte des visites, une seule fois même si l'action est répétée. Le téléchargement terminé n'est pas mesurable.</p>`, { icon: "funnel" })}
      ${panel("Téléchargements demandés par jour", series(c, "requested", "Visites qui ont demandé le téléchargement, par jour"), { icon: "analytics" })}
      ${panel("Par langue", conversionTable(r, "lang", named(LANGS), "Langue"), { wide: true, icon: "website" })}
      ${panel("Par source", conversionTable(r, "source_type", named(SOURCES), "Source"), { wide: true, icon: "link" })}
    </div>`;
}
