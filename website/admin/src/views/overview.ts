import { bars, delta } from "../charts";
import * as data from "../data";
import { downloadTotals, publicReleases } from "../downloads";
import { daysUntil, formatAgo, formatDateTime, formatNumber, shortSha } from "../format";
import { html, type Html } from "../html";
import { icon } from "../icons";
import { shiftDay, today } from "../range";
import type { AnalyticsReport, CertificateStatus, Dataset, DeployStatus, ManifestStatus, PageStatus, WorkflowRun } from "../types";
import { card, kpi, kpis, panel, pill, type Tone } from "../ui";

interface Alert {
  tone: Tone;
  text: string;
  href: string;
}

const CERT_WARN_DAYS = 21;

function alerts(manifest: Dataset<ManifestStatus>, run: Dataset<WorkflowRun | null>, deploy: Dataset<DeployStatus>, certs: Dataset<CertificateStatus[]>): Alert[] {
  const list: Alert[] = [];
  if (manifest.state === "live") {
    for (const c of manifest.data.checks.filter((c) => !c.ok)) list.push({ tone: "bad", text: `latest.json : ${c.label.toLowerCase()}, ${c.detail}`, href: "#/application/integrity" });
  }
  if (run.state === "live" && run.data?.conclusion === "failure") list.push({ tone: "bad", text: "La dernière construction du site a échoué.", href: "#/infrastructure/deployment" });
  if (deploy.state === "live" && deploy.data.builtCommit !== deploy.data.liveCommit) {
    list.push({ tone: "warn", text: "La version en ligne n'est pas encore la dernière construite.", href: "#/infrastructure/deployment" });
  }
  if (certs.state === "live") {
    for (const c of certs.data.filter((c) => daysUntil(c.validTo) < CERT_WARN_DAYS)) {
      list.push({ tone: "warn", text: `Le certificat de ${c.host} expire dans ${daysUntil(c.validTo)} jours.`, href: "#/infrastructure/https" });
    }
  }
  return list;
}

export function runState(run: WorkflowRun): [Tone, string] {
  if (run.status !== "completed") return ["muted", "En cours"];
  if (run.conclusion === "success") return ["ok", "Réussie"];
  if (run.conclusion === "failure") return ["bad", "Échec"];
  return ["muted", "Annulée"];
}

interface Service {
  label: string;
  href: string;
  state: [Tone, string] | null;
  detail: string;
}

function services(manifest: Dataset<ManifestStatus>, run: Dataset<WorkflowRun | null>, deploy: Dataset<DeployStatus>, certs: Dataset<CertificateStatus[]>, pages: Dataset<PageStatus[]>): Service[] {
  const soonest = certs.state === "live" && certs.data.length ? Math.min(...certs.data.map((c) => daysUntil(c.validTo))) : null;
  const up = pages.state === "live" ? pages.data.filter((p) => p.status === 200).length : 0;
  return [
    {
      label: "Auto-update",
      href: "#/application/integrity",
      state: manifest.state === "live" ? (manifest.data.checks.every((c) => c.ok) ? ["ok", "Cohérent"] : ["bad", "Problème"]) : null,
      detail: manifest.state === "live" ? `latest.json annonce ${manifest.data.version}` : manifest.reason,
    },
    {
      label: "Construction du site",
      href: "#/infrastructure/deployment",
      state: run.state === "live" && run.data ? runState(run.data) : null,
      detail: run.state === "live" ? (run.data ? `${shortSha(run.data.commit)}, ${formatAgo(run.data.updatedAt)}` : "Aucune construction trouvée.") : run.reason,
    },
    {
      label: "Déploiement",
      href: "#/infrastructure/deployment",
      state: deploy.state === "live" ? (deploy.data.builtCommit === deploy.data.liveCommit ? ["ok", "À jour"] : ["warn", "En retard"]) : null,
      detail: deploy.state === "live" ? `récupéré ${formatAgo(deploy.data.lastPullAt)}` : deploy.reason,
    },
    {
      label: "HTTPS",
      href: "#/infrastructure/https",
      state: soonest === null ? null : soonest < CERT_WARN_DAYS ? ["warn", `${soonest} jours`] : ["ok", "Valide"],
      detail: soonest === null ? (certs.state === "live" ? "Aucun certificat lu." : certs.reason) : `prochaine expiration dans ${soonest} jours`,
    },
    {
      label: "Pages principales",
      href: "#/infrastructure/availability",
      state: pages.state === "live" ? (up === pages.data.length ? ["ok", "En ligne"] : ["bad", `${pages.data.length - up} en erreur`]) : null,
      detail: pages.state === "live" ? `${up} sur ${pages.data.length} répondent` : pages.reason,
    },
  ];
}

