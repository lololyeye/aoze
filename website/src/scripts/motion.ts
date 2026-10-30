// The site's motion layer: smooth wheel scrolling, headings that appear
// word by word, the cursor glow on cards and the 24 → 60 count. Every part keeps the page usable
// without it. With reduced motion, the CSS keeps the fades and drops what travels.
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// Smooth scrolling for the wheel and trackpad (touch keeps the native scroll). Kept even with
// reduced motion: it only follows the wheel and never moves on its own, and Windows reports
// reduced motion to every site as soon as its animation effects are off.
const lenis = new Lenis({
  lerp: 0.075, // each frame closes 7.5 % of the gap: a long, soft glide
  autoRaf: true,
  anchors: { offset: -84 },
  prevent: (node) => !!node.closest?.("dialog, [data-lenis-prevent]"),
  allowNestedScroll: true,
});
// A modal dialog freezes the page behind it.
new MutationObserver(() => {
  if (document.querySelector("dialog[open]")) lenis.stop();
  else lenis.start();
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });

// Headings are wrapped word by word; the CSS decides how the words come in:
//   .split       the hero and closing lines: each word sharpens out of a blur
//   .split-rise  section titles: each word rises from behind its own line
const wrapWords = (el: HTMLElement, rise: boolean) => {
  let i = 0;
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent!.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(part);
            continue;
          }
          const word = document.createElement("span");
          word.className = "w";
          word.style.setProperty("--i", String(i++));
          word.textContent = part;
          if (rise) {
            const mask = document.createElement("span");
            mask.className = "wm";
            mask.append(word);
            frag.append(mask);
          } else frag.append(word);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName !== "BR") {
        walk(child);
      }
    }
  };
  walk(el);
  el.classList.add(rise ? "split-rise" : "split");
};
document.querySelectorAll<HTMLElement>("main h1, main .local h2, main .final h2").forEach((el) => wrapWords(el, false));
document.querySelectorAll<HTMLElement>("main .section-head h2").forEach((el) => wrapWords(el, true));

document.querySelectorAll<HTMLElement>("[data-stagger]").forEach((el) => {
  [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));
});

if (finePointer) {
  document.querySelectorAll<HTMLElement>(".spot").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}

document.querySelectorAll<HTMLElement>("[data-count-to]").forEach((el) => {
  const to = Number(el.dataset.countTo);
  const from = Number(el.dataset.countFrom ?? 0);
  el.textContent = String(from);
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    const start = performance.now();
    const dur = 1400;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    setTimeout(() => requestAnimationFrame(step), 350);
  }, { threshold: 0.6 });
  io.observe(el);
});
