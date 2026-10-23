'use client';
import { useRef, useState } from 'react';
import type { AgentAttachmentSummary } from '@/lib/agent/attachments/types';
import { useAgentStore } from '@/lib/store/agent-store';
export function PrivateFilesControl() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<AgentAttachmentSummary[]>([]);
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch('/api/agent/attachments', { cache: 'no-store' });
    if (!response.ok)
      throw new Error('Cannot load private files. Retry when the server is available.');
    const data = await response.json();
    setFiles(data.attachments);
    setPending(data.pendingDeletions);
  };
  const act = async (path?: string) => {
    setBusy(true);
    setMessage('');
    try {
      if (path) {
        const response = await fetch(path, {
          method: path.endsWith('/cleanup') ? 'POST' : 'DELETE',
        });
        if (!response.ok)
          throw new Error('Deletion was not confirmed. The file may still exist; please retry.');
        const result = await response.json();
        setMessage(
          response.status === 202
            ? 'Access revoked. Storage deletion remains pending and will retry.'
            : 'Storage deletion confirmed.',
        );
        if (result.accessRevoked)
          useAgentStore.getState().removeActiveAttachment(path.split('/').at(-1)!);
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed. Retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="px-2 text-[10px]"
        onClick={() => {
          dialog.current?.showModal();
          void act();
        }}
      >
        Private files
      </button>
      <dialog
        ref={dialog}
        className="m-auto max-w-lg border border-neutral-700 bg-neutral-950 p-5 text-neutral-100"
        aria-labelledby="private-files-title"
      >
        <h2 id="private-files-title">Private attachments</h2>
        <p className="my-3 text-xs">
          Deleting revokes access and removes extracted content immediately. Storage outages leave a
          tracked cleanup job. Backups follow your installation’s retention policy.
        </p>
        <p role="status" className="my-2 text-xs">
          {message}
        </p>
        <p className="text-xs">{pending} storage deletion(s) pending.</p>
        <ul>
          {files.map((file) => (
            <li key={file.id} className="my-2 flex justify-between gap-3 text-xs">
              <span>
                {file.filename} ({file.status})
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void act(`/api/agent/attachments/${file.id}`);
                }}
              >
                Delete {file.filename}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={busy || !pending}
          onClick={() => {
            void act('/api/agent/attachments/cleanup');
          }}
          className="my-3 mr-5 text-xs"
        >
          Retry pending deletions
        </button>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
