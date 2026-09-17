import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 min-h-20 px-3 py-2 bg-[var(--cowork-control)] border border-[var(--cowork-line)] rounded-lg",
        "text-[13px] leading-5 text-[var(--cowork-ink)]",
        "placeholder:text-[var(--cowork-muted)]",
        "focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "transition-[color,background-color,border-color,box-shadow] resize-y",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
