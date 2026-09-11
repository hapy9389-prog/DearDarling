import { Router } from 'express';
import type { Pool } from 'pg';
import { findUserById } from '../repositories/usersRepository';
import { findCoupleById, updateRelationshipStartDate } from '../repositories/couplesRepository';
import { isValidCalendarDate } from '../domain/date';

export function createCoupleRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const user = await findUserById(pool, req.userId!);
      if (!user?.couple_id) {
        res.status(404).json({ error: 'not-connected' });
        return;
      }
      const couple = await findCoupleById(pool, user.couple_id);
      res.json(couple);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const user = await findUserById(pool, req.userId!);
      if (!user?.couple_id) {
        res.status(404).json({ error: 'not-connected' });
        return;
      }

      const body: Record<string, unknown> =
        typeof req.body === 'object' && req.body !== null ? req.body : {};

      // 필드 자체가 없으면 기존 값을 그대로 유지한다 — undefined로 강제 변환해 지우지 않는다.
      if (!('relationshipStartDate' in body)) {
        const couple = await findCoupleById(pool, user.couple_id);
        res.json(couple);
        return;
      }

      const raw = body.relationshipStartDate;
      // 명시적으로 null을 보냈을 때만 삭제한다.
      if (raw === null) {
        const couple = await updateRelationshipStartDate(pool, user.couple_id, null);
        res.json(couple);
        return;
      }
      if (typeof raw !== 'string' || !isValidCalendarDate(raw)) {
        res.status(400).json({ error: 'invalid-relationship-start-date' });
        return;
      }
      const couple = await updateRelationshipStartDate(pool, user.couple_id, raw);
      res.json(couple);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
