import { open } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import { Slider } from "../../../components/ui/Slider";
import { fmt, useMessages } from "../../../i18n";
import { api, toAppError } from "../../../services/api";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { LutInfo } from "../../../types";
import s from "../fields.module.css";
import { useSettings } from "./shared";

const IMPORT_LUT = "__import__";

export function LutField() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.lutList().then(setLuts).catch(() => setLuts([]));
  }, []);
  const builtinNames: Record<string, string> = t.controls.lutBuiltins;
  const options = [
    { value: "none", label: t.controls.lutNone },
    ...luts.map((l) => ({ value: l.id, label: l.builtin ? (builtinNames[l.name] ?? l.name) : l.name })),
    { value: IMPORT_LUT, label: t.controls.lutImport },
  ];
  const pick = async (v: string) => {
    setError(null);
    if (v === IMPORT_LUT) {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "LUT", extensions: ["cube"] }] });
      if (typeof path !== "string") return;
      try {
        const info = await api.lutImport(path);
        setLuts(await api.lutList());
        setAnim("clip", { lut: info.id });
      } catch (e) {
        setError(fmt(t.controls.lutInvalid, { detail: toAppError(e).detail }));
      }
      return;
    }
    setAnim("clip", { lut: v === "none" ? null : v });
  };
  const selected = luts.find((l) => l.id === a.lut);
  const remove = async () => {
    if (!selected || selected.builtin) return;
    await api.lutRemove(selected.id).catch(() => undefined);
    setLuts(await api.lutList());
    setAnim("clip", { lut: null });
  };
  return (
    <>
      <Field label={t.controls.lut} help="lut" hint={error ?? undefined}>
        <div className={s.folder}>
          <div className={s.grow}>
            <Select ariaLabel={t.controls.lut} value={a.lut ?? "none"} options={options} onChange={(v) => void pick(v)} />
          </div>
          {selected && !selected.builtin && (
            <IconButton label={t.controls.lutRemove} size="sm" onClick={() => void remove()}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </Field>
      {a.lut && (
        <Field label={t.controls.intensity}>
          <Slider label={t.controls.intensity} min={5} max={100} step={5} value={a.lutStrength} format={(v) => `${v}%`} onChange={(lutStrength) => setAnim("clip", { lutStrength })} />
        </Field>
      )}
    </>
  );
}
