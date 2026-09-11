import { createApp } from '../../src/app';
import { getTestPool } from './db';

export async function buildTestApp() {
  const pool = await getTestPool();
  return createApp({ pool, localTestAuth: true });
}
