import { expect, it } from 'vitest';
import { extractYouTubeVideoId, parseYouTubeMessage } from './youtube';

it('accepts actual YouTube links and rejects lookalike hosts and malformed IDs', () => {
  for (const url of [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/shorts/dQw4w9WgXcQ',
  ])
    expect(extractYouTubeVideoId(url)).toBe('dQw4w9WgXcQ');
  for (const url of [
    'https://evilyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ',
    'https://attacker.example/?youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=../escape',
    'javascript:alert(1)',
  ])
    expect(extractYouTubeVideoId(url)).toBeNull();
});
it('accepts bounded messages only from the active YouTube iframe', () => {
  const player = {} as MessageEventSource;
  const event = {
    origin: 'https://www.youtube.com',
    source: player,
    data: JSON.stringify({ event: 'onStateChange', info: 0 }),
  };
  expect(parseYouTubeMessage(event, player)).toEqual({ event: 'onStateChange', info: 0 });
  expect(parseYouTubeMessage({ ...event, origin: 'https://attacker.example' }, player)).toBeNull();
  expect(parseYouTubeMessage({ ...event, source: {} as MessageEventSource }, player)).toBeNull();
  expect(parseYouTubeMessage(event, null)).toBeNull();
  expect(parseYouTubeMessage({ ...event, data: 'x'.repeat(65_537) }, player)).toBeNull();
  expect(parseYouTubeMessage({ ...event, data: '{' }, player)).toBeNull();
});
