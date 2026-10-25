import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";
import s from "./Sheet.module.css";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  actions?: ReactNode;
  children: ReactNode;
  /** "side" slides in from the right; "center" is a dialog. */
  variant?: "side" | "center";
}

export function Sheet({ open, onClose, title, closeLabel, actions, children, variant = "side" }: SheetProps) {
  return (
    <RD.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        <RD.Overlay className={s.overlay} />
        <RD.Content className={`${s.content} ${s[variant]}`} aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
          <header className={s.header}>
            <RD.Title className={s.title}>{title}</RD.Title>
            <div className={s.actions}>
              {actions}
              <RD.Close asChild>
                <IconButton label={closeLabel} size="sm">
                  <X />
                </IconButton>
              </RD.Close>
            </div>
          </header>
          <div className={s.body}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
