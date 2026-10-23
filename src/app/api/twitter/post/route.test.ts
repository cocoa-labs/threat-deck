import { expect, it } from 'vitest';
import { POST } from './route';

it('retires direct publication in favor of the approval queue', async () => {
  const result = await POST(
    new Request('http://localhost:3002/api/twitter/post', { method: 'POST' }),
  );
  expect(result.status).toBe(410);
});
