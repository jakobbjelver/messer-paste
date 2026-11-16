"use client";

import type { ReactNode } from "react";
import { Info } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  HybridTooltip,
  HybridTooltipContent,
  HybridTooltipProvider,
  HybridTooltipTrigger,
} from "@/components/ui/hybrid-tooltip";
import { cn } from "@/lib/utils";

export function InfoTip({
  text,
  label = "More information",
  className,
}: {
  text: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <HybridTooltipProvider>
      <HybridTooltip>
        <HybridTooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cn("-my-1 size-7 rounded-none text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]", className)}
          >
            <Info size={14} aria-hidden="true" />
          </Button>
        </HybridTooltipTrigger>
        <HybridTooltipContent
          side="top"
          align="start"
          sideOffset={6}
          className="max-w-[248px] border border-[var(--border-strong)] bg-[var(--surface)] p-2.5 text-[11.5px] leading-relaxed text-[var(--text-2)] shadow-[var(--shadow-pop)]"
        >
          {text}
        </HybridTooltipContent>
      </HybridTooltip>
    </HybridTooltipProvider>
  );
}
