// Public signing router — NO requireAuth. Mounted at /api/contracts/sign in
// src/index.ts BEFORE the protected /api/contracts mount (the auth wall
// terminates with 401 without calling next(), so the public carve-out must be
// registered first). Every handler is authorized by the HMAC signing token.
import { Router } from 'express';
import { getSignable, submitSign } from './esign.public.controller';

const router = Router();

router.get('/:token', getSignable);
router.post('/:token', submitSign);

export default router;
