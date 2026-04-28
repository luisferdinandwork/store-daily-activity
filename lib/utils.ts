// lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as Indonesian Rupiah.
 * e.g. 150000 → "Rp 150.000"
 *
 * @param value  The numeric amount to format.
 * @param withPrefix  Whether to include the "Rp " prefix (default: true).
 */
export function formatRupiah(value: number, withPrefix = true): string {
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
  return withPrefix ? `Rp ${formatted}` : formatted
}