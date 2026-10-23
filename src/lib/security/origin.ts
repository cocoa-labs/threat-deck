/** Never derive the trusted origin from caller-controlled forwarding headers. */
export function applicationOrigin(): string | null {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  try {
    if (configured) {
      const url = new URL(configured);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.origin
        : null;
    }
    return process.env.NODE_ENV === 'development' ? 'http://localhost:3002' : null;
  } catch {
    return null;
  }
}

export function isTrustedOrigin(origin: string | null): boolean {
  return origin !== null && origin === applicationOrigin();
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(host);
  } catch {
    return false;
  }
}
