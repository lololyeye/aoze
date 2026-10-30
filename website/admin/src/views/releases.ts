import * as data from "../data";
import { formatBytes, formatDate, formatNumber } from "../format";
import { html, raw, type Html } from "../html";
import { card, pageHead, pill, row } from "../ui";

const RELEASES_URL = "https://github.com/lololyeye/aoze/releases";
/** Pre-release holding the installer copies that 1.3.1's latest.json points to. */
const UPDATES_TAG = "updates";

export async function releases(): Promise<Html> {
  const [list, manifest] = await Promise.all([data.releases(), data.manifest()]);

  return html`
    ${pageHead("Application et releases", "Les versions publiées sur GitHub et ce que reçoit l'auto-update.",
      html`<a class="btn btn-ghost" href="${RELEASES_URL}" target="_blank" rel="noopener">Ouvrir sur GitHub</a>`)}
    <div class="grid">
      ${card("Ce que reçoit l'auto-update (latest.json)", manifest, (m) => html`
        <dl class="kvs">
          ${row("Version annoncée", m.version)}
          ${row("Taille", formatBytes(m.size))}
          ${row("SHA-256", html`<span class="mono wrap">${m.sha256}</span>`)}
          ${row("Fichier", html`<a class="mono wrap" href="${m.url}" target="_blank" rel="noopener">${m.url.replace("https://github.com/lololyeye/aoze/releases/download/", "")}</a>`)}
        </dl>
        <ul class="checks">
          ${m.checks.map((c) => html`<li>${pill(c.ok ? "ok" : "bad", c.ok ? "OK" : "Problème")}<strong>${c.label}</strong><span>${c.detail}</span></li>`)}
        </ul>
        <p class="note">Lecture seule : publier une version ou modifier latest.json se fait avec <span class="mono">npm run release</span>, jamais depuis ce tableau de bord.</p>`,
      { wide: true })}

      ${card("Historique des versions", list, (rows) => html`
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Version</th><th>Publiée le</th><th>Installeur</th><th class="num">Téléchargements</th><th>SHA-256</th><th></th></tr></thead>
          <tbody>${rows.map((r) => html`<tr>
            <td><strong>${r.version}</strong>${r.tag === UPDATES_TAG
              ? html` ${pill("muted", "Copies pour l'auto-update")}`
              : r.prerelease ? html` ${pill("muted", "Pré-version")}` : ""}</td>
            <td>${formatDate(r.publishedAt)}</td>
            <td>${r.installer ? formatBytes(r.installer.size) : html`<span class="muted">Aucun</span>`}</td>
            <td class="num">${formatNumber(r.downloads)}</td>
            <td class="mono">${r.installer?.sha256 ? `${r.installer.sha256.slice(0, 12)}…` : html`<span class="muted">Non fournie</span>`}</td>
            <td><a href="${r.url}" target="_blank" rel="noopener">GitHub</a></td>
          </tr>`)}</tbody>
        </table></div>`, { wide: true })}

      ${card("Notes de la dernière version", list, (rows) => {
        const latest = rows.find((r) => !r.prerelease);
        if (!latest?.notesHtml) return html`<p class="unavailable">Pas de notes publiées.</p>`;
        return html`<h3 class="notes-title">${latest.name}</h3><div class="notes">${raw(latest.notesHtml)}</div>`;
      }, { wide: true })}
    </div>`;
}
