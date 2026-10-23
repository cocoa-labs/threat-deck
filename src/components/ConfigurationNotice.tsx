'use client';
import { useEffect, useState } from 'react';

export function ConfigurationNotice() {
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [aiEnabled, setAIEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/capabilities', { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const { capabilities } = await response.json();
          setAIEnabled(Boolean(capabilities.ai));
          setDemoEnabled(Boolean(capabilities.demoData));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (aiEnabled !== false && !demoEnabled) return null;
  return (
    <p role="status" className="border-b border-green-900 px-4 py-2 text-xs text-neutral-300">
      {demoEnabled
        ? 'DEMO MODE — samples are synthetic and are not evidence. External publishing and autonomous jobs are disabled.'
        : 'AI assistance is not configured. The dashboard is available; an administrator can enable optional integrations using the installation guide.'}
    </p>
  );
}
