import { api, ApiError } from "../api";
import * as data from "../data";
import { formatDateTime } from "../format";
import { html, type Html } from "../html";
import type { Announcement, AnnouncementLevel } from "../types";
import { card, confirmAction, pageHead, pill, toast } from "../ui";

const PUBLIC_LINKS: [string, string][] = [
  ["Téléchargement", "Dernière release GitHub, choisie automatiquement"],
  ["Code source", "https://github.com/lololyeye/aoze"],
  ["Soutien", "https://ko-fi.com/aoze_support"],
  ["Contact", "contact@aoze.fr"],
];

type Preview = Pick<Announcement, "level" | "textFr" | "textEn" | "link">;

/** An ISO date as a datetime-local value, in this browser's time zone. */
function toInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function banner(a: Preview, lang: "fr" | "en"): Html {
  const text = lang === "fr" ? a.textFr : a.textEn;
  if (!text.trim()) return html`<p class="unavailable">Pas de texte en ${lang === "fr" ? "français" : "anglais"}.</p>`;
  return html`<div class="${`banner-preview banner-${a.level}`}">
    <span>${text}</span>${a.link ? html` <a href="${a.link}" tabindex="-1">${lang === "fr" ? "En savoir plus" : "Learn more"}</a>` : ""}
  </div>`;
}

function statusLine(a: Announcement): Html {
  const state = a.status === "published"
    ? html`${pill("ok", "En ligne")}${a.pendingChanges ? html` ${pill("warn", "Modifications non publiées")}` : ""}`
    : pill("muted", "Non publié");
  return html`<p class="card-intro" data-status>${state}
    <span class="muted">Modifié ${formatDateTime(a.updatedAt)}. Il s'affiche en haut de toutes les pages, dans la langue du visiteur, entre les dates choisies.</span></p>`;
}

function form(a: Announcement): Html {
  return html`<form class="form" data-announcement>
    <div class="field-row">
      <label class="field"><span>Texte en français</span><textarea name="textFr" maxlength="180" rows="2">${a.textFr}</textarea></label>
      <label class="field"><span>Texte en anglais</span><textarea name="textEn" maxlength="180" rows="2">${a.textEn}</textarea></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Lien (facultatif)</span><input name="link" maxlength="300" placeholder="/download/ ou https://…" value="${a.link}" /></label>
      <label class="field"><span>Ton</span><select name="level">
        <option value="info" ${a.level === "info" ? "selected" : ""}>Information</option>
        <option value="warning" ${a.level === "warning" ? "selected" : ""}>Avertissement</option>
      </select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Début (facultatif, heure française)</span><input name="startsAt" type="datetime-local" value="${toInput(a.startsAt)}" /></label>
      <label class="field"><span>Fin (facultatif, heure française)</span><input name="endsAt" type="datetime-local" value="${toInput(a.endsAt)}" /></label>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" type="submit" name="intent" value="draft">Enregistrer le brouillon</button>
      ${a.status === "published" ? html`<button class="btn btn-ghost" type="submit" name="intent" value="unpublish">Retirer du site</button>` : ""}
      <button class="btn btn-primary" type="submit" name="intent" value="publish">${a.status === "published" ? "Publier les modifications" : "Publier"}</button>
    </div>
  </form>`;
}

export async function site(): Promise<Html> {
  const announcement = await data.announcement();
  return html`
    ${pageHead("Site", "Le bandeau d'annonce du site public et les liens qu'il affiche.")}
    <div class="grid">
      ${card("Bandeau d'annonce", announcement, (a) => html`
        ${statusLine(a)}
        ${form(a)}
        <h3 class="sub">Aperçu</h3>
        <div class="previews" data-previews>${banner(a, "fr")}${banner(a, "en")}</div>`, { wide: true })}

      <section class="card card-wide">
        <header class="card-head"><h2>Liens publics</h2></header>
        <dl class="kvs">${PUBLIC_LINKS.map(([k, v]) => html`<div class="kv"><dt>${k}</dt><dd class="wrap">${v}</dd></div>`)}</dl>
        <p class="note">Les textes et les liens du site sont dans le dépôt GitHub : ils se modifient par un commit, relu avant publication. Le bandeau est le seul contenu modifiable ici.</p>
      </section>
    </div>`;
}

const CONFIRM = {
  publish: { title: "Publier le bandeau ?", text: "Il apparaîtra en haut de toutes les pages du site public, en français et en anglais.", confirm: "Publier" },
  unpublish: { title: "Retirer le bandeau ?", text: "Il disparaîtra du site public. Le texte reste enregistré comme brouillon.", confirm: "Retirer", danger: true },
} as const;

/** Live preview while typing. Publishing and removing change the public site, so they ask first. */
export function bindSite(root: HTMLElement): void {
  const formEl = root.querySelector<HTMLFormElement>("[data-announcement]");
  const previews = root.querySelector<HTMLElement>("[data-previews]");
  if (!formEl || !previews) return;
  const value = (k: string) => String(new FormData(formEl).get(k) ?? "");
  const read = (): Preview => ({
    level: (value("level") === "warning" ? "warning" : "info") as AnnouncementLevel,
    textFr: value("textFr"),
    textEn: value("textEn"),
    link: value("link"),
  });
  formEl.addEventListener("input", () => {
    const a = read();
    previews.innerHTML = html`${banner(a, "fr")}${banner(a, "en")}`.value;
  });
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const intent = (e.submitter as HTMLButtonElement | null)?.value ?? "draft";
    if ((intent === "publish" || intent === "unpublish") && !(await confirmAction(CONFIRM[intent]))) return;
    try {
      await api("announcement", { intent, ...read(), startsAt: value("startsAt"), endsAt: value("endsAt") });
      toast(intent === "publish" ? "Bandeau publié sur le site." : intent === "unpublish" ? "Bandeau retiré du site." : "Brouillon enregistré.");
      window.dispatchEvent(new Event("admin:refresh"));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Le serveur ne répond pas.", "bad");
    }
  });
}
