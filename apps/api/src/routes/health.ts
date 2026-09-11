import { Router } from 'express';
import type { Pool } from 'pg';

export function createHealthRouter(pool: Pool): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  return router;
}
