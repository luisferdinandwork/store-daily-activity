"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// This app has no dark theme (see app/globals.css — a single light @theme
// block), so the toaster is styled once, deliberately, to match the site's
// purple identity rather than sonner's generic light/dark + richColors
// defaults.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "light" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      gap={10}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "rounded-xl border shadow-lg backdrop-blur-sm font-[system-ui,-apple-system,sans-serif] px-4 py-3.5",
          title: "text-sm font-semibold",
          description: "text-xs opacity-80",
          actionButton: "rounded-lg text-xs font-bold",
          cancelButton: "rounded-lg text-xs font-semibold",
          closeButton: "border-none",
        },
      }}
      style={
        {
          "--normal-bg": "var(--color-card)",
          "--normal-text": "var(--color-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius-lg)",

          "--success-bg": "#f0fdf4",
          "--success-text": "#15803d",
          "--success-border": "#bbf7d0",

          "--error-bg": "#fef2f2",
          "--error-text": "#b91c1c",
          "--error-border": "#fecaca",

          "--warning-bg": "#fffbeb",
          "--warning-text": "#b45309",
          "--warning-border": "#fde68a",

          "--info-bg": "#f5f3ff",
          "--info-text": "#5b3fd6",
          "--info-border": "#ddd6fe",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
