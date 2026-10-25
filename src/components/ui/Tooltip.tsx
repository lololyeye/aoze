import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import s from "./Tooltip.module.css";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Wider tooltip for explanations. */
  wide?: boolean;
}

export function Tooltip({ content, children, side = "top", wide }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} sideOffset={6} collisionPadding={8} className={`${s.content} ${wide ? s.wide : ""}`}>
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export const TooltipProvider = RT.Provider;
