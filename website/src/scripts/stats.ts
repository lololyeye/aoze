// Audience measurement for aoze.fr, first-party only: events go to aoze.fr/e and nowhere else.
// Nothing is sent when the visitor opted out on the privacy page or the browser asks not to be
// tracked. The server also ignores everything while measurement is off in the admin.
import { href } from "../lib/site";

const OPT_OUT_COOKIE = "aoze_optout=1";
const ENDPOINT = href("e");

const optedOut = (): boolean =>
  document.cookie.split("; ").includes(OPT_OUT_COOKIE)
  || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  || navigator.doNotTrack === "1";

if (!optedOut()) {
  const path = location.pathname;
  const send = (event: Record<string, unknown>) => navigator.sendBeacon(ENDPOINT, JSON.stringify({ p: path, ...event }));

  send({ t: "pv", l: document.documentElement.lang.startsWith("fr") ? "fr" : "en", r: document.referrer, u: location.search });

  // Time the page is actually on screen, sent each time it is hidden or left.
  let shownAt = document.visibilityState === "visible" ? performance.now() : 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      shownAt = performance.now();
      return;
    }
    const ms = shownAt ? Math.round(performance.now() - shownAt) : 0;
    shownAt = 0;
    if (ms >= 1000) send({ t: "en", ms });
  });

  const buttons = document.querySelectorAll("a[data-installer]");
  if (buttons.length) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      send({ t: "ds" });
      seen.disconnect();
    }, { threshold: 0.6 });
    buttons.forEach((b) => seen.observe(b));
  }

  document.addEventListener("click", (e) => {
    const target = (e.target as Element).closest("a[data-installer], [data-in-ok]");
    if (target) send({ t: target.matches("a[data-installer]") ? "dc" : "dk" });
  });
}
