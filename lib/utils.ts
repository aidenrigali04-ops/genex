import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function autoTitle(inputContent: string): string {
  const trimmed = inputContent.trim()
  if (!trimmed) {
    return `Generation · ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`
  }
  if (trimmed.length <= 60) return trimmed
  const cut = trimmed.slice(0, 60)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + "…"
}
