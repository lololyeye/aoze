import * as RP from "@radix-ui/react-popover";
import { useMessages } from "../../i18n";
import type { Messages } from "../../i18n/en";
import s from "./HelpTip.module.css";

/** Topics of the short answers in `help` (each has `q` and `a`). */
export type HelpTopic = {
  [K in keyof Messages["help"]]: Messages["help"][K] extends { q: string; a: string } ? K : never;
}[keyof Messages["help"]];

/** Small "?" next to a setting: one plain-language answer. */
export function HelpTip({ topic }: { topic: HelpTopic }) {
  const t = useMessages();
  const item = t.help[topic];
  return (
    <RP.Root>
      <RP.Trigger asChild>
        <button type="button" className={s.trigger} aria-label={item.q}>
          ?
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content className={s.content} side="left" align="start" sideOffset={8} collisionPadding={12}>
          <div className={s.q}>{item.q}</div>
          <p className={s.a}>{item.a}</p>
          <RP.Arrow className={s.arrow} />
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
