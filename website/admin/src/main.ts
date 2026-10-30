import "@fontsource-variable/inter/wght.css";
import "./admin.css";
import { api, ApiError, loadSession, type SessionState } from "./api";
import { html, raw, type Html } from "./html";
import { icon, type IconName } from "./icons";
import { applySizes, bindTooltips, skeleton } from "./ui";
import * as analytics from "./views/analytics";
import * as application from "./views/application";
import * as infrastructure from "./views/infrastructure";
import { overview } from "./views/overview";
import * as security from "./views/security";
import { applyPreferences, bindSettings, settings } from "./views/settings";
import * as website from "./views/website";

interface Page {
  slug: string;
  label: string;
  lead: string;
  render: () => Promise<Html>;
  bind?: (root: HTMLElement) => void;
}

interface Section {
  slug: string;
  label: string;
  icon: IconName;
  pages: Page[];
  /** Pages with a period selector. */
  ranged?: boolean;
}

const SECTIONS: Section[] = [
  { slug: "", label: "Vue d'ensemble", icon: "overview", pages: [
    { slug: "", label: "Vue d'ensemble", lead: "L'état d'Aoze, du site et de l'hébergement en un coup d'œil.", render: overview },
  ] },
  { slug: "analytics", label: "Analytics", icon: "analytics", ranged: true, pages: [
    { slug: "traffic", label: "Trafic", lead: "Pages vues, visites et leur évolution.", render: analytics.traffic },
    { slug: "visitors", label: "Visiteurs", lead: "D'où viennent les visiteurs et avec quel appareil.", render: analytics.visitors },
    { slug: "acquisition", label: "Acquisition", lead: "Comment les visiteurs arrivent sur aoze.fr.", render: analytics.acquisition },
    { slug: "pages", label: "Pages", lead: "Les pages lues, par où on entre et par où on part.", render: analytics.pages },
    { slug: "downloads", label: "Téléchargements", lead: "Ce qui est réellement téléchargé, et ce qu'on ne peut pas mesurer.", render: analytics.downloads },
    { slug: "conversions", label: "Conversions", lead: "Du premier passage sur le site jusqu'au téléchargement.", render: analytics.conversions },
  ] },
  { slug: "application", label: "Application", icon: "application", pages: [
    { slug: "releases", label: "Releases", lead: "Les versions publiées sur GitHub.", render: application.releases },
    { slug: "integrity", label: "Intégrité", lead: "Ce que reçoit l'auto-update, vérifié comme le fait l'application.", render: application.integrity },
    { slug: "distribution", label: "Distribution", lead: "Quels fichiers GitHub distribue, et à qui.", render: application.distribution },
  ] },
  { slug: "website", label: "Site", icon: "website", pages: [
    { slug: "announcements", label: "Annonces", lead: "Le bandeau affiché en haut du site public.", render: website.announcements, bind: website.bindAnnouncements },
    { slug: "content", label: "Contenu public", lead: "Les liens et les pages que le site met en avant.", render: website.content },
  ] },
  { slug: "infrastructure", label: "Infrastructure", icon: "infrastructure", pages: [
    { slug: "hosting", label: "Hébergement", lead: "aoze.fr chez o2switch.", render: infrastructure.hosting },
    { slug: "deployment", label: "Déploiement", lead: "De GitHub Actions jusqu'au serveur.", render: infrastructure.deployment },
    { slug: "https", label: "HTTPS", lead: "Les certificats du domaine.", render: infrastructure.https },
    { slug: "availability", label: "Disponibilité", lead: "Les pages principales, vérifiées par le serveur lui-même.", render: infrastructure.availability },
  ] },
  { slug: "security", label: "Sécurité", icon: "security", pages: [
    { slug: "logins", label: "Connexions", lead: "Chaque tentative de connexion à l'admin.", render: security.logins },
    { slug: "sessions", label: "Sessions", lead: "Les appareils connectés en ce moment.", render: security.sessions, bind: security.bindSecurity },
    { slug: "account", label: "Compte et 2FA", lead: "Mot de passe, double authentification et accès à /admin.", render: security.account, bind: security.bindSecurity },
    { slug: "audit", label: "Journal", lead: "Tout ce qui a été fait depuis l'admin.", render: security.audit },
  ] },
  { slug: "settings", label: "Réglages", icon: "settings", pages: [
    { slug: "", label: "Réglages", lead: "Mesure d'audience, confidentialité et préférences de l'admin.", render: settings, bind: bindSettings },
  ] },
];

const LOGO = `<svg viewBox="240 200 640 620" aria-hidden="true"><path d="M292 772 L512 248 L732 772" fill="none" stroke="#eef1f5" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/><path d="M392 616 L800 616" fill="none" stroke="#3dd6d0" stroke-width="76" stroke-linecap="round"/><circle cx="800" cy="616" r="62" fill="#5ff0d4"/></svg>`;