/** Visitors over the last 30 days, compared with the 30 before once those were measured too. */
function visitorsKpi(set: Dataset<AnalyticsReport>): Html {
  if (set.state === "unavailable") return kpi({ icon: "users", label: "Visiteurs du site", value: html`<span class="muted">Indisponible</span>`, hint: set.reason });
  const r = set.data;
  if (!r.measuredSince) {
    return kpi({ icon: "users", label: "Visiteurs du site", value: html`<span class="muted">Non mesuré</span>`,
      hint: html`<a href="#/settings">${r.enabled ? "aucune visite comptée pour l'instant" : "mesure d'audience pas encore active"}</a>` });
  }
  const current = r.current.visitors ?? r.current.totals.visitors ?? 0;
  const previous = r.previous.visitors;
  return kpi({ icon: "users", label: "Visiteurs du site", value: formatNumber(current),
    hint: previous !== null && r.measuredSince <= r.previous.from ? html`${delta(current, previous)} sur 30 jours` : html`<a href="#/analytics/traffic">30 derniers jours</a>` });
}

export async function overview(): Promise<Html> {
  const end = today();
  const [releases, run, manifest, deploy, certs, pages, activity, audience] = await Promise.all([
    data.releases(), data.websiteRun(), data.manifest(), data.deploy(), data.certificates(), data.pages(), data.activity(),
    data.analyticsReport(shiftDay(end, -29), end),
  ]);
  const list = alerts(manifest, run, deploy, certs);
  const all = releases.state === "live" ? releases.data : [];
  const published = publicReleases(all);
  const latest = published[0];
  const totals = downloadTotals(all);
  const unknown = html`<span class="muted">Indisponible</span>`;
  const live = releases.state === "live";

  return html`
    ${kpis([
      kpi({ icon: "tag", label: "Version publique", value: latest ? latest.version : live ? "Aucune" : unknown, hint: latest ? `publiée ${formatAgo(latest.publishedAt)}` : "" }),
      kpi({ icon: "download", label: "Téléchargements de l'installeur", value: live ? formatNumber(totals.installer) : unknown, hint: "GitHub, toutes versions publiques" }),
      kpi({ icon: "update", label: "Vérifications de mise à jour", value: live ? formatNumber(totals.checks) : unknown, hint: "lectures de latest.json par l'application" }),
      visitorsKpi(audience),
    ])}
    <div class="grid">
      ${panel("À surveiller", list.length
        ? html`<ul class="alerts">${list.map((a) => html`<li class="${`alert alert-${a.tone}`}"><a href="${a.href}">${icon(a.tone === "bad" ? "alert" : "info")}<span>${a.text}</span></a></li>`)}</ul>`
        : html`<p class="all-clear">${icon("check")}<span>Rien à signaler sur ce qui a pu être vérifié.</span></p>`, { wide: true, icon: "alert" })}

      ${card("Téléchargements par version", releases, () => published.length
        ? bars([...published].reverse().slice(-10).map((r) => ({
            label: r.version,
            value: r.installer?.downloads ?? 0,
            tip: `Aoze ${r.version} : ${formatNumber(r.installer?.downloads ?? 0)} téléchargements de l'installeur`,
          })), "Téléchargements de l'installeur par version")
        : html`<p class="unavailable">Aucune release publiée.</p>`, { wide: true, icon: "analytics", action: html`<a class="card-link" href="#/analytics/downloads">Détails</a>` })}

      ${panel("État des services", html`<ul class="services">
        ${services(manifest, run, deploy, certs, pages).map((s) => html`<li><a href="${s.href}">
          <span class="service-name">${s.label}</span>
          ${s.state ? pill(...s.state) : pill("muted", "Indisponible")}
          <span class="service-detail">${s.detail}</span>
        </a></li>`)}
      </ul>`, { icon: "pulse" })}

      ${card("Activité récente", activity, (entries) => entries.length
        ? html`<ul class="timeline compact">
            ${entries.slice(0, 6).map((e) => html`<li><span class="when">${formatDateTime(e.at)}</span><strong>${e.action}</strong><span>${e.detail}</span></li>`)}
          </ul>`
        : html`<p class="unavailable">Rien pour l'instant.</p>`, { icon: "file", action: html`<a class="card-link" href="#/security/audit">Tout le journal</a>` })}
    </div>`;
}
