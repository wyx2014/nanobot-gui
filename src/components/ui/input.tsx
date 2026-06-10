import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full h-9 px-3 bg-[#faf9f7] border border-[#e8e4dd] rounded-lg",
        "text-sm text-[#29261b]",
        "placeholder:text-[#b8b5ab]",
        "focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]",
        "disabled:pointer-events-none disabled:opacity-50",
        "transition-all",
        className
      )}
      {...props}
    />
  )
}

export { Input }
