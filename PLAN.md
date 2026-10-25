# Plan — « Waifu2x Studio » : app desktop Windows d'upscaling IA

## Contexte
Le workspace `E:\code\appli erreur` est vide. Le but : une vraie app Windows premium (pas un site web dans une fenêtre) qui reprend le workflow de waifu2x.net et utilise **waifu2x-ncnn-vulkan** (release 20220728, MIT) comme moteur réel. Le livrable final est un installeur `.exe` testable.

Machine : Node 24 / npm 11, MSVC (VS 18 Community), WebView2 155, GPU NVIDIA GTX 1650, `vulkaninfo` présent. **Rust absent** → l'installer via `winget install Rustlang.Rustup` + toolchain `stable-x86_64-pc-windows-msvc` (accord donné).
Choix validés : moteur et modèles **intégrés à l'installeur** (sans téléchargement au runtime), UI **EN + FR**.

## Décisions d'architecture
- **Tauri 2 + React 19 + TypeScript strict + Vite**. Léger (~25 Mo avec le moteur), Rust natif pour gérer les process et les images, sécurité Tauri par capabilities.
- Couches : `UI (React)` → `stores (Zustand)` → `services/api.ts` (seul fichier qui appelle `invoke`/les events) → **Rust** `commands` → `queue::QueueManager` → `engine::UpscaleEngine` (trait) → `Waifu2xEngine` → `waifu2x-ncnn-vulkan.exe` → GPU.
- Tout le traitement vit en Rust sur tokio : l'UI ne bloque jamais. La progression part vers l'UI via des events Tauri (`queue://updated`, `job://progress`, `job://log`).

## Structure
```
PLAN.md  README.md  package.json  vite.config.ts  tsconfig.json
scripts/fetch-engine.mjs        # télécharge le zip GitHub, vérifie le SHA-256 épinglé, extrait
src/
  app/ (App.tsx, providers, Titlebar)
  components/ui/   Button IconButton Panel Segmented Select Slider Toggle Tooltip Modal Sheet ProgressBar Toast Kbd SettingsSection
  features/
    upscale/   ImageDropzone, ControlsPanel (presets, scale, noise, style, Advanced), UpscaleButton, ResultSummary
    viewer/    BeforeAfterViewer (split/side/toggle, zoom/pan/fit/100%), useViewport
    queue/     ProcessingQueue, QueueItem, QueueStats
    settings/  SettingsSheet (General/Processing/Output/Performance/Advanced)
    history/   HistorySheet
    diagnostics/ DiagnosticsSheet (logs, Copy diagnostic)
  services/api.ts  events.ts
  stores/ queueStore settingsStore systemStore uiStore
  i18n/ en.ts fr.ts index.ts
  styles/ tokens.css (dark/light), global.css ; CSS Modules par composant
  types/ (miroir des structs Rust sérialisées)
  utils/ format.ts (taille, durée, résolution), eta.ts
src-tauri/
  src/ main.rs lib.rs error.rs logging.rs
       commands/ (system, queue, settings, history, files)
       engine/ mod.rs (trait + capacités)  waifu2x.rs (args, spawn, parse de la progression, kill)  models.rs (scan)
       gpu.rs (énumération Vulkan via `ash`, chargée dynamiquement)
       imaging.rs (probe, thumbnails, proxy de preview, resize 1.6x, encodage)
       queue.rs  output.rs (nommage/conflits)  settings.rs  history.rs
  resources/engine/  (waifu2x-ncnn-vulkan.exe, models-cunet, models-upconv_7_*, LICENSE) — gitignored, rempli par fetch-engine
  tests/ engine_integration.rs + fixtures générés
```

