import { apiPut, type Outcome } from './httpClient';

/** 실제 동의 API(`apps/api/src/routes/consent.ts`). */

export interface ApiConsentEvent {
  id: string;
  user_id: string;
  granted: boolean;
  version: number;
  changed_at: string;
}

export function setConsent(granted: boolean): Promise<Outcome<ApiConsentEvent>> {
  return apiPut('/api/consent', { granted });
}
