'use client';
import { useAgentStore } from '@/lib/store/agent-store';
import { useCompanionStore } from '@/lib/store/companion-store';

export function clearBrowserPrivateData(): void {
  for (const attachment of useAgentStore.getState().activeAttachments) {
    if (attachment.localPreviewUrl) URL.revokeObjectURL(attachment.localPreviewUrl);
  }
  useAgentStore.setState(useAgentStore.getInitialState(), true);
  useCompanionStore.setState(useCompanionStore.getInitialState(), true);
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name];
      for (const key of Object.keys(storage)) {
        if (/^(threatdeck[-:]|klammer[-:])/.test(key)) storage.removeItem(key);
      }
    } catch {
      /* Storage may be disabled by browser policy. */
    }
  }
}
