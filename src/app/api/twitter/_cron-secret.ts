import { hasCronSecret } from '@/lib/security/service-auth';
export interface CronSecretCheck {
  ok: boolean;
  reason?: string;
}
export function checkCronSecret(request: Request): CronSecretCheck {
  return hasCronSecret(request)
    ? { ok: true }
    : { ok: false, reason: 'Invalid or missing cron secret' };
}
