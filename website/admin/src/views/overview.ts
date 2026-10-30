import * as data from "../data";
import { daysUntil, formatAgo, formatDateTime, formatNumber, shortSha } from "../format";
import { html, type Html } from "../html";
import type { CertificateStatus, Dataset, DeployStatus, ManifestStatus, WorkflowRun } from "../types";
import { barChart, card, pageHead, pill, stat, type Tone } from "../ui";

interface Alert {
  tone: Tone;
  text: string;
  href: string;
}

const CERT_WARN_DAYS = 21;

function alerts(manifest: Dataset<ManifestStatus>, run: Dataset<WorkflowRun | null>, deploy: Dataset<DeployStatus>, certs: Dataset<CertificateStatus[]>): Alert[] {
  const list: Alert[] = [];
  if (manifest.state === "live") {
    for (const c of manifest.data.checks.filter((c) => !c.ok)) list.push({ tone: "bad", text: `latest.json : ${c.label.toLowerCase()}, ${c.detail}`, href: "#/releases" });
  }
  if (run.state === "live" && run.data?.conclusion === "failure") list.push({ tone: "bad", text: "La dernière construction du site a échoué.", href: "#/hosting" });
  if (deploy.state === "live" && deploy.data.builtCommit !== deploy.data.liveCommit) {
    list.push({ tone: "warn", text: "La version en ligne n'est pas encore la dernière construite.", href: "#/hosting" });
  }
  if (certs.state === "live") {
    for (const c of certs.data.filter((c) => daysUntil(c.validTo) < CERT_WARN_DAYS)) {
      list.push({ tone: "warn", text: `Le certificat de ${c.host} expire dans ${daysUntil(c.validTo)} jours.`, href: "#/hosting" });
    }
  }
  return list;
}

function runTone(run: WorkflowRun): [Tone, string] {
  if (run.status !== "completed") return ["muted", "En cours"];
  if (run.conclusion === "success") return ["ok", "Réussie"];
  if (run.conclusion === "failure") return ["bad", "Échec"];
  return ["muted", "Annulée"];
}

export async function overview(): Promise<Html> {
  const [releases, run, manifest, deploy, certs, activity] = await Promise.all([
    data.releases(), data.websiteRun(), data.manifest(), data.deploy(), data.certificates(), data.activity(),
  ]);
  const list = alerts(manifest, run, deploy, certs);
  const watched: [string, Dataset<unknown>][] = [["latest.json", manifest], ["la construction du site", run], ["le déploiement", deploy], ["les certificats HTTPS", certs]];
  const checked = watched.filter(([, set]) => set.state === "live").map(([name]) => name);
  const pending = watched.filter(([, set]) => set.state !== "live").map(([name]) => name);
  const all = releases.state === "unavailable" ? [] : releases.data;
  const published = all.filter((r) => !r.prerelease);

  return html`
    ${pageHead("Vue d'ensemble", "L'état d'Aoze, du site et de l'hébergement.")}
    <div class="grid">
      ${card("En bref", releases, () => {
        const latest = published[0];
        const total = all.reduce((n, r) => n + r.downloads, 0);
        return html`<div class="stats">
          ${stat("Version publique", latest ? latest.version : "Aucune", latest ? `publiée ${formatAgo(latest.publishedAt)}` : "")}
          ${stat("Téléchargements", formatNumber(total), "installeur, toutes versions, mises à jour comprises")}
          ${stat("Versions publiées", String(published.length))}
          ${stat("Fréquentation du site", html`<span class="muted">Non mesurée</span>`, "aucun outil de mesure d'audience")}
        </div>`;
      }, { wide: true })}

      <section class="card card-wide">
        <header class="card-head"><h2>À surveiller</h2></header>
        ${list.length
          ? html`<ul class="alerts">${list.map((a) => html`<li class="${`alert alert-${a.tone}`}"><a href="${a.href}">${a.text}</a></li>`)}</ul>`
          : html`<p class="all-clear">${checked.length ? `Rien à signaler pour ${checked.join(", ")}.` : "Aucune vérification réelle pour l'instant."}</p>`}
        ${pending.length ? html`<p class="note">Impossible à vérifier pour le moment : ${pending.join(", ")}.</p>` : ""}
      </section>

      ${card("Téléchargements par version", releases, () =>
        barChart([...published].reverse().slice(-10).map((r) => ({ label: r.version, value: r.downloads }))), { wide: true })}

      ${card("Site", run, (r) => {
        if (!r) return html`<p class="unavailable">Aucune construction trouvée.</p>`;
        const [tone, label] = runTone(r);
        return html`<dl class="kvs">
          <div class="kv"><dt>Dernière construction</dt><dd>${pill(tone, label)} <a href="${r.url}" target="_blank" rel="noopener">${formatAgo(r.updatedAt)}</a></dd></div>
          <div class="kv"><dt>Commit</dt><dd class="mono">${shortSha(r.commit)}</dd></div>
        </dl>`;
      })}

      ${card("Déploiement sur o2switch", deploy, (d) => html`<dl class="kvs">
        <div class="kv"><dt>En ligne</dt><dd>${d.builtCommit === d.liveCommit ? pill("ok", "À jour") : pill("warn", "En retard")} <span class="mono">${d.liveCommit}</span></dd></div>
        <div class="kv"><dt>Dernière récupération</dt><dd>${formatAgo(d.lastPullAt)}</dd></div>
      </dl>`)}

      ${card("Activité récente", activity, (entries) => html`<ul class="timeline">
        ${entries.slice(0, 5).map((e) => html`<li><span class="when">${formatDateTime(e.at)}</span><strong>${e.action}</strong><span>${e.detail}</span></li>`)}
      </ul>`, { wide: true, action: html`<a class="card-link" href="#/security">Tout l'historique</a>` })}
    </div>`;
}
