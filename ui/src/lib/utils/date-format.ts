/**
 * Date formatting utilities with 24-hour time format
 * All dates should use these functions for consistent display
 */

/**
 * Format a date/time in 24-hour format
 * @param timestamp - Unix timestamp in milliseconds or seconds
 * @param includeTime - Whether to include time (default: true)
 * @param includeSeconds - Whether to include seconds in time (default: false)
 * @returns Formatted date string like "11/8/2025, 18:35" or "11/8/2025, 18:35:02"
 */
export function formatDateTime24h(
  timestamp: number | string | Date,
  includeTime: boolean = true,
  includeSeconds: boolean = false
): string {
  const date = typeof timestamp === "string" || typeof timestamp === "number"
    ? new Date(typeof timestamp === "number" && timestamp < 10000000000 ? timestamp * 1000 : timestamp)
    : timestamp;
  
  if (isNaN(date.getTime())) {
    return "Invalid date";
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  
  if (includeTime) {
    if (includeSeconds) {
      return `${month}/${day}/${year}, ${hours}:${minutes}:${seconds}`;
    }
    return `${month}/${day}/${year}, ${hours}:${minutes}`;
  }
  
  return `${month}/${day}/${year}`;
}

/**
 * Format a date only (no time)
 * @param timestamp - Unix timestamp in milliseconds or seconds
 * @returns Formatted date string like "11/8/2025"
 */
export function formatDate24h(timestamp: number | string | Date): string {
  return formatDateTime24h(timestamp, false);
}

/**
 * Format a time only (24-hour format)
 * @param timestamp - Unix timestamp in milliseconds or seconds
 * @param includeSeconds - Whether to include seconds (default: false)
 * @returns Formatted time string like "18:35" or "18:35:02"
 */
export function formatTime24h(timestamp: number | string | Date, includeSeconds: boolean = false): string {
  const date = typeof timestamp === "string" || typeof timestamp === "number"
    ? new Date(typeof timestamp === "number" && timestamp < 10000000000 ? timestamp * 1000 : timestamp)
    : timestamp;
  
  if (isNaN(date.getTime())) {
    return "Invalid time";
  }
  
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  
  if (includeSeconds) {
    return `${hours}:${minutes}:${seconds}`;
  }
  
  return `${hours}:${minutes}`;
}

