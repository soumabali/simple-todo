/**
 * Timezones offered in the profile picker.
 *
 * Curated rather than exhaustive: the list covers the zones this app is
 * actually used from, plus UTC. Any valid IANA name is still accepted by the
 * API — this only drives the <select>.
 */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Jakarta", label: "Asia/Jakarta (WIB, UTC+7)" },
  { value: "Asia/Makassar", label: "Asia/Makassar (WITA, UTC+8)" },
  { value: "Asia/Jayapura", label: "Asia/Jayapura (WIT, UTC+9)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur (UTC+8)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (UTC+7)" },
  { value: "Asia/Manila", label: "Asia/Manila (UTC+8)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (UTC+9)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (UTC+4)" },
  { value: "Australia/Perth", label: "Australia/Perth (UTC+8)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+10/11)" },
  { value: "Europe/London", label: "Europe/London (UTC+0/1)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (UTC+1/2)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (UTC+1/2)" },
  { value: "America/New_York", label: "America/New_York (UTC-5/-4)" },
  { value: "America/Chicago", label: "America/Chicago (UTC-6/-5)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8/-7)" },
  { value: "UTC", label: "UTC" },
];
