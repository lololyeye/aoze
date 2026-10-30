const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Markup that is already safe. Only `html` and `raw` create it. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** For markup that comes from a trusted source, such as release notes rendered by GitHub. */
export const raw = (markup: string): Html => new Html(markup);

function render(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escape(String(value));
}

/** Template tag: every interpolated value is escaped unless it is itself `Html`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  values.forEach((value, i) => (out += render(value) + strings[i + 1]!));
  return new Html(out);
}
