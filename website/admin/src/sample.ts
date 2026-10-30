// Example values for what the server will provide. Every screen labels them "Exemple".
import type { Announcement, CertificateStatus, Dataset, DeployStatus, ManifestStatus, PageStatus, ServerStatus } from "./types";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const example = <T>(data: T): Dataset<T> => ({ state: "sample", data });

export const sample = {
  manifest: example<ManifestStatus>({
    version: "1.3.1",
    url: "https://github.com/lololyeye/aoze/releases/download/updates/Aoze_1.3.1_x64-setup.exe",
    sha256: "4facc2fa1992a92a76fa47281c2f3e4eb6b821fb0c44288a89dfa6314c0f7631",
    size: 119_675_882,
    checks: [
      { label: "Version", ok: true, detail: "latest.json annonce la dernière release publiée." },
      { label: "Adresse", ok: true, detail: "Le fichier est dans les releases du dépôt." },
      { label: "SHA-256", ok: true, detail: "Identique à l'empreinte calculée par GitHub." },
      { label: "Taille", ok: true, detail: "Identique au fichier publié." },
      { label: "Signature", ok: true, detail: "Présente." },
    ],
  }),
  deploy: example<DeployStatus>({
    builtCommit: "4ece992",
    liveCommit: "4ece992",
    lastPullAt: at(3),
    logTail: [],
  }),
  certificates: example<CertificateStatus[]>([
    { host: "aoze.fr", issuer: "Let's Encrypt", validTo: days(64) },
    { host: "www.aoze.fr", issuer: "Let's Encrypt", validTo: days(64) },
  ]),
  pages: example<PageStatus[]>([
    { path: "/", status: 200, ms: 84 },
    { path: "/fr/", status: 200, ms: 79 },
    { path: "/download/", status: 200, ms: 91 },
    { path: "/fr/download/", status: 200, ms: 88 },
    { path: "/legal/", status: 200, ms: 72 },
  ]),
  server: example<ServerStatus>({ php: "8.1", database: "SQLite 3", databaseSize: 184_320 }),
  announcement: example<Announcement>({
    status: "draft",
    level: "info",
    textFr: "Texte d'exemple du bandeau, à remplacer.",
    textEn: "Example banner text, to be replaced.",
    link: "",
    startsAt: null,
    endsAt: null,
    updatedAt: at(1440),
  }),
};
