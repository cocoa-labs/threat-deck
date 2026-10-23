import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @vercel/blob BEFORE importing the SUT
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
}));

import * as blob from '@vercel/blob';
import { deleteVisualBlob, headVisualBlob, uploadVisualBlob } from './vercel-blob';

describe('vercel-blob client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
  });

  afterEach(() => {
    // Restore NODE_ENV to 'test' in case any test overrode it
    (process.env as Record<string, string>).NODE_ENV = 'test';
  });

  describe('uploadVisualBlob', () => {
    it('uploads a buffer with default options and returns structured result', async () => {
      vi.mocked(blob.put).mockResolvedValueOnce({
        url: 'https://blob.vercel-storage.com/outbound-visuals/test-abc123.png',
        pathname: 'outbound-visuals/test-abc123.png',
        contentType: 'image/png',
        contentDisposition: 'attachment; filename="test.png"',
      } as never);

      const result = await uploadVisualBlob(
        'outbound-visuals/test',
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        { contentType: 'image/png' },
      );

      expect(result.url).toContain('blob.vercel-storage.com');
      expect(result.pathname).toBe('outbound-visuals/test-abc123.png');
      expect(result.contentType).toBe('image/png');
      expect(blob.put).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(blob.put).mock.calls[0]!;
      expect(callArgs[0]).toBe('outbound-visuals/test');
      expect(callArgs[2]).toMatchObject({
        access: 'private',
        contentType: 'image/png',
        addRandomSuffix: true,
      });
    });

    it('throws when BLOB_READ_WRITE_TOKEN is missing in production', async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      (process.env as Record<string, string>).NODE_ENV = 'production';

      await expect(uploadVisualBlob('test', Buffer.from([0]))).rejects.toThrow(
        /BLOB_READ_WRITE_TOKEN/,
      );
    });

    it('returns size from the buffer length', async () => {
      vi.mocked(blob.put).mockResolvedValueOnce({
        url: 'https://example.com/x.png',
        pathname: 'x.png',
        contentType: 'image/png',
        contentDisposition: '',
      } as never);

      const buf = Buffer.alloc(12345);
      const result = await uploadVisualBlob('test', buf);
      expect(result.size).toBe(12345);
    });
  });

  describe('deleteVisualBlob', () => {
    it('forwards pathname to @vercel/blob del', async () => {
      vi.mocked(blob.del).mockResolvedValueOnce(undefined as never);
      await deleteVisualBlob('outbound-visuals/abc.png');
      expect(blob.del).toHaveBeenCalledWith('outbound-visuals/abc.png', {
        abortSignal: expect.any(AbortSignal),
      });
    });
  });

  describe('headVisualBlob', () => {
    it('returns metadata when blob exists', async () => {
      vi.mocked(blob.head).mockResolvedValueOnce({
        url: 'https://example.com/x.png',
        pathname: 'x.png',
        contentType: 'image/png',
        contentDisposition: '',
        size: 1024,
      } as never);

      const result = await headVisualBlob('x.png');
      expect(result?.size).toBe(1024);
    });

    it('returns null when blob does not exist', async () => {
      vi.mocked(blob.head).mockRejectedValueOnce(new Error('Not found'));
      const result = await headVisualBlob('missing.png');
      expect(result).toBeNull();
    });
  });
});
