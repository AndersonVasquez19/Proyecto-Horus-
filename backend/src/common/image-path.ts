export function isManagedUploadPath(value: string): boolean {
  return /^\/api\/uploads\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(value);
}
