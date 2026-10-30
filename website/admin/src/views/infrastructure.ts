import { ranking } from "../charts";
import * as data from "../data";
import { daysUntil, formatAgo, formatBytes, formatDate, shortSha } from "../format";
import { html, type Html } from "../html";
import { card, kpi, kpis, panel, pill, row } from "../ui";
import { runState } from "./overview";

const CERT_WARN_DAYS = 21;

export async function hosting(): Promise<Html> {
  const server = await data.server();
  return html`<div class="grid">
    ${card("Serveur", server, (s) => html`<dl class="kvs">
      ${row("Hébergeur", "o2switch, en France")}
      ${row("PHP", s.php)}
      ${row("Base de données", s.database)}
      ${row("Taille de la base", formatBytes(s.databaseSize))}
      ${row("Espace disque", html`<span class="muted">Non disponible : il faudrait un accès complet au compte cPanel</span>`)}
    </dl>`, { icon: "infrastructure" })}
    ${panel("Organisation", html`<dl class="kvs">
      ${row("Site public", html`<span class="mono">~/public_html</span>`)}
      ${row("Données de l'admin", html`<span class="mono">~/aoze-admin</span> <span class="muted">hors du dossier public</span>`)}
      ${row("Mise en ligne", "une tâche cron récupère la branche site toutes les 5 minutes")}
    </dl>`, { icon: "file" })}
  </div>`;
}

export async function deployment(): Promise<Html> {
  const [run, deploy] = await Promise.all([data.websiteRun(), data.deploy()]);
  return html`<div class="grid">
    ${card("Construction du site (GitHub Actions)", run, (r) => r
      ? html`<dl class="kvs">
          ${row("État", pill(...runState(r)))}
          ${row("Déclenchée par", r.event === "push" ? "un commit" : r.event === "schedule" ? "la mise à jour programmée" : r.event)}
          ${row("Commit", html`<span class="mono">${shortSha(r.commit)}</span>`)}
          ${row("Terminée", html`<a href="${r.url}" target="_blank" rel="noopener">${formatAgo(r.updatedAt)}</a>`)}
        </dl>`
      : html`<p class="unavailable">Aucune construction trouvée.</p>`, { icon: "refresh" })}

    ${card("Déploiement sur o2switch", deploy, (d) => html`<dl class="kvs">
        ${row("Construit (branche site)", html`<span class="mono">${d.builtCommit}</span>`)}
        ${row("En ligne", html`<span class="mono">${d.liveCommit}</span> ${d.builtCommit === d.liveCommit ? pill("ok", "À jour") : pill("warn", "En retard")}`)}
        ${row("Dernière récupération", formatAgo(d.lastPullAt))}
      </dl>`, { icon: "download" })}

    ${card("Journal de déploiement", deploy, (d) => d.logTail.length
      ? html`<pre class="log">${d.logTail.join("\n")}</pre>`
      : html`<p class="all-clear">Aucune erreur dans le journal de déploiement.</p>`, { wide: true, icon: "file" })}
  </div>`;
}

export async function https(): Promise<Html> {
  const certs = await data.certificates();
  return html`<div class="grid">
    ${card("Certificats", certs, (list) => html`<ul class="list">
      ${list.map((c) => {
        const left = daysUntil(c.validTo);
        return html`<li><strong>${c.host}</strong>
          ${pill(left < CERT_WARN_DAYS ? "warn" : "ok", left < 0 ? "Expiré" : `${left} jours`)}
          <span class="muted">${c.issuer}, jusqu'au ${formatDate(c.validTo)}</span></li>`;
      })}
    </ul><p class="note">Let's Encrypt se renouvelle seul chez o2switch ; une alerte s'affiche à moins de ${CERT_WARN_DAYS} jours.</p>`, { wide: true, icon: "lock" })}
  </div>`;
}

export async function availability(): Promise<Html> {
  const pages = await data.pages();
  const live = pages.state === "live" ? pages.data : [];
  const up = live.filter((p) => p.status === 200).length;
  const average = live.length ? Math.round(live.reduce((n, p) => n + p.ms, 0) / live.length) : null;
  return html`
    ${pages.state === "live" ? kpis([
      kpi({ icon: "check", label: "Pages qui répondent", value: `${up} / ${live.length}` }),
      kpi({ icon: "pulse", label: "Temps de réponse moyen", value: average === null ? "–" : `${average} ms` }),
    ]) : ""}
    <div class="grid">
      ${card("Pages principales", pages, (list) => html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Page</th><th>Réponse</th><th class="num">Temps</th></tr></thead>
        <tbody>${list.map((p) => html`<tr>
          <td class="mono">${p.path}</td>
          <td>${pill(p.status === 200 ? "ok" : "bad", String(p.status))}</td>
          <td class="num">${p.ms} ms</td>
        </tr>`)}</tbody>
      </table></div>`, { icon: "website" })}
      ${card("Temps de réponse", pages, (list) => ranking([...list].sort((a, b) => b.ms - a.ms).map((p) => ({ label: p.path, value: p.ms })), " ms"), { icon: "pulse" })}
      ${panel("Limite de cette vérification", html`<p class="muted">Le serveur s'interroge lui-même : une panne de tout l'hébergement ne peut pas s'afficher ici. Pour la détecter, il faudrait un service de surveillance extérieur.</p>`, { wide: true, icon: "info" })}
    </div>`;
}
