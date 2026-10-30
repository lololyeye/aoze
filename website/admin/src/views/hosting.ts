import * as data from "../data";
import { daysUntil, formatAgo, formatBytes, formatDate, shortSha } from "../format";
import { html, type Html } from "../html";
import { card, pageHead, pill, row } from "../ui";

export async function hosting(): Promise<Html> {
  const [certs, pages, deploy, run, server] = await Promise.all([
    data.certificates(), data.pages(), data.deploy(), data.websiteRun(), data.server(),
  ]);

  return html`
    ${pageHead("Hébergement", "aoze.fr chez o2switch : HTTPS, pages, déploiement et serveur.")}
    <div class="grid">
      ${card("Certificats HTTPS", certs, (list) => html`<ul class="list">
        ${list.map((c) => {
          const left = daysUntil(c.validTo);
          return html`<li><strong>${c.host}</strong>
            ${pill(left < 21 ? "warn" : "ok", left < 0 ? "Expiré" : `${left} jours`)}
            <span class="muted">${c.issuer}, jusqu'au ${formatDate(c.validTo)}</span></li>`;
        })}
      </ul><p class="note">Let's Encrypt se renouvelle seul chez o2switch ; une alerte s'affiche à moins de 21 jours.</p>`)}

      ${card("Pages principales", pages, (list) => html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Page</th><th>Réponse</th><th class="num">Temps</th></tr></thead>
        <tbody>${list.map((p) => html`<tr>
          <td class="mono">${p.path}</td>
          <td>${pill(p.status === 200 ? "ok" : "bad", String(p.status))}</td>
          <td class="num">${p.ms} ms</td>
        </tr>`)}</tbody>
      </table></div>`)}

      ${card("Construction du site (GitHub Actions)", run, (r) => r
        ? html`<dl class="kvs">
            ${row("État", r.status !== "completed" ? pill("muted", "En cours") : r.conclusion === "success" ? pill("ok", "Réussie") : pill("bad", "Échec"))}
            ${row("Déclenchée par", r.event === "push" ? "un commit" : r.event === "schedule" ? "la mise à jour programmée" : r.event)}
            ${row("Commit", html`<span class="mono">${shortSha(r.commit)}</span>`)}
            ${row("Terminée", html`<a href="${r.url}" target="_blank" rel="noopener">${formatAgo(r.updatedAt)}</a>`)}
          </dl>`
        : html`<p class="unavailable">Aucune construction trouvée.</p>`)}

      ${card("Déploiement sur o2switch", deploy, (d) => html`<dl class="kvs">
          ${row("Construit (branche site)", html`<span class="mono">${d.builtCommit}</span>`)}
          ${row("En ligne", html`<span class="mono">${d.liveCommit}</span> ${d.builtCommit === d.liveCommit ? pill("ok", "À jour") : pill("warn", "En retard")}`)}
          ${row("Dernière récupération", formatAgo(d.lastPullAt))}
        </dl>
        ${d.logTail.length
          ? html`<pre class="log">${d.logTail.join("\n")}</pre>`
          : html`<p class="note">Aucune erreur dans le journal de déploiement.</p>`}`)}

      ${card("Serveur", server, (s) => html`<dl class="kvs">
        ${row("PHP", s.php)}
        ${row("Base de données", s.database)}
        ${row("Taille de la base", formatBytes(s.databaseSize))}
        ${row("Espace disque", html`<span class="muted">Non disponible : il faudrait un accès complet au compte cPanel</span>`)}
      </dl>`, { wide: true })}
    </div>`;
}
