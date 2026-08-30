/** User-Agent routing for Lanis mobile app vs normal browsers. */

export function isLanisMobile(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return userAgent.includes("Lanis-Mobile");
}
