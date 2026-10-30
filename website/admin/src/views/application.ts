import { donut, ranking } from "../charts";
import * as data from "../data";
import { downloadTotals, publicReleases, RELEASES_URL, UPDATES_TAG, updateChecks } from "../downloads";
import { formatBytes, formatDate, formatNumber } from "../format";
import { html, raw, type Html } from "../html";
import { icon } from "../icons";
import { card, pill, row } from "../ui";

const github = html`<a class="card-link" href="${RELEASES_URL}" target="_blank" rel="noopener">GitHub ${icon("external")}</a>`;

export async function releases(): Promise<Html> {
  const list = await data.releases();
  return html`<div class="grid">
    ${card("Historique des versions", list, (rows) => html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th>Publiée le</th><th>Installeur</th><th class="num">Téléchargements</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td><strong>${r.version}</strong>${r.tag === UPDATES_TAG
            ? html` ${pill("muted", "Copie pour l'auto-update")}`
            : r.prerelease ? html` ${pill("muted", "Pré-version")}` : ""}</td>
          <td>${formatDate(r.publishedAt)}</td>
          <td>${r.installer ? formatBytes(r.installer.size) : html`<span class="muted">Aucun</span>`}</td>
          <td class="num">${formatNumber(r.downloads)}</td>
          <td class="num"><a href="${r.url}" target="_blank" rel="noopener">Voir</a></td>
        </tr>`)}</tbody>
      </table></div>`, { wide: true, icon: "tag", action: github })}

    ${card("Notes de la dernière version", list, (rows) => {
      const latest = publicReleases(rows)[0];
      if (!latest?.notesHtml) return html`<p class="unavailable">Pas de notes publiées.</p>`;
      return html`<h3 class="notes-title">${latest.name}</h3><div class="notes">${raw(latest.notesHtml)}</div>`;
    }, { wide: true, icon: "file" })}
  </div>`;
}

export async function integrity(): Promise<Html> {
  const [manifest, list] = await Promise.all([data.manifest(), data.releases()]);
  return html`<div class="grid">
    ${card("Ce que reçoit l'auto-update (latest.json)", manifest, (m) => html`
      <ul class="checks">
        ${m.checks.map((c) => html`<li class="${`check${c.ok ? "" : " check-bad"}`}">
          <span class="check-mark">${icon(c.ok ? "check" : "alert")}</span><strong>${c.label}</strong><span>${c.detail}</span>
        </li>`)}
      </ul>
      <dl class="kvs">
        ${row("Version annoncée", m.version)}
        ${row("Taille", formatBytes(m.size))}
        ${row("SHA-256", html`<span class="mono wrap">${m.sha256}</span>`)}
        ${row("Fichier", html`<a class="mono wrap" href="${m.url}" target="_blank" rel="noopener">${m.url.replace(`${RELEASES_URL}/download/`, "")}</a>`)}
      </dl>
      <p class="note">Lecture seule : publier une version ou modifier latest.json se fait avec <span class="mono">npm run release</span>, jamais depuis l'admin.</p>`,
    { wide: true, icon: "lock" })}

    ${card("Empreintes des installeurs", list, (rows) => html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th>Fichier</th><th>SHA-256 (publiée par GitHub)</th></tr></thead>
        <tbody>${rows.filter((r) => r.installer).map((r) => html`<tr>
          <td><strong>${r.version}</strong></td>
          <td class="mono">${r.installer!.name}</td>
          <td class="mono">${r.installer!.sha256 ?? html`<span class="muted">Non fournie</span>`}</td>
        </tr>`)}</tbody>
      </table></div>`, { wide: true, icon: "security" })}
  </div>`;
}

export async function distribution(): Promise<Html> {
  const list = await data.releases();
  return html`<div class="grid">
    ${card("Qui télécharge l'installeur", list, (rows) => {
      const totals = downloadTotals(rows);
      return html`${donut([
        { label: "Depuis le site ou GitHub", value: totals.installer, hint: "fichiers des versions publiques" },
        { label: "Par l'auto-update", value: totals.updater, hint: "copie de la version actuelle seulement" },
      ], { value: formatNumber(totals.installer + totals.updater), label: "installeurs servis" })}
      <p class="note">GitHub compte chaque requête du fichier, y compris les relances et les robots. Il ne dit pas si le téléchargement est allé au bout.</p>`;
    }, { icon: "download" })}

    ${card("Fichiers de la dernière version", list, (rows) => {
      const latest = publicReleases(rows)[0];
      if (!latest) return html`<p class="unavailable">Aucune release publiée.</p>`;
      return html`<p class="card-intro"><span class="muted">Aoze ${latest.version}, par nombre de téléchargements.</span></p>
        ${ranking([...latest.assets].sort((a, b) => b.downloads - a.downloads).map((a) => ({ label: a.name, value: a.downloads })))}`;
    }, { icon: "file" })}

    ${card("Par version", list, (rows) => html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Version</th><th class="num">Installeur</th><th class="num">Vérifications de mise à jour</th><th class="num">Autres fichiers</th></tr></thead>
        <tbody>${publicReleases(rows).map((r) => html`<tr>
          <td><strong>${r.version}</strong></td>
          <td class="num">${formatNumber(r.installer?.downloads ?? 0)}</td>
          <td class="num">${formatNumber(updateChecks(r))}</td>
          <td class="num">${formatNumber(r.assets.reduce((n, a) => n + a.downloads, 0) - (r.installer?.downloads ?? 0) - updateChecks(r))}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="note">Une vérification est comptée à chaque fois qu'une copie installée lit latest.json pendant que cette version était la dernière : c'est un signe d'activité, pas un nombre d'utilisateurs.</p>`,
    { wide: true, icon: "update" })}
  </div>`;
}
