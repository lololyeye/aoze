import { formatAgo } from "./format";
import { html, type Html } from "./html";
import type { Dataset } from "./types";

export type Tone = "ok" | "warn" | "bad" | "muted";

export const pill = (tone: Tone, label: string): Html => html`<span class="pill pill-${tone}">${label}</span>`;

function sourceTag(set: Dataset<unknown>): Html {
  switch (set.state) {
    case "live":
      return html`<span class="source source-live" title="${`Mis à jour ${formatAgo(set.fetchedAt)}`}">Direct</span>`;
    case "sample":
      return html`<span class="source source-sample" title="Valeurs d'exemple : le serveur les fournira">Exemple</span>`;
    case "unavailable":
      return html`<span class="source source-off">Indisponible</span>`;
  }
}

/** A titled panel whose content depends on a dataset: unavailable data is said so, never shown as 0. */
export function card<T>(title: string, set: Dataset<T>, body: (data: T) => Html, opts: { wide?: boolean; action?: Html } = {}): Html {
  const content = set.state === "unavailable"
    ? html`<p class="unavailable">${set.reason}</p>`
    : body(set.data);
  return html`<section class="${`card${opts.wide ? " card-wide" : ""}`}">
    <header class="card-head"><h2>${title}</h2>${opts.action ?? ""}${sourceTag(set)}</header>
    ${content}
  </section>`;
}

export const stat = (label: string, value: Html | string, hint?: Html | string): Html =>
  html`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong>${hint ? html`<span class="stat-hint">${hint}</span>` : ""}</div>`;

export const row = (label: string, value: Html | string): Html => html`<div class="kv"><dt>${label}</dt><dd>${value}</dd></div>`;

/** Bars of downloads per release, oldest on the left. */
export function barChart(points: { label: string; value: number }[]): Html {
  if (!points.length) return html`<p class="unavailable">Aucune release publiée.</p>`;
  const max = Math.max(...points.map((p) => p.value), 1);
  return html`<div class="bars" role="img" aria-label="Téléchargements par version">
    ${points.map((p) => html`<div class="bar" title="${`${p.label} : ${p.value}`}">
      <span class="bar-value">${p.value}</span>
      <span class="bar-fill" data-h="${(p.value / max) * 100}"></span>
      <span class="bar-label">${p.label}</span>
    </div>`)}
  </div>`;
}

/** Applies values that the Content-Security-Policy keeps out of inline style attributes. */
export function applyBarHeights(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-h]").forEach((el) => el.style.setProperty("--h", `${el.dataset.h}%`));
}

export const pageHead = (title: string, lead: string, actions?: Html): Html =>
  html`<header class="page-head"><div><h1>${title}</h1><p>${lead}</p></div>${actions ?? ""}</header>`;

let toastTimer = 0;
export function toast(message: string, tone: Tone = "ok"): void {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.className = `toast toast-${tone} toast-on`;
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("toast-on"), 3200);
}

/** Resolves true only when the user confirms. Destructive actions always go through it. */
export function confirmAction(opts: { title: string; text: string; confirm: string; danger?: boolean }): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>("#confirm")!;
  dialog.innerHTML = html`<form method="dialog" class="confirm">
    <h2>${opts.title}</h2>
    <p>${opts.text}</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" value="cancel">Annuler</button>
      <button class="${`btn ${opts.danger ? "btn-danger" : "btn-primary"}`}" value="ok">${opts.confirm}</button>
    </div>
  </form>`.value;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true }));
}