const href = (section: Section, page?: Page): string =>
  `#/${[section.slug, page?.slug ?? ""].filter(Boolean).join("/")}`;

const app = document.querySelector<HTMLElement>("#app")!;
let session: SessionState | null = null;
let expired = false;

/** The sidebar becomes a drawer on narrow screens. */
function openNav(open: boolean): void {
  document.body.classList.toggle("nav-open", open);
  app.querySelector("[data-open-nav]")?.setAttribute("aria-expanded", String(open));
}

function shell(email: string): void {
  app.innerHTML = html`
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/">${raw(LOGO)}<span>Aoze</span><span class="brand-tag">Admin</span></a>
        <nav class="nav" aria-label="Administration">
          ${SECTIONS.map((s) => html`<a href="${href(s)}" data-section="${s.slug}">${icon(s.icon)}<span>${s.label}</span></a>`)}
        </nav>
        <div class="account">
          <span class="avatar" aria-hidden="true">${email.slice(0, 1).toUpperCase()}</span>
          <span class="account-mail" title="${email}">${email}</span>
          <button class="icon-btn" type="button" data-logout aria-label="Se déconnecter" data-tip="Se déconnecter">${icon("logout")}</button>
        </div>
      </aside>
      <div class="scrim" data-close-nav></div>
      <div class="content">
        <header class="topbar">
          <button class="icon-btn menu-btn" type="button" data-open-nav aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button>
          <ol class="crumbs" id="crumbs"></ol>
          <div class="topbar-actions">
            <button class="icon-btn" type="button" data-refresh aria-label="Actualiser" data-tip="Actualiser">${icon("refresh")}</button>
            <a class="btn btn-ghost btn-sm" href="https://aoze.fr" target="_blank" rel="noopener">${icon("external")}<span>Voir le site</span></a>
          </div>
        </header>
        <div class="page-intro" id="intro"></div>
        <main class="main" id="main" tabindex="-1"></main>
      </div>
    </div>`.value;

  app.querySelector("[data-open-nav]")!.addEventListener("click", () => openNav(true));
  app.querySelector("[data-close-nav]")!.addEventListener("click", () => openNav(false));
  app.querySelector(".nav")!.addEventListener("click", () => openNav(false));
  app.querySelector("[data-refresh]")!.addEventListener("click", () => void route());
  app.querySelector("[data-logout]")!.addEventListener("click", async () => {
    try {
      await api("logout", {});
    } finally {
      session = null;
      location.hash = "#/";
      void route();
    }
  });
}

/** The sign-in and first-run screens share one card; `onSubmit` throws to show an error. */
function gate(opts: { title: string; lead: string; fields: Html; submit: string; onSubmit: (form: FormData) => Promise<void> }): void {
  document.title = `${opts.title} · Aoze Admin`;
  app.innerHTML = html`
    <main class="login">
      <form class="login-card" data-gate>
        <div class="login-logo">${raw(LOGO)}</div>
        <h1>${opts.title}</h1>
        <p class="muted">${opts.lead}</p>
        ${opts.fields}
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${opts.submit}</button>
      </form>
    </main>`.value;
  const form = app.querySelector<HTMLFormElement>("[data-gate]")!;
  const error = form.querySelector<HTMLElement>(".form-error")!;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  form.querySelector<HTMLInputElement>("input")?.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.hidden = true;
    try {
      await opts.onSubmit(new FormData(form));
      session = await loadSession();
      expired = false;
      location.hash = "#/";
      void route();
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : "Connexion au serveur impossible.";
      error.hidden = false;
      button.disabled = false;
    }
  });
}

function message(title: string, text: string): void {
  document.title = `${title} · Aoze Admin`;
  app.innerHTML = html`<main class="login"><div class="login-card">
    <div class="login-logo">${raw(LOGO)}</div>
    <h1>${title}</h1>
    <p class="muted">${text}</p>
  </div></main>`.value;
}

const field = (name: string, label: string, type: string, autocomplete: string, minLength = 0): Html =>
  html`<label class="field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" ${minLength ? raw(`minlength="${minLength}"`) : ""} required /></label>`;

function login(): void {
  gate({
    title: "Administration",
    lead: expired ? "Votre session a expiré : reconnectez-vous." : "Réservé à l'administrateur d'Aoze.",
    fields: html`
      ${field("email", "Adresse e-mail", "email", "username")}
      ${field("password", "Mot de passe", "password", "current-password")}
      <label class="field"><span>Code de double authentification</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="Seulement si elle est activée" /></label>`,
    submit: "Se connecter",
    onSubmit: (f) => api("login", { email: f.get("email"), password: f.get("password"), code: f.get("code") ?? "" }),
  });
}

