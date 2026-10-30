import { formatNumber } from "./format";
import { html, type Html } from "./html";

export interface Point {
  label: string;
  value: number;
  tip?: string;
}

/** Rounds the axis up to 1, 2, 2.5 or 5 times a power of ten. */
function axisMax(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= value)!;
}

export function bars(points: Point[], label: string): Html {
  const max = axisMax(Math.max(...points.map((p) => p.value), 0));
  return html`<div class="chart-bars" role="img" aria-label="${label}">
    <div class="chart-axis" aria-hidden="true">
      <span class="at-100">${formatNumber(max)}</span><span class="at-50">${formatNumber(max / 2)}</span><span class="at-0">0</span>
    </div>
    <div class="chart-plot">
      <div class="chart-grid" aria-hidden="true"></div>
      ${points.map((p) => html`<div class="cbar" tabindex="0" data-tip="${p.tip ?? `${p.label} : ${formatNumber(p.value)}`}">
        <div class="cbar-col"><span class="cbar-fill" data-h="${(p.value / max) * 100}"><span class="cbar-value">${formatNumber(p.value)}</span></span></div>
        <span class="cbar-label">${p.label}</span>
      </div>`)}
    </div>
  </div>`;
}

export interface Slice {
  label: string;
  value: number;
  hint?: string;
}

const percent = (part: number, total: number): string => `${total ? Math.round((part / total) * 100) : 0} %`;

/** Shares of a whole. Segments are drawn on a 100-unit path so lengths are percentages. */
export function donut(slices: Slice[], center: { value: string; label: string }): Html {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 0.8 : 0;
  let offset = 0;
  const segments = slices.map((s, i) => {
    const length = total ? (s.value / total) * 100 : 0;
    const segment = length > 0
      ? html`<circle class="${`donut-seg s${i + 1}`}" cx="50" cy="50" r="42" pathLength="100"
          stroke-dasharray="${`${Math.max(length - gap, 0.01)} ${100 - Math.max(length - gap, 0.01)}`}" stroke-dashoffset="${-offset}"
          tabindex="0" data-tip="${`${s.label} : ${formatNumber(s.value)} (${percent(s.value, total)})`}"></circle>`
      : "";
    offset += length;
    return segment;
  });
  return html`<div class="donut">
    <div class="donut-ring">
      <svg viewBox="0 0 100 100" role="img" aria-label="${center.label}">
        <circle class="donut-track" cx="50" cy="50" r="42"></circle>
        <g transform="rotate(-90 50 50)">${segments}</g>
      </svg>
      <div class="donut-center"><strong>${center.value}</strong><span>${center.label}</span></div>
    </div>
    <ul class="legend">${slices.map((s, i) => html`<li>
      <span class="${`swatch s${i + 1}`}"></span>
      <span class="legend-label">${s.label}${s.hint ? html`<small>${s.hint}</small>` : ""}</span>
      <strong>${formatNumber(s.value)}</strong>
      <span class="legend-pct">${percent(s.value, total)}</span>
    </li>`)}</ul>
  </div>`;
}

/** Ranked horizontal bars, relative to the largest value. */
export function ranking(items: Point[], unit = ""): Html {
  const max = Math.max(...items.map((i) => i.value), 1);
  return html`<ol class="ranking">${items.map((i) => html`<li>
    <span class="ranking-label">${i.label}</span>
    <strong>${formatNumber(i.value)}${unit}</strong>
    <span class="ranking-track"><span class="ranking-fill" data-w="${(i.value / max) * 100}"></span></span>
  </li>`)}</ol>`;
}
