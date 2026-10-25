import { Tooltip } from "../../components/ui/Tooltip";
import { useMessages } from "../../i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { activePreset, applyPreset, PRESETS, type PresetId, type PresetKind } from "../../utils/presets";
import s from "./PresetBar.module.css";

/** One-click presets; "Custom" lights up when the settings match none of them. */
export function PresetBar({ kind }: { kind: PresetKind }) {
  const t = useMessages();
  const settings = useSettingsStore((st) => st.settings);
  const update = useSettingsStore((st) => st.update);
  if (!settings) return null;
  const active = activePreset(settings, kind);
  const label: Record<PresetId, string> = { anime: t.presets.anime, edit: t.presets.edit, quality: t.presets.quality, small: t.presets.small };
  const hint: Record<PresetId, string> = {
    anime: t.presets.animeHint,
    edit: t.presets.editHint,
    quality: t.presets.qualityHint,
    small: t.presets.smallHint,
  };
  return (
    <div className={s.bar} role="radiogroup" aria-label="Presets">
      {PRESETS[kind].map((p) => (
        <Tooltip key={p.id} content={hint[p.id]} wide>
          <button
            type="button"
            role="radio"
            aria-checked={active === p.id}
            className={`${s.chip} ${active === p.id ? s.active : ""}`}
            onClick={() => update((st) => applyPreset(st, kind, p.id))}
          >
            {label[p.id]}
          </button>
        </Tooltip>
      ))}
      <Tooltip content={t.presets.customHint} wide>
        <span className={`${s.chip} ${s.static} ${active === null ? s.active : ""}`} aria-hidden="true">
          {t.presets.custom}
        </span>
      </Tooltip>
    </div>
  );
}
