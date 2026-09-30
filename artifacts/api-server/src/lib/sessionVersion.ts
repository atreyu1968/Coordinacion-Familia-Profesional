export function isCurrentTokenVersion(
  tokenVersion: number,
  storedVersion: number,
): boolean {
  return tokenVersion === storedVersion;
}