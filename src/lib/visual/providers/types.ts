/**
 * Provider interface contracts for visual generation (Phase 14).
 *
 * ImageProvider: implemented in Tier A by OpenAIImageProvider (gpt-image-2).
 *
 * Video shipped on a different surface than these interfaces anticipated: the
 * Higgsfield `@higgsfield/cli` binary (Seedance 2.0), driven server-side via
 * execFile — see providers/higgsfield-cli-video.ts (local dev) and
 * providers/higgsfield-remote-video.ts (production, forwarding to the Fly render
 * worker). providers/video-provider.ts selects between them. The async job model
 * (start → poll → finalize) lives in lib/visual/video-generation-service.ts, so
 * the VideoProvider/VideoGenerationResult shapes below are vestigial and unused.
 *
 * See: docs/superpowers/specs/2026-05-25-phase-14-tier-a-foundation-design.md
 */

// ───────────── Image ─────────────

export interface ImageGenerationRequest {
  prompt: string;
  styleTag: string;
  width?: number; // default 1200
  height?: number; // default 2400 (vertical infographic)
  quality?: 'low' | 'medium' | 'high'; // default 'high'
  negativePrompt?: string;
  /** True for V2 model-rendered infographics where the model should render text. */
  allowText?: boolean;
  /** Estimated max cost in USD this call may incur. Used by cost guard. */
  maxCostUsd?: number;
}

export interface ImageGenerationResult {
  buffer: Buffer;
  mimeType: string; // 'image/png'
  provider: string; // 'openai_gpt_image_2'
  modelVersion: string; // e.g. 'gpt-image-2-2026-04-21'
  costUsd: number; // actual cost incurred
  durationMs: number;
  width: number;
  height: number;
  providerResponseId?: string;
}

export interface ImageProvider {
  readonly providerId: string;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

// ───────────── Video (interfaces only in Tier A) ─────────────

export interface VideoGenerationRequest {
  prompt: string;
  styleTag: string;
  durationSeconds?: number; // default 5; SeedDance 2.0 supports 5-10s
  withAudio?: boolean; // default true; SeedDance 2.0 has joint a/v sync
  width?: number; // default 1080
  height?: number; // default 1920 (vertical, Twitter mobile-first)
}

export interface VideoGenerationResult {
  buffer: Buffer;
  mimeType: string; // 'video/mp4'
  provider: string; // 'higgsfield_seedance_2' (Tier C)
  modelVersion: string;
  costUsd: number;
  durationMs: number;
  durationSeconds: number;
  width: number;
  height: number;
  providerResponseId?: string;
}

export interface VideoProvider {
  readonly providerId: string;
  generate(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

// ───────────── Errors ─────────────

export class ProviderRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(
      `Provider ${provider} rate-limited${retryAfterMs ? `; retry after ${retryAfterMs}ms` : ''}`,
    );
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderApiError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly providerMessage: string,
  ) {
    super(`Provider ${provider} returned ${status}: ${providerMessage}`);
    this.name = 'ProviderApiError';
  }
}
