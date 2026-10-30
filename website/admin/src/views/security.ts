import { api, ApiError } from "../api";
import * as data from "../data";
import { formatAgo, formatDateTime } from "../format";
import { html, type Html } from "../html";
import { card, confirmAction, pageHead, pill, row, toast } from "../ui";

const refresh = () => window.dispatchEvent(new Event("admin:refresh"));

const passwordForm = html`<form class="form inline-form" data-password hidden>
  <label class="field"><span>Mot de passe actuel</span><input name="current" type="password" autocomplete="current-password" required /></label>
  <label class="field"><span>Nouveau mot de passe (12 caractères minimum)</span><input name="next" type="password" autocomplete="new-password" minlength="12" required /></label>
  <label class="field"><span>Confirmer</span><input name="confirm" type="password" autocomplete="new-password" minlength="12" required /></label>
  <p class="note">Les autres sessions seront fermées.</p>
  <div class="form-actions"><button class="btn btn-ghost" type="button" data-cancel>Annuler</button><button class="btn btn-primary" type="submit">Changer le mot de passe</button></div>
</form>`;

const disableForm = html`<form class="form inline-form" data-2fa-disable hidden>
  <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required /></label>
  <label class="field"><span>Code actuel de l'application</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
  <div class="form-actions"><button class="btn btn-ghost" type="button" data-cancel>Annuler</button><button class="btn btn-danger" type="submit">Désactiver</button></div>
</form>`;

