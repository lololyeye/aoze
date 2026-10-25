import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import s from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

export function Select({ value, options, onChange, ariaLabel }: SelectProps) {
  return (
    <RS.Root value={value} onValueChange={onChange}>
      <RS.Trigger className={s.trigger} aria-label={ariaLabel}>
        <RS.Value />
        <RS.Icon className={s.chevron}>
          <ChevronDown size={14} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className={s.content} position="popper" sideOffset={4} collisionPadding={8}>
          <RS.Viewport className={s.viewport}>
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} disabled={o.disabled} className={s.item}>
                <div className={s.itemText}>
                  <RS.ItemText>{o.label}</RS.ItemText>
                  {o.description && <span className={s.description}>{o.description}</span>}
                </div>
                <RS.ItemIndicator className={s.check}>
                  <Check size={14} />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
