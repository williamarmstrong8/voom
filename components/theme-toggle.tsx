"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid a hydration mismatch: the resolved theme is only known on the client,
  // so the server render and first client render must be identical. We keep the
  // label/handler theme-agnostic until after mount.
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      aria-label={
        !mounted ? "Toggle theme" : isDark ? "Switch to light mode" : "Switch to dark mode"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <Sun className="size-4 opacity-0" />
      )}
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
