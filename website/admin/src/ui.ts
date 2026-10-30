import { formatAgo } from "./format";
import { html, type Html } from "./html";
import { icon, type IconName } from "./icons";
import type { Dataset } from "./types";

export type Tone = "ok" | "warn" | "bad" | "muted";

export const pill = (tone: Tone, label: string): Html => html`<span class="pill pill-${tone}">${label}</span>`;

function sourceTag(set: Dataset<unknown>): Html {
  switch (set.state) {
    case "live":
      return html`<span class="source source-live" data-tip="${`Données mises à jour ${formatAgo(set.fetchedAt)}`}">${formatAgo(set.fetchedAt)}</span>`;
    case "unavailable":
      return html`<span class="source source-off">Indisponible</span>`;
  }
}

interface PanelOptions {
  wide?: boolean;
  action?: Html;
  icon?: IconName;
}

export function panel(title: string, body: Html, opts: PanelOptions & { tag?: Html } = {}): Html {
  return html`<section class="${`card${opts.wide ? " card-wide" : ""}`}">
    <header class="card-head">
      ${opts.icon ? html`<span class="card-icon">${icon(opts.icon)}</span>` : ""}
      <h2>${title}</h2>${opts.action ?? ""}${opts.tag ?? ""}
    </header>
    ${body}
  </section>`;
}

/** A panel whose content depends on a dataset: unavailable data is said so, never shown as 0. */
export function card<T>(title: string, set: Dataset<T>, body: (data: T) => Html, opts: PanelOptions = {}): Html {
  const content = set.state === "unavailable" ? html`<p class="unavailable">${set.reason}</p>` : body(set.data);
  return panel(title, content, { ...opts, tag: sourceTag(set) });
}

export const kpi = (o: { label: string; value: Html | string; hint?: Html | string; icon: IconName }): Html =>
  html`<div class="card kpi">
    <div class="kpi-top"><span class="kpi-icon">${icon(o.icon)}</span><span>${o.label}</span></div>
    <strong class="kpi-value">${o.value}</strong>
    ${o.hint ? html`<span class="kpi-hint">${o.hint}</span>` : ""}
  </div>`;

export const kpis = (items: Html[]): Html => html`<div class="kpis">${items}</div>`;

export const row = (label: string, value: Html | string): Html => html`<div class="kv"><dt>${label}</dt><dd>${value}</dd></div>`;

export const empty = (o: { icon: IconName; title: string; text: Html | string; list?: string[]; action?: Html }): Html =>
  html`<div class="empty">
    <span class="empty-icon">${icon(o.icon)}</span>
    <h3>${o.title}</h3>
    <p>${o.text}</p>
    ${o.list ? html`<ul class="chips">${o.list.map((item) => html`<li>${item}</li>`)}</ul>` : ""}
    ${o.action ?? ""}
  </div>`;

export const skeleton = (): Html => html`<div class="skeleton" aria-hidden="true">
  <div class="kpis">${[1, 2, 3, 4].map(() => html`<div class="card skel skel-kpi"></div>`)}</div>
  <div class="grid"><div class="card skel skel-wide"></div><div class="card skel"></div><div class="card skel"></div></div>
</div>`;

/** Applies sizes that the Content-Security-Policy keeps out of inline style attributes. */
export function applySizes(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-h]").forEach((el) => el.style.setProperty("--h", `${el.dataset.h}%`));
  root.querySelectorAll<HTMLElement>("[data-w]").forEach((el) => el.style.setProperty("--w", `${el.dataset.w}%`));
}

/** One shared tooltip for every element with data-tip, on hover and on keyboard focus. */
export function bindTooltips(tip: HTMLElement): void {
  const show = (e: Event) => {
    const target = (e.target as Element).closest<HTMLElement>("[data-tip]");
    if (!target) return;
    tip.textContent = target.dataset.tip ?? "";
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2, tip.offsetWidth / 2 + 8), innerWidth - tip.offsetWidth / 2 - 8);
    const above = box.top > tip.offsetHeight + 16;
    tip.classList.toggle("tip-below", !above);
    tip.style.setProperty("left", `${x}px`);
    tip.style.setProperty("top", `${above ? box.top - 10 : box.bottom + 10}px`);
  };
  const hide = (e: Event) => {
    if ((e.target as Element).closest("[data-tip]")) tip.hidden = true;
  };
  document.addEventListener("pointerover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("pointerout", hide);
  document.addEventListener("focusout", hide);
  addEventListener("scroll", () => (tip.hidden = true), { passive: true, capture: true });
}

const TOAST_ICONS: Record<Tone, IconName> = { ok: "check", warn: "alert", bad: "alert", muted: "info" };

export function toast(message: string, tone: Tone = "ok"): void {
  const stack = document.querySelector<HTMLElement>("#toasts")!;
  const el = document.createElement("div");
  el.className = `toast toast-${tone}`;
  el.setAttribute("role", tone === "bad" ? "alert" : "status");
  el.innerHTML = html`<span class="toast-icon">${icon(TOAST_ICONS[tone])}</span><p>${message}</p>
    <button class="icon-btn" type="button" aria-label="Fermer">${icon("close")}</button>`.value;
  const close = () => {
    el.classList.add("toast-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };
  el.querySelector("button")!.addEventListener("click", close);
  stack.append(el);
  while (stack.children.length > 3) stack.firstElementChild!.remove();
  setTimeout(close, tone === "bad" ? 7000 : 4000);
}

/** Resolves true only when the user confirms. Destructive actions always go through it. */
export function confirmAction(opts: { title: string; text: string; confirm: string; danger?: boolean }): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>("#confirm")!;
  dialog.innerHTML = html`<form method="dialog" class="confirm">
    <span class="${`confirm-icon${opts.danger ? " confirm-danger" : ""}`}">${icon(opts.danger ? "alert" : "info")}</span>
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