## Intégration du moteur (points clés)
- **Distribution** : `bundle.resources` copie `resources/engine/**`. `npm run fetch-engine` (lancé aussi en `predev`/`prebuild` si absent) récupère `waifu2x-ncnn-vulkan-20220728-windows.zip`, vérifie le SHA-256 et extrait. Résultat : Download → Install → Open → Upscale.
- **Détection** : au démarrage, `system_status` vérifie l'exe, scanne les dossiers de modèles (fichiers `.param/.bin` présents → capacités réelles par style/scale/noise), énumère les GPU Vulkan avec `ash::Entry::load()` (nom, type, VRAM ; même ordre que ncnn, donc l'index = `-g`). Si le loader Vulkan manque, l'app renvoie l'état « No compatible Vulkan device » avec la solution (mettre à jour le driver), sans crash.
- **Exécution** : `tokio::process::Command` avec `CREATE_NO_WINDOW` et `kill_on_drop`. Args : `-i -o -n -s -t -m -g -j -x -f png -v`. stderr est lu ligne par ligne : les `NN.NN%` deviennent la progression (normalisée sur toutes les passes) et chaque ligne va dans le log du job.
- **Constat après test réel (GTX 1650)** : la release 20220728 **n'affiche aucun pourcentage** sur Windows, même avec `-v`. Elle sort aussi avec le code 0 quand le décodage échoue (`decode image ... failed`). Conséquences :
  - la progression est **estimée** à partir du débit appris (Mpx de sortie/s par modèle+TTA+GPU, persisté), avec les phases réelles détectées sur stderr (init GPU → traitement → `done`) ; l'UI l'affiche « ≈ ». Sans historique de mesure, une valeur prudente est utilisée et l'estimation ne dépasse jamais 95 % avant `done`.
  - le succès est déterminé par `done` sur stderr **et** par la présence du fichier de sortie décodable, pas par le code de sortie.
  - en cas de perte du périphérique GPU (`vkQueueSubmit failed -4`, fréquent quand un jeu utilise déjà le GPU), le moteur écrit une image **blanche** et sort avec 0 : toute ligne `failed` est donc fatale, et le pipeline réessaie une fois avec `-t 128` quand la tuile est en auto.
  - `-g -1` (CPU) est supporté : il est proposé comme repli « CPU (lent) ».
- **Annulation** : `CancellationToken`, puis `child.kill()` et nettoyage des fichiers temporaires.
- **Mapping waifu2x.net → backend réel** :
  - Style : Artwork (`models-cunet`), Artwork Fast (`upconv_7_anime_style_art_rgb`), Photo (`upconv_7_photo`). « Artwork + Scan » (swin_unet) **n'existe pas** en ncnn : non affiché, documenté dans le README.
  - Scale : 1x, 1.6x, 2x, 4x, 8x. **1.6x** = passe 2x puis downscale Lanczos3 en Rust (même méthode que waifu2x.net). Une combinaison non supportée par les modèles présents (ex. Photo 1x avec débruitage) est désactivée dans l'UI, avec un tooltip qui explique pourquoi.
  - Noise : None / Low / Medium / High / Highest → `-n -1..3`.
- **Formats** : entrée PNG/JPEG/WebP passée directement au moteur ; BMP/TIFF décodés par le crate `image` vers un PNG temporaire. Le moteur écrit toujours un PNG temporaire, que Rust encode ensuite selon la sortie choisie : PNG, JPEG (qualité), WebP lossy/lossless (crate `webp`, qualité réelle). Métadonnées : pas d'option « préserver » (le moteur les perd), on ne l'affiche donc pas.
- **Sortie** : dossier = à côté de la source ou dossier choisi ; nom = `{name}{suffix}.{ext}` (suffixe par défaut `_waifu2x_{scale}x_n{noise}`). Conflit : auto-rename `(1)`, overwrite ou skip. La source n'est jamais écrasée. Écriture atomique (temp puis rename).
- **Erreurs** : enum `AppError` avec `code` + `title` + `causes[]` + `hint`, sérialisée vers l'UI. La classification lit le stderr (`vkCreateInstance failed`, `invalid gpu device`, `fopen ... failed`/modèle, `decode image ... failed`, out of memory → conseil tile size) puis le code de sortie.

## Queue / batch
- `QueueManager` (Arc<Mutex>) avec un worker unique (le GPU est sérialisé ; waifu2x sature déjà le GPU). Jobs : Waiting / Processing / Completed / Failed / Cancelled / Skipped.
- Actions : pause/resume de la file (la pause prend effet après le job en cours, parce que suspendre le process GPU n'est pas fiable ; c'est documenté), cancel current, cancel all, retry failed, remove, clear completed, réordonner.
- Chaque job fige ses paramètres à l'ajout. Changer un réglage s'applique aux jobs en attente seulement si l'utilisateur clique « Apply to waiting ».
- ETA : débit appris en Mpx de sortie par seconde, par modèle, puis moyenne glissante. Affiché après le premier job terminé, masqué sinon.
- Résultat par job : chemin de sortie, résolutions avant/après, tailles avant/après, durée. Boutons : Open image, Open folder, Upscale again, Copy path.

