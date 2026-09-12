import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { findUserById } from '../repositories/usersRepository';
import {
  findCoupleById,
  findPartnerInCouple,
  updateRelationshipStartDate,
  type CoupleRow,
} from '../repositories/couplesRepository';
import { isValidCalendarDate } from '../domain/date';

/** 커플 행 + 상대 정보(닉네임·아바타만)를 한데 묶어 응답한다 — GET·PATCH 네 곳에서 재사용. */
async function respondWithCouple(
  pool: Pool,
  res: Response,
  couple: CoupleRow,
  selfUserId: string,
): Promise<void> {
  const partner = await findPartnerInCouple(pool, couple.id, selfUserId);
  res.json({ ...couple, partner });
}

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
      if (!couple) {
        res.status(404).json({ error: 'not-connected' });
        return;
      }
      await respondWithCouple(pool, res, couple, req.userId!);
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
        if (!couple) {
          res.status(404).json({ error: 'not-connected' });
          return;
        }
        await respondWithCouple(pool, res, couple, req.userId!);
        return;
      }

      const raw = body.relationshipStartDate;
      // 명시적으로 null을 보냈을 때만 삭제한다.
      if (raw === null) {
        const couple = await updateRelationshipStartDate(pool, user.couple_id, null);
        await respondWithCouple(pool, res, couple, req.userId!);
        return;
      }
      if (typeof raw !== 'string' || !isValidCalendarDate(raw)) {
        res.status(400).json({ error: 'invalid-relationship-start-date' });
        return;
      }
      const couple = await updateRelationshipStartDate(pool, user.couple_id, raw);
      await respondWithCouple(pool, res, couple, req.userId!);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
