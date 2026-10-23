import { reserveBudget } from '@/lib/security/budget';
/**
 * OpenAI gpt-image-2 client (Phase 14 Tier A).
 *
 * - Calls openai.images.generate with model 'gpt-image-2'
 * - Tier A backdrop calls can still suppress text via the standard negative
 *   prompt. IMG Button V2 sets allowText=true so the model renders the full
 *   infographic directly.
 * - Token-based pricing: $8/M input + $30/M output (per OpenAI 2026 docs)
 * - Throws specific error subclasses so the orchestrator can retry vs fail
 */

import OpenAI from 'openai';
import {
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageProvider,
  ProviderApiError,
  ProviderRateLimitError,
} from './types';

const MODEL = 'gpt-image-2';
const MODEL_VERSION = 'gpt-image-2-2026-04-21'; // GA release date
const COST_PER_M_INPUT_USD = 8.0;
const COST_PER_M_OUTPUT_USD = 30.0;
const DEFAULT_BACKDROP_NEGATIVE_PROMPT =
  'no text in image, no letters, no words, no characters, no captions, no overlays';

export class OpenAIImageProvider implements ImageProvider {
  readonly providerId = 'openai_gpt_image_2';
  private readonly client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAIImageProvider but is not set.');
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 120_000,
    });
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const width = request.width ?? 1200;
    const height = request.height ?? 2400;
    const quality = request.quality ?? 'high';
    const negative = request.allowText
      ? request.negativePrompt
      : (request.negativePrompt ?? DEFAULT_BACKDROP_NEGATIVE_PROMPT);
    const fullPrompt = [request.prompt.trim(), negative?.trim()].filter(Boolean).join(' ');

    const startMs = Date.now();
    let response: Awaited<ReturnType<OpenAI['images']['generate']>>;
    const release = await reserveBudget('media', Number(process.env.IMAGE_RESERVATION_USD || 5));
    try {
      response = await this.client.images.generate({
        model: MODEL,
        prompt: fullPrompt,
        size: `${width}x${height}` as never,
        quality: quality as never,
        n: 1,
        // NOTE: gpt-image-2 does NOT accept `response_format` — it returns
        // b64_json by default. Setting the param 400s with "Unknown parameter".
      } as never);
    } catch (err) {
      const errAny = err as { status?: number; message?: string; headers?: Record<string, string> };
      const rejected =
        errAny.status != null &&
        errAny.status >= 400 &&
        errAny.status < 500 &&
        errAny.status !== 408;
      await release(rejected ? 0 : undefined).catch(() => {});
      if (errAny.status === 429) {
        const retryAfter = errAny.headers?.['retry-after-ms'];
        throw new ProviderRateLimitError(
          this.providerId,
          retryAfter ? Number(retryAfter) : undefined,
        );
      }
      throw new ProviderApiError(
        this.providerId,
        errAny.status ?? 0,
        errAny.message ?? 'unknown error',
      );
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const usage = (
      response as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }
    ).usage;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const costUsd =
      (inputTokens * COST_PER_M_INPUT_USD) / 1_000_000 +
      (outputTokens * COST_PER_M_OUTPUT_USD) / 1_000_000;
    const knownUsage =
      usage != null &&
      Number.isSafeInteger(usage.input_tokens) &&
      Number.isSafeInteger(usage.output_tokens) &&
      inputTokens >= 0 &&
      outputTokens >= 0;
    await release(knownUsage ? costUsd : undefined);
    const first = response.data?.[0];
    if (!first?.b64_json) {
      throw new ProviderApiError(this.providerId, 200, 'no image returned');
    }
    const buffer = Buffer.from(first.b64_json, 'base64');

    return {
      buffer,
      mimeType: 'image/png',
      provider: this.providerId,
      modelVersion: MODEL_VERSION,
      costUsd,
      durationMs,
      width,
      height,
      providerResponseId: (response as unknown as { id?: string }).id,
    };
  }
}
