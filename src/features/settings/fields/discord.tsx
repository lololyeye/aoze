import { Field } from "../../../components/ui/Field";
import { useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { DiscordTarget } from "../../../types";
import s from "../fields.module.css";
import { useSettings } from "./shared";

const DISCORD: Record<DiscordTarget, { w: number; h: number; maxMb: number | null; minimum: boolean }> = {
  profilePicture: { w: 512, h: 512, maxMb: 8, minimum: false },
  profileBanner: { w: 680, h: 240, maxMb: 10, minimum: true },
  serverBanner: { w: 960, h: 540, maxMb: null, minimum: false },
};

/** Prepares an image or GIF for a Discord slot (sizes from Discord's help center). */
export function DiscordField({ source }: { source?: { w: number; h: number } }) {
  const t = useMessages();
  const { discord } = useSettings();
  const update = useSettingsStore((st) => st.update);
  const spec = discord ? DISCORD[discord] : null;
  const smaller = spec && source && (source.w < spec.w || source.h < spec.h);
  return (
    <Field label={t.discord.title}>
      <div className={s.chips} role="radiogroup" aria-label={t.discord.title}>
        {(
          [
            ["off", t.discord.off],
            ["profilePicture", t.discord.profilePicture],
            ["profileBanner", t.discord.profileBanner],
            ["serverBanner", t.discord.serverBanner],
          ] as const
        ).map(([value, label]) => {
          const active = (discord ?? "off") === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${s.chip} ${active ? s.chipOn : ""}`}
              onClick={() => update((st) => ({ ...st, discord: value === "off" ? null : value }))}
            >
              {label}
            </button>
          );
        })}
      </div>
      {discord && spec && (
        <div className={s.target}>
          <div className={s.targetTitle}>{t.discord.recommended}</div>
          <dl>
            <div>
              <dt>{t.discord.resolution}</dt>
              <dd>
                {spec.w} × {spec.h}
                {spec.minimum && ` ${t.discord.minimum}`}
                {discord === "profilePicture" && ` · ${t.discord.square}`}
                {discord === "serverBanner" && ` · ${t.discord.ratio}`}
              </dd>
            </div>
            <div>
              <dt>{t.discord.maxSize}</dt>
              <dd>{spec.maxMb ? `${spec.maxMb} MB` : t.discord.noLimit}</dd>
            </div>
            <div>
              <dt>{t.discord.format}</dt>
              <dd>{discord === "profilePicture" ? t.discord.formatsAvatar : t.discord.formatsBanner}</dd>
            </div>
          </dl>
          <p>{t.discord.crop}</p>
          {discord === "profilePicture" && <p>{t.discord.circle}</p>}
          {discord === "profileBanner" && <p>{t.discord.nitro}</p>}
          {smaller && <p className={s.targetNote}>{t.discord.enlarge}</p>}
          <p>{t.discord.output}</p>
        </div>
      )}
    </Field>
  );
}
