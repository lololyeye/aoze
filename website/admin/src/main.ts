import "@fontsource-variable/inter/wght.css";
import "./admin.css";
import { api, ApiError, loadSession, type SessionState } from "./api";
import { html, raw, type Html } from "./html";
import { applyBarHeights } from "./ui";
import { hosting } from "./views/hosting";
import { overview } from "./views/overview";
import { releases } from "./views/releases";
import { bindSecurity, security } from "./views/security";
import { bindSite, site } from "./views/site";

interface Route {
  path: string;
  label: string;
  icon: string;
  render: () => Promise<Html>;
  bind?: (root: HTMLElement) => void;
}

const ICONS = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',
  releases: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',
  site: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  hosting: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  security: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
};

const ROUTES: Route[] = [
  { path: "/", label: "Vue d'ensemble", icon: ICONS.overview, render: overview },
  { path: "/releases", label: "Releases", icon: ICONS.releases, render: releases },
  { path: "/site", label: "Site", icon: ICONS.site, render: site, bind: bindSite },
  { path: "/hosting", label: "Hébergement", icon: ICONS.hosting, render: hosting },
  { path: "/security", label: "Sécurité", icon: ICONS.security, render: security, bind: bindSecurity },
];

const LOGO = `<svg viewBox="240 200 640 620" aria-hidden="true"><path d="M292 772 L512 248 L732 772" fill="none" stroke="#eef1f5" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/><path d="M392 616 L800 616" fill="none" stroke="#3dd6d0" stroke-width="76" stroke-linecap="round"/><circle cx="800" cy="616" r="62" fill="#5ff0d4"/></svg>`;

const icon = (paths: string): Html =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);

const app = document.querySelector<HTMLElement>("#app")!;
let session: SessionState | null = null;
let expired = false;

function shell(email: string): void {
  app.innerHTML = html`
    <div class="layout">
      <aside class="sidebar">
        <a class="brand" href="#/">${raw(LOGO)}<span>Aoze</span><span class="brand-tag">Admin</span></a>
        <nav class="nav" aria-label="Administration">
          ${ROUTES.map((r) => html`<a href="${`#${r.path}`}" data-path="${r.path}">${icon(r.icon)}<span>${r.label}</span></a>`)}
        </nav>
        <div class="sidebar-foot">
          <span class="signed-in" title="${email}">${email}</span>
          <a class="nav-out" href="https://aoze.fr" target="_blank" rel="noopener">${icon('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')}<span>Voir le site</span></a>
          <button class="nav-out" type="button" data-logout>${icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>')}<span>Se déconnecter</span></button>
        </div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <dialog id="confirm" class="dialog"></dialog>`.value;
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

/** The sign-in and first-run screens share one card; `onSubmit` returns an error message or nothing. */
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
    document.title = "Mise en place · Aoze Admin";
    app.innerHTML = html`<main class="login"><div class="login-card">
      <div class="login-logo">${raw(LOGO)}</div>
      <h1>Mise en place</h1>
      <p class="muted">Aucun compte administrateur n'existe encore. Ajoutez un code de mise en place (au moins 24 caractères) dans ~/aoze-admin/config.php, puis rechargez cette page.</p>
    </div></main>`.value;
    return;
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

let renderId = 0;

async function route(): Promise<void> {
  if (!session) {
    try {
      session = await loadSession();
    } catch {
      app.innerHTML = html`<main class="login"><div class="login-card"><h1>Serveur injoignable</h1><p class="muted">Réessayez dans un instant.</p></div></main>`.value;
      return;
    }
  }
  if (session.state === "setup") return setup(session.setupReady === true);
  if (session.state !== "signed-in") return login();

  if (!app.querySelector(".layout")) shell(session.email ?? "");
  const path = location.hash.replace(/^#/, "") || "/";
  const current = ROUTES.find((r) => r.path === path) ?? ROUTES[0]!;
  app.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.path === current.path));
  const main = app.querySelector<HTMLElement>("#main")!;
  main.setAttribute("aria-busy", "true");
  const id = ++renderId;
  let content: Html;
  try {
    content = await current.render();
  } catch (e) {
    console.error(e);
    content = html`<section class="card"><h2>Cette page n'a pas pu s'afficher.</h2><p class="note">Rechargez la page. Si le problème revient, le détail est dans la console du navigateur.</p></section>`;
  }
  if (id !== renderId || !app.contains(main)) return; // a later navigation, or a sign-out, won
  main.innerHTML = html`<div class="sample-banner">Les cartes marquées « Exemple » montrent des valeurs fictives que le serveur remplacera (phase 4).</div>${content}`.value;
  main.removeAttribute("aria-busy");
  applyBarHeights(main);
  current.bind?.(main);
  main.focus({ preventScroll: true });
  document.title = `${current.label} · Aoze Admin`;
}

addEventListener("hashchange", () => void route());
addEventListener("admin:refresh", () => void route());
addEventListener("admin:signed-out", () => {
  if (session?.state !== "signed-in") return;
  session = null;
  expired = true;
  void route();
});
void route();
