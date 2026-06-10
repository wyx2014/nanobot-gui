import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-h-20 px-3 py-2 bg-[#faf9f7] border border-[#e8e4dd] rounded-lg",
        "text-sm text-[#29261b]",
        "placeholder:text-[#b8b5ab]",
        "focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]",
        "disabled:pointer-events-none disabled:opacity-50",
        "transition-all resize-y",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
