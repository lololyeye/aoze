import { html, type Html } from "./html";
import { icon } from "./icons";

export interface Period {
  from: string;
  to: string;
}

const PRESETS = [
  { id: "7", label: "7 j", days: 7 },
  { id: "30", label: "30 j", days: 30 },
  { id: "90", label: "90 j", days: 90 },
  { id: "365", label: "12 mois", days: 365 },
];
const STORAGE_KEY = "aoze-admin-period";
const MAX_DAYS = 760;
/** Days are counted in Paris time, like the server's daily totals. */
const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export const today = (): string => parisDay.format(new Date());

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const dayCount = (p: Period): number => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
export const formatDay = (day: string): string => shortDay.format(new Date(`${day}T00:00:00Z`));

type Choice = { preset: string } | { preset: "custom"; from: string; to: string };

function load(): Choice {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Choice | null;
    if (saved && (saved.preset === "custom" || PRESETS.some((p) => p.id === saved.preset))) return saved;
  } catch {}
  return { preset: "30" };
}

let choice = load();

export function currentPeriod(): Period {
  const end = today();
  if (choice.preset === "custom" && "from" in choice) return { from: choice.from, to: choice.to > end ? end : choice.to };
  const days = PRESETS.find((p) => p.id === choice.preset)?.days ?? 30;
  return { from: shiftDay(end, 1 - days), to: end };
}

function choose(next: Choice): void {
  choice = next;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new Event("admin:refresh"));
}

export function periodLabel(p: Period = currentPeriod()): string {
  return p.from === p.to ? formatDay(p.from) : `du ${formatDay(p.from)} au ${formatDay(p.to)}`;
}

export function rangePicker(): Html {
  const period = currentPeriod();
  const custom = choice.preset === "custom";
  return html`<div class="range">
    <div class="segmented" role="group" aria-label="Période">
      ${PRESETS.map((p) => html`<button type="button" data-preset="${p.id}" aria-pressed="${String(choice.preset === p.id)}">${p.label}</button>`)}
      <button type="button" data-custom aria-pressed="${String(custom)}" aria-expanded="false" aria-controls="range-form">${icon("calendar")}<span>${custom ? periodLabel(period) : "Personnalisée"}</span></button>
    </div>
    <form class="range-form card" id="range-form" hidden>
      <label class="field"><span>Du</span><input type="date" name="from" value="${period.from}" max="${today()}" required /></label>
      <label class="field"><span>Au</span><input type="date" name="to" value="${period.to}" max="${today()}" required /></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-sm" type="submit">Afficher</button>
    </form>
  </div>`;
}

/** Bound once on the page header, which is redrawn at each route change. */
export function bindRangePicker(host: HTMLElement): void {
  host.addEventListener("click", (e) => {
    const target = e.target as Element;
    const preset = target.closest<HTMLElement>("[data-preset]");
    if (preset) return choose({ preset: preset.dataset.preset! });
    const toggle = target.closest<HTMLElement>("[data-custom]");
    if (toggle) {
      const form = host.querySelector<HTMLFormElement>("#range-form")!;
      form.hidden = !form.hidden;
      toggle.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) form.querySelector("input")!.focus();
    }
  });
  host.addEventListener("submit", (e) => {
    const form = (e.target as Element).closest<HTMLFormElement>("#range-form");
    if (!form) return;
    e.preventDefault();
    const from = String(new FormData(form).get("from"));
    const to = String(new FormData(form).get("to"));
    const error = form.querySelector<HTMLElement>(".form-error")!;
    const problem = from > to ? "La date de début doit précéder la date de fin."
      : to > today() ? "La période ne peut pas dépasser aujourd'hui."
      : dayCount({ from, to }) > MAX_DAYS ? "25 mois au plus." : "";
    error.textContent = problem;
    error.hidden = !problem;
    if (!problem) choose({ preset: "custom", from, to });
  });
}
