/** Legacy app route; post-login and OAuth return targets should use `/`. */
export function normalizeInternalReturnPath(path: string): string {
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "/";
  return path;
}
