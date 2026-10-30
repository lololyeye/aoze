import { FolderOpen, RotateCcw } from "lucide-react";
import { Button, IconButton } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Select } from "../../../components/ui/Select";
import { Toggle } from "../../../components/ui/Toggle";
import { fmt, useMessages } from "../../../i18n";
import { pickFolder } from "../../../services/actions";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useSystemStore } from "../../../stores/systemStore";
import type { ConflictPolicy } from "../../../types";
import { renderSuffix } from "../../../utils/format";
import s from "../fields.module.css";
import { useSettings } from "./shared";

export function FolderField() {
  const t = useMessages();
  const { output } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const choose = async () => {
    const directory = await pickFolder();
    if (directory) setOutput({ directory });
  };
  return (
    <Field label={t.controls.folder}>
      <div className={s.folder}>
        <span className={s.folderPath} title={output.directory ?? undefined}>
          {output.directory ?? t.controls.folderBeside}
        </span>
        {output.directory && (
          <IconButton label={t.controls.folderReset} size="sm" onClick={() => setOutput({ directory: null })}>
            <RotateCcw />
          </IconButton>
        )}
        <Button size="sm" icon={<FolderOpen />} onClick={() => void choose()}>
          {t.controls.folderChange}
        </Button>
      </div>
    </Field>
  );
}

export function DeviceField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const vk = useSystemStore((st) => st.status?.vulkan);
  const defaultName = vk?.gpus.find((g) => g.index === vk.defaultGpu)?.name;
  const options = [
    { value: "auto", label: t.controls.deviceAuto, description: defaultName ?? t.controls.deviceCpu },
    ...(vk?.gpus ?? []).map((g) => ({ value: String(g.index), label: g.name, description: `GPU ${g.index} · ${Math.round(g.vramBytes / 1024 ** 3)} GB` })),
    { value: "-1", label: t.controls.deviceCpu },
  ];
  const value = upscale.gpu === null ? "auto" : String(upscale.gpu);
  return (
    <Field label={t.controls.device} help="gpu">
      <Select ariaLabel={t.controls.device} value={value} options={options} onChange={(v) => setUpscale({ gpu: v === "auto" ? null : Number(v) })} />
    </Field>
  );
}

const TILES = [0, 32, 64, 100, 128, 200, 256, 400, 512, 800];

/** With Auto optimize on, tiles and threads are chosen by Aoze: show them read-only. */
function useAutoTuning() {
  const auto = useSettingsStore((st) => st.settings?.performance.autoOptimize ?? false);
  const tuning = useSystemStore((st) => st.check?.tuning);
  return auto && tuning?.automatic ? tuning : null;
}

export function TileField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const auto = useAutoTuning();
  if (auto) {
    return (
      <Field label={t.controls.tile} hint={t.settings.autoManaged} inline>
        <span className={s.autoValue}>{auto.tileSize === 0 ? t.controls.tileAuto : `${auto.tileSize} px`}</span>
      </Field>
    );
  }
  return (
    <Field label={t.controls.tile}>
      <Select
        ariaLabel={t.controls.tile}
        value={String(upscale.tileSize)}
        options={TILES.map((v) => ({ value: String(v), label: v === 0 ? t.controls.tileAuto : `${v} px` }))}
        onChange={(v) => setUpscale({ tileSize: Number(v) })}
      />
    </Field>
  );
}

export function TtaField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  return (
    <Field label={t.controls.tta} inline>
      <Toggle label={t.controls.tta} checked={upscale.tta} onChange={(tta) => setUpscale({ tta })} />
    </Field>
  );
}

export function ThreadsField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const keys = ["load", "proc", "save"] as const;
  const auto = useAutoTuning();
  if (auto) {
    return (
      <Field label={t.controls.threads} hint={t.settings.autoManaged} inline>
        <span className={s.autoValue}>{`${auto.threads.load} : ${auto.threads.proc} : ${auto.threads.save}`}</span>
      </Field>
    );
  }
  return (
    <Field label={t.controls.threads}>
      <div className={s.threads}>
        {keys.map((k) => (
          <Select
            key={k}
            ariaLabel={k}
            value={String(upscale.threads[k])}
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setUpscale({ threads: { ...upscale.threads, [k]: Number(v) } })}
          />
        ))}
      </div>
    </Field>
  );
}

export function SuffixField() {
  const t = useMessages();
  const { output, upscale } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const ext = output.format === "jpeg" ? "jpg" : output.format;
  return (
    <Field label={t.controls.suffix} hint={t.controls.suffixHint}>
      <input type="text" className={s.input} value={output.suffix} spellCheck={false} onChange={(e) => setOutput({ suffix: e.target.value })} />
      <p className={s.example}>
        {fmt(t.controls.suffixExample, { from: "image.png", to: `image${renderSuffix(output.suffix, upscale)}.${ext}` })}
        <span>{t.controls.suffixTokens}</span>
      </p>
    </Field>
  );
}

export function ConflictField() {
  const t = useMessages();
  const { output } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const opts: SegmentOption<ConflictPolicy>[] = [
    { value: "rename", label: t.controls.conflictRename },
    { value: "overwrite", label: t.controls.conflictOverwrite },
    { value: "skip", label: t.controls.conflictSkip },
  ];
  return (
    <Field label={t.controls.conflict}>
      <Segmented ariaLabel={t.controls.conflict} size="sm" value={output.conflict} options={opts} onChange={(conflict) => setOutput({ conflict })} />
    </Field>
  );
}
