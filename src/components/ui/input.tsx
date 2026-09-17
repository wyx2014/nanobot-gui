import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 h-9 px-3 bg-[var(--cowork-control)] border border-[var(--cowork-line)] rounded-lg",
        "text-[13px] text-[var(--cowork-ink)]",
        "placeholder:text-[var(--cowork-muted)]",
        "focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "transition-[color,background-color,border-color,box-shadow]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
