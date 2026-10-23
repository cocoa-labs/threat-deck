/** Rechecked for every API request, session and WebSocket heartbeat. */
export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)) {
    return false;
  }
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return (process.env.ALLOWED_EMAILS ?? '').split(',').some((raw) => {
    const entry = raw.trim().toLowerCase();
    return entry === normalized || entry === `@${domain}`;
  });
}
