import { Field } from "../../../components/ui/Field";
import { Slider } from "../../../components/ui/Slider";
import { Toggle } from "../../../components/ui/Toggle";
import { useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { BeatSync, MediaInfo } from "../../../types";
import s from "../fields.module.css";
import { useSettings } from "./shared";

export function BeatSyncField({ media }: { media?: MediaInfo }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const set = (p: Partial<BeatSync>) => setAnim("clip", { beat: { ...a.beat, ...p } });
  const noAudio = media !== undefined && !media.hasAudio;
  return (
    <>
      <Field label={t.controls.beatSync} help="beat" inline>
        <Toggle label={t.controls.beatSync} checked={a.beat.on} onChange={(on) => set({ on })} />
      </Field>
      {a.beat.on && (
        <>
          <p className={noAudio ? s.warn : s.note}>{noAudio ? t.controls.beatNoAudio : t.controls.beatHint}</p>
          <Field label={t.controls.beatZoom} inline>
            <Toggle label={t.controls.beatZoom} checked={a.beat.zoom} onChange={(zoom) => set({ zoom })} />
          </Field>
          <Field label={t.controls.beatShake} inline>
            <Toggle label={t.controls.beatShake} checked={a.beat.shake} onChange={(shake) => set({ shake })} />
          </Field>
        </>
      )}
    </>
  );
}

export function GlowField() {
  const t = useMessages();
  const look = useSettings().clip.look;
  const setAnim = useSettingsStore((st) => st.setAnim);
  return (
    <Field label={t.controls.glow} help="glow">
      <Slider label={t.controls.glow} min={0} max={100} step={5} value={look.glow} format={(v) => (v === 0 ? t.controls.off : `${v}%`)} onChange={(glow) => setAnim("clip", { look: { ...look, glow } })} />
    </Field>
  );
}