export async function security(): Promise<Html> {
  const [settings, sessions, logins, activity] = await Promise.all([data.security(), data.sessions(), data.logins(), data.activity()]);
  const failed = logins.state === "unavailable" ? 0 : logins.data.filter((l) => !l.success).length;

  return html`
    ${pageHead("Sécurité et activité", "Votre compte, vos sessions et tout ce qui a été fait ici.")}
    <div class="grid">
      ${card("Compte", settings, (s) => html`<dl class="kvs">
        ${row("Accès à /admin", s.hidden ? pill("ok", "Masqué, clé d'accès requise") : pill("warn", "Visible par tous : ajoutez access_key à config.php"))}
        ${row("Double authentification", s.twoFactor ? pill("ok", "Activée") : pill("warn", "Désactivée"))}
        ${row("Mot de passe modifié", formatAgo(s.passwordChangedAt))}
        ${row("Déconnexion automatique", `après ${s.idleMinutes} minutes d'inactivité`)}
      </dl>
      <div class="form-actions">
        <button class="btn btn-ghost" type="button" data-open="data-password">Changer le mot de passe</button>
        ${s.twoFactor
          ? html`<button class="btn btn-ghost" type="button" data-open="data-2fa-disable">Désactiver la double authentification</button>`
          : html`<button class="btn btn-primary" type="button" data-2fa-start>Activer la double authentification</button>`}
      </div>
      ${passwordForm}
      ${s.twoFactor ? disableForm : html`<div data-2fa-setup></div>`}`)}

      ${card("Sessions ouvertes", sessions, (list) => html`<ul class="list">
        ${list.map((s) => html`<li><strong>${s.device}</strong>
          ${s.current ? pill("ok", "Cette session") : ""}
          <span class="muted">${s.ip}, active ${formatAgo(s.lastSeenAt)}</span>
          ${s.current ? "" : html`<button class="btn btn-ghost btn-sm" type="button" data-revoke="${s.id}">Fermer</button>`}
        </li>`)}
      </ul>`)}

      ${card("Connexions", logins, (list) => html`
        ${failed ? html`<p class="card-intro">${pill("warn", `${failed} échec${failed > 1 ? "s" : ""}`)} <span class="muted">Après 5 échecs en 15 minutes, la connexion est bloquée 15 minutes pour l'adresse concernée.</span></p>` : ""}
        ${list.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Résultat</th><th>Adresse IP</th><th>Appareil</th></tr></thead>
          <tbody>${list.map((l) => html`<tr>
            <td>${formatDateTime(l.at)}</td>
            <td>${l.success ? pill("ok", "Réussie") : pill("bad", "Refusée")}</td>
            <td class="mono">${l.ip}</td>
            <td>${l.device}</td>
          </tr>`)}</tbody>
        </table></div>` : html`<p class="unavailable">Aucune connexion enregistrée.</p>`}`, { wide: true })}

      ${card("Journal d'activité", activity, (list) => list.length
        ? html`<ul class="timeline">${list.map((e) => html`<li><span class="when">${formatDateTime(e.at)}</span><strong>${e.action}</strong><span>${e.detail}</span></li>`)}</ul>`
        : html`<p class="unavailable">Rien pour l'instant.</p>`, { wide: true })}
    </div>`;
}

function onSubmit(form: HTMLFormElement | null, send: (f: FormData) => Promise<void>): void {
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      await send(new FormData(form));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Le serveur ne répond pas.", "bad");
    } finally {
      button.disabled = false;
    }
  });
}

function show2faSetup(root: HTMLElement): void {
  const slot = root.querySelector<HTMLElement>("[data-2fa-setup]");
  if (!slot) return;
  api<{ secret: string; uri: string }>("2fa/start", {}).then(({ secret, uri }) => {
    slot.innerHTML = html`<form class="form inline-form" data-2fa-confirm>
      <p class="note">Dans votre application d'authentification (Google Authenticator, Aegis, 1Password…), ajoutez un compte avec cette clé, ou ouvrez le lien depuis votre téléphone :</p>
      <p class="secret mono">${secret.match(/.{1,4}/g)!.join(" ")}</p>
      <p><a href="${uri}">Ouvrir dans l'application</a></p>
      <label class="field"><span>Code affiché par l'application</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Confirmer et activer</button></div>
    </form>`.value;
    const form = slot.querySelector<HTMLFormElement>("[data-2fa-confirm]");
    form?.querySelector("input")?.focus();
    onSubmit(form, async (f) => {
      await api("2fa/confirm", { code: f.get("code") });
      toast("Double authentification activée. Le code sera demandé à chaque connexion.");
      refresh();
    });
  }, (err) => toast(err instanceof ApiError ? err.message : "Le serveur ne répond pas.", "bad"));
}

export function bindSecurity(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) =>
    button.addEventListener("click", () => {
      const form = root.querySelector<HTMLFormElement>(`[${button.dataset.open}]`);
      if (!form) return;
      form.hidden = false;
      form.querySelector("input")?.focus();
    }));
  root.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach((button) =>
    button.addEventListener("click", () => {
      const form = button.closest("form")!;
      form.reset();
      form.hidden = true;
    }));
  root.querySelector("[data-2fa-start]")?.addEventListener("click", () => show2faSetup(root));

  onSubmit(root.querySelector("[data-password]"), async (f) => {
    if (f.get("next") !== f.get("confirm")) throw new ApiError(422, "Les deux nouveaux mots de passe ne sont pas identiques.");
    await api("password", { current: f.get("current"), next: f.get("next") });
    toast("Mot de passe changé. Les autres sessions ont été fermées.");
    refresh();
  });
  onSubmit(root.querySelector("[data-2fa-disable]"), async (f) => {
    const ok = await confirmAction({
      title: "Désactiver la double authentification ?",
      text: "Le mot de passe seul suffira pour se connecter. C'est nettement moins sûr.",
      confirm: "Désactiver",
      danger: true,
    });
    if (!ok) return;
    await api("2fa/disable", { password: f.get("password"), code: f.get("code") });
    toast("Double authentification désactivée.", "muted");
    refresh();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await confirmAction({
        title: "Fermer cette session ?",
        text: "L'appareil concerné devra se reconnecter.",
        confirm: "Fermer la session",
        danger: true,
      });
      if (!ok) return;
      try {
        await api("sessions/revoke", { id: button.dataset.revoke });
        toast("Session fermée.");
        refresh();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Le serveur ne répond pas.", "bad");
      }
    }));
}
