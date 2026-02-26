import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Derive a short hex ID from a UUID for compact display (like git short SHAs).
 * "550e8400-e29b-41d4-a716-446655440000" → "550e84"
 */
export function getShortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toLowerCase()
}

/**
 * Strip common vendor prefixes from GPU names for compact display.
 * "NVIDIA GeForce RTX 4090" → "RTX 4090"
 * "NVIDIA A100" → "A100"
 * "AMD Radeon RX 7900" → "RX 7900"
 * "Apple M4 Pro" → "M4 Pro"
 * Unknown formats pass through unchanged.
 */
export function compactGpuName(name: string): string {
  return name
    .replace(/^NVIDIA\s+(GeForce\s+)?/i, '')
    .replace(/^AMD\s+(Radeon\s+)?/i, '')
    .replace(/^Apple\s+/i, '')
    .trim()
}

/**
 * Convert all snake_case keys in an object to camelCase.
 * Used to normalize Supabase Realtime payloads (Postgres column names)
 * to match the frontend's camelCase conventions.
 */
export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    result[camelKey] = value
  }
  return result
}