function setup(ready: boolean): void {
  if (!ready) {
    return message("Mise en place", "Aucun compte administrateur n'existe encore. Ajoutez un code de mise en place (au moins 24 caractères) dans ~/aoze-admin/config.php, puis rechargez cette page.");
  }
  gate({
    title: "Mise en place",
    lead: "Créez le compte administrateur. Cette page ne fonctionne qu'une fois.",
    fields: html`
      ${field("token", "Code de mise en place (dans config.php)", "password", "off")}
      ${field("email", "Adresse e-mail", "email", "username")}
      ${field("password", "Mot de passe (12 caractères minimum)", "password", "new-password", 12)}
      ${field("confirm", "Confirmer le mot de passe", "password", "new-password", 12)}`,
    submit: "Créer le compte",
    onSubmit: async (f) => {
      if (f.get("password") !== f.get("confirm")) throw new ApiError(422, "Les deux mots de passe ne sont pas identiques.");
      await api("setup", { token: f.get("token"), email: f.get("email"), password: f.get("password") });
    },
  });
}

function locate(): [Section, Page] {
  const [sectionSlug = "", pageSlug = ""] = location.hash.replace(/^#\/?/, "").split("/");
  const section = SECTIONS.find((s) => s.slug === sectionSlug) ?? SECTIONS[0]!;
  return [section, section.pages.find((p) => p.slug === pageSlug) ?? section.pages[0]!];
}

const rangePicker = (): Html => html`<div class="segmented" role="group" aria-label="Période" data-tip="Disponible dès que la mesure d'audience sera active">
  ${["7 j", "30 j", "90 j", "12 mois"].map((label, i) => html`<button type="button" disabled ${i === 1 ? raw('aria-pressed="true"') : ""}>${label}</button>`)}
  <button type="button" disabled>${icon("calendar")}<span>Personnalisée</span></button>
</div>`;

function intro(section: Section, page: Page): Html {
  const tabs = section.pages.length > 1
    ? html`<nav class="tabs" aria-label="${section.label}">${section.pages.map((p) =>
        html`<a href="${href(section, p)}" ${p === page ? raw('aria-current="page"') : ""}>${p.label}</a>`)}</nav>`
    : "";
  return html`<div class="intro-text"><h1>${page.label}</h1><p>${page.lead}</p></div>
    ${section.ranged ? rangePicker() : ""}
    ${tabs}`;
}

let renderId = 0;

async function route(): Promise<void> {
  if (!session) {
    try {
      session = await loadSession();
    } catch {
      return message("Serveur injoignable", "Réessayez dans un instant.");
    }
  }
  if (session.state === "setup") return setup(session.setupReady === true);
  if (session.state !== "signed-in") return login();

  if (!app.querySelector(".layout")) shell(session.email ?? "");
  const [section, page] = locate();
  document.querySelector<HTMLElement>("#tip")!.hidden = true;
  app.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.section === section.slug));
  app.querySelector("#crumbs")!.innerHTML = html`<li>Aoze</li>${section.pages.length > 1 ? html`<li>${section.label}</li>` : ""}<li aria-current="page">${page.label}</li>`.value;
  app.querySelector("#intro")!.innerHTML = intro(section, page).value;

  const main = app.querySelector<HTMLElement>("#main")!;
  const id = ++renderId;
  main.setAttribute("aria-busy", "true");
  const slow = setTimeout(() => {
    if (id === renderId) main.innerHTML = skeleton().value;
  }, 120);
  let content: Html;
  try {
    content = await page.render();
  } catch (e) {
    console.error(e);
    content = html`<section class="card"><h2>Cette page n'a pas pu s'afficher.</h2><p class="note">Rechargez la page. Si le problème revient, le détail est dans la console du navigateur.</p></section>`;
  }
  clearTimeout(slow);
  if (id !== renderId || !app.contains(main)) return;
  main.innerHTML = content.value;
  main.removeAttribute("aria-busy");
  applySizes(main);
  page.bind?.(main);
  main.focus({ preventScroll: true });
  document.title = `${page.label} · Aoze Admin`;
}

applyPreferences();
bindTooltips(document.querySelector<HTMLElement>("#tip")!);
addEventListener("keydown", (e) => {
  if (e.key === "Escape") openNav(false);
});
addEventListener("hashchange", () => void route());
addEventListener("admin:refresh", () => void route());
addEventListener("admin:signed-out", () => {
  if (session?.state !== "signed-in") return;
  session = null;
  expired = true;
  void route();
});
void route();
