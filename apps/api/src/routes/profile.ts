import { Router } from 'express';
import type { Pool } from 'pg';
import { findUserById, updateProfile } from '../repositories/usersRepository';
import { profileComplete } from '../domain/auth';

export function createProfileRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const user = await findUserById(pool, req.userId!);
      if (!user) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const nickname =
        typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : undefined;
      const avatarEmoji =
        typeof req.body?.avatarEmoji === 'string' ? req.body.avatarEmoji : undefined;
      if (nickname !== undefined && !profileComplete(nickname)) {
        res.status(400).json({ error: 'invalid-nickname' });
        return;
      }
      const updated = await updateProfile(pool, req.userId!, { nickname, avatarEmoji });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
