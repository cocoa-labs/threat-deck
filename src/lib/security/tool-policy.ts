import Ajv from 'ajv';
import type { ToolDefinition } from '@/lib/agent/types';
import { type Capability, isCapabilityEnabled } from './capabilities';

const capabilities: Record<string, Capability[]> = {
  email_conversation: ['email'],
  reply_to_email: ['email', 'gmail'],
  check_email_replies: ['gmail'],
  post_to_x: ['x'],
  x_check_replies: ['x'],
  x_reply_to_tweet: ['x'],
  generate_image: ['media'],
  generate_video: ['media'],
  get_generated_media_status: ['media'],
};
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
const validators = new WeakMap<ToolDefinition, ReturnType<Ajv['compile']>>();

export function toolEnabled(tool: ToolDefinition): boolean {
  return (
    (!tool.featureFlag || process.env[tool.featureFlag] === 'true') &&
    (capabilities[tool.name] ?? []).every(isCapabilityEnabled)
  );
}

export function validateToolInput(tool: ToolDefinition, input: Record<string, unknown>): boolean {
  try {
    if (JSON.stringify(input).length > 64_000) return false;
    let validate = validators.get(tool);
    if (!validate) {
      validate = ajv.compile(tool.inputSchema);
      validators.set(tool, validate);
    }
    return !!validate(input);
  } catch {
    return false;
  }
}