## Preview avant/après
- Images servies par le protocole `asset` ; le scope est autorisé **dynamiquement** (`asset_protocol_scope().allow_file`) uniquement pour les fichiers ajoutés et leurs sorties.
- Rust génère des thumbnails (256 px) pour la queue et un **proxy de preview** (≤ 4096 px de côté, en cache dans `appCacheDir`) quand l'image dépasse 16 Mpx. Le full-res n'est chargé que quand le zoom dépasse la résolution du proxy.
- Viewer : deux `<img>` superposés, transform CSS `translate/scale` (composité GPU, pas de reflow) et `clip-path` pour le split. Modes : split slider, côte à côte, toggle (maintenir Espace). Zoom molette centré sur le curseur, pan par drag, Fit / 100% / + / − / Reset. Zoom/pan synchronisés entre original et résultat ; `image-rendering: pixelated` au-delà de 200 % pour bien juger le détail.

## UI / UX
- Titlebar custom (`decorations: false`, `data-tauri-drag-region`, boutons min/max/close), qui sert aussi de header : logo + nom à gauche ; au centre une pastille d'état (GPU, Vulkan, Ready/Busy) ; à droite History, Diagnostics, Settings, thème, About.
- Layout 3 zones : rail Queue à gauche (repliable, caché s'il n'y a qu'une image), Viewer/Dropzone au centre (zone dominante), panneau de contrôles à droite (~320 px : presets Anime/Photo, scale et noise en segmented, style, Advanced repliable avec GPU, tile size, TTA, threads load:proc:save, format/qualité, dossier/suffixe/conflit) et gros bouton **Upscale** en bas. Pendant le traitement, le bouton affiche la progression, le %, le temps écoulé et le fichier courant, plus Cancel.
- En dessous de 1100 px, la queue devient un drawer ; en dessous de 900 px, les contrôles deviennent un sheet. Fenêtre par défaut 1320×840, minimum 960×620.
- Import : drag & drop natif Tauri (chemins réels et highlight au survol), bouton Browse (dialog multi-sélection, filtres), Ctrl+V (image du presse-papiers enregistrée en PNG temporaire via IPC raw bytes, ou chemins de fichiers), dossiers déposés parcourus récursivement (sur un seul niveau, filtrés par extension), arguments CLI / single-instance pour « Ouvrir avec ».
- Design : thème sombre par défaut (fond `#0c0d10`, surfaces étagées, bordures 1 px à faible alpha, rayon 8-10 px), accent cyan/turquoise `#3dd6d0` utilisé avec parcimonie (bouton principal, focus, progression), light mode via tokens. Police Inter Variable embarquée (`@fontsource-variable`, sans réseau), icônes `lucide-react`, primitives accessibles `@radix-ui` (Tooltip, Dialog, Select, Popover).
- Animations : `motion` pour l'apparition et la réorganisation des items de queue, les transitions du viewer et les états succès/erreur, en 120-220 ms ease-out, avec `MotionConfig reducedMotion="user"` plus un fallback CSS `prefers-reduced-motion`.
- Raccourcis : Ctrl+O (ouvrir), Ctrl+V (coller), Ctrl+Enter (upscale), Échap (cancel), F (fit), 1 (100 %), Ctrl+, (settings).
- Notifications Windows (`tauri-plugin-notification`) à la fin d'un batch quand la fenêtre n'a pas le focus (désactivables).

## Settings / History / Logs
- `settings.json` dans `appConfigDir`, géré par Rust (serde + valeurs par défaut + migration par version) ; l'UI lit et écrit via des commandes. Catégories : General (thème, langue, notifications, action après traitement), Processing (GPU, style/scale/noise par défaut), Output (format, qualité, suffixe, dossier, conflit), Performance (tile size, TTA, threads), Advanced (chemin moteur custom, garder les fichiers temporaires, logs verbeux).
- `history.json` (500 entrées max, écriture atomique) : ouvrir, dossier, refaire, supprimer, vider ; groupé par jour.
- Logs : `tauri-plugin-log` (fichier rotatif dans `appLogDir`) plus un log par job (lignes stderr). Diagnostics : version app, version moteur, GPU et version Vulkan, modèles trouvés, réglages, log du dernier job, boutons « Copy diagnostic » et « Open logs folder ».

## Sécurité
Aucun réseau au runtime (le CSP bloque `connect-src` hors IPC), aucune télémétrie. Capabilities minimales (dialog, opener limité à ouvrir/révéler des fichiers, clipboard write text, notification). Commandes Rust : chemins canonicalisés, extensions validées, le moteur n'est lancé que depuis le dossier des ressources (ou le chemin custom explicitement choisi dans les Advanced settings).

## Packaging
`npm run tauri build` → installeur NSIS (`*_x64-setup.exe`, installation par utilisateur, WebView2 en bootstrapper) et MSI. Icône d'app originale (SVG, puis `tauri icon`). Installeur NSIS avec option d'entrée de menu contextuel Explorer « Upscale with Waifu2x Studio » (hook NSIS, HKCU, retirée à la désinstallation).

## Tests
- **Rust unit** : construction des args, parsing de la progression, nommage/conflits de sortie, scan des capacités des modèles, classification des erreurs, migration des settings, ETA.
- **Rust intégration** (vrai moteur, GTX 1650) : fixtures générées (PNG RGBA, JPG, WebP, BMP) ; 2x, 4x, 1.6x, denoise ; chemin avec espaces et accents ; sortie existante (rename/overwrite/skip) ; fichier invalide ; dossier de modèles absent ; `-g 9` (GPU absent) ; annulation en cours de route (process tué, pas d'orphelin, temporaires supprimés) ; image 6000×4000 en 2x (tile auto) ; queue de 4 images.
- **Front** : Vitest sur utils/stores, `tsc --noEmit`, ESLint.
- **Manuel/E2E** : `npm run tauri dev`, scénario complet (drop, réglages, upscale, comparaison, batch, cancel, settings, history, diagnostics, thèmes, petite fenêtre), avec captures d'écran. Puis installation de l'installeur produit et smoke test sur la version installée.

## Roadmap d'exécution
1. Installer rustup et la toolchain MSVC ; scaffold Tauri 2 + React-TS ; `PLAN.md` dans le workspace (contenu de ce plan) ; `git init`.
2. `fetch-engine.mjs`, puis vérification manuelle du moteur en CLI (sortie `-v`, format de la progression, ordre des GPU).
3. Backend : engine/gpu/imaging/output/queue/settings/history/commands, plus les tests unitaires.
4. Design tokens, composants UI, layout, titlebar.
5. Dropzone, contrôles et viewer branchés sur les vraies commandes.
6. Queue/batch, résultats, ETA.
7. Settings, history, diagnostics/logs, i18n FR/EN.
8. Polish (animations, responsive, empty/error states, raccourcis, notifications, menu contextuel).
9. Tests d'intégration et scénario manuel complet ; correction des bugs.
10. `tauri build` → installeur, installation et test ; README complet ; review finale (TS, clippy, chemins Windows, process orphelins, sécurité).

## Vérification finale
```
npm install
npm run fetch-engine
npm run dev            # = tauri dev
npm test               # vitest + cargo test (intégration incluse si le moteur est présent)
npm run build          # = tauri build → src-tauri/target/release/bundle/nsis/*-setup.exe
```
Critère de succès : depuis l'app installée, choisir une image, choisir 2x/4x et le denoise, voir la progression, obtenir le fichier réellement upscalé sur disque, le comparer avant/après, traiter un batch de 4 images et vérifier que les réglages persistent après un redémarrage.

---

# v2 — Aoze (mise à jour majeure)

## Analyse de l'existant (ce qui est conservé)
- **Stack** : Tauri 2 + React 19 + TS strict + Zustand ; Rust : `core` (état), `queue` (worker unique + events), `pipeline` (image), `engine/` (trait `UpscaleEngine` + `Waifu2xEngine`), `imaging` (probe/encode/proxies), `output` (nommage/conflits), `perf` (débit appris), `settings`, `history`, `gpu` (Vulkan via `ash`).
- **Conservé tel quel** : moteur waifu2x et ses tests, retry « device lost », annulation, nommage, historique, diagnostics, sécurité (scope asset par fichier, opener limité aux fichiers connus).
- **Ce qui ne sait pas encore faire** : GIF animés (le décodeur ne prend que la 1re frame), vidéo, compression avec taille cible, navigation multi-espaces.

## Vérifications techniques faites sur la machine (GTX 1650)
| Besoin | Outil | Résultat |
|---|---|---|
| Métadonnées GIF/vidéo sans décoder | `ffprobe -count_packets` | OK (frames, `avg_frame_rate`, durée) |
| Frames GIF avec transparence | `ffmpeg … %06d.png` → waifu2x mode dossier | OK, PNG **rgba** conservé, noms conservés |
| Progression réelle frame par frame | comptage des PNG écrits par waifu2x | OK |
| GIF de sortie transparent | `palettegen=reserve_transparent=1` + `paletteuse=alpha_threshold` | OK |
| Vrai 60 FPS | `minterpolate` (mci) | OK (interpolation réelle, CPU, lente) |
| Motion blur | `tmix` (mélange pondéré de frames) | OK |
| Encodeur matériel | `h264_nvenc` OK ; `amf`/`qsv` absents ici | → détection automatique + repli `libx264` |

## Décisions
- **FFmpeg** : build BtbN GPL *shared* 8.1 épinglé (SHA-256), copié dans `resources/ffmpeg/` (exe + dll + LICENSE), sans `ffplay`. Récupéré par `fetch-engine.mjs`.
- **Honnêteté** : plus de « AI ». Libellés : *Upscale*, *Enhance*, *Compress*. Les options vidéo distinguent clairement **Sharpen (rapide, FFmpeg)** et **Anime clean-up (lent, GPU, waifu2x)**. Les FPS distinguent **Retime** (duplique/supprime des frames, indiqué) et **Smooth motion** (interpolation réelle, lente). Le GIF est limité à 50 FPS (format en centièmes de seconde), et c'est indiqué.
- **Compression réelle** :
  - Images : recherche dichotomique sur la qualité JPEG/WebP par encodages réels, puis réduction de taille si nécessaire. La taille estimée pour « Compress » est un **encodage réel** de l'image.
  - GIF : paliers couleurs/dithering, puis échelle.
  - Vidéo : CRF (qualité) ou **x264 deux passes** sur un débit calculé depuis la taille cible.
  - Le résultat indique toujours si la limite est atteinte.
- **Vidéo + waifu2x** : traitement par **blocs** (extraction JPEG → waifu2x dossier → segment intermédiaire haute qualité → suppression), pour borner le disque, puis concaténation et passe finale (FPS, blur, compression, audio d'origine).
- **GPU** : waifu2x Vulkan quel que soit le fabricant, repli **CPU automatique** si aucun périphérique Vulkan. Encodeur vidéo : NVENC/AMF/QSV testés au démarrage, sinon x264.
- **UI** : barre latérale (Home, Image & GIF, Clip, History, Settings, Help), accueil « What do you want to process? », options contextuelles par type, presets qui modifient de vrais paramètres, aide « ? » courte, page *How Aoze works*, splash court avec son synthétisé (WebAudio, aucun fichier requis ; un `startup.wav/mp3` déposé dans le dossier de config le remplace), réglage *Startup sound*.
- **Branding** : Aoze (`app.aoze`), migration automatique des réglages/historique de Kirei, signature « Made for aoxy, by zero. » (accueil + About), Ko-fi (About + pied de la barre latérale). Crédits waifu2x (nagadomi), waifu2x-ncnn-vulkan (nihui, MIT) et FFmpeg (GPL) conservés et affichés.

## Ordre d'implémentation
1. Renommage + wording + crédits + migration.
2. FFmpeg (fetch, localisation, probe, encodeurs, exécution avec progression/annulation).
3. Backend : types de jobs (image/gif/vidéo), compression, pipelines GIF et clip, progression détaillée (frames / temps).
4. Frontend : navigation, accueil, espaces Image/GIF et Clip, contrôles contextuels, presets, aide, viewer GIF/vidéo, splash/son.
5. Tests (Rust intégration réels + Vitest) puis build de l'installeur.
