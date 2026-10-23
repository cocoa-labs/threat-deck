'use client';
import { useEffect, useState } from 'react';

export function ConfigurationNotice() {
  const [aiEnabled, setAIEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/capabilities', { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) setAIEnabled(Boolean((await response.json()).capabilities.ai));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (aiEnabled !== false) return null;
  return (
    <p role="status" className="border-b border-green-900 px-4 py-2 text-xs text-neutral-300">
      AI assistance is not configured. The dashboard is available; an administrator can enable
      optional integrations using the installation guide.
    </p>
  );
}
