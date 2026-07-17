// Public Documenso webhook router — NO requireAuth (verified by HMAC signature).
// Mounted at /webhooks/documenso in src/index.ts, before the auth wall.
import { Router, type Request } from 'express';
import { handleDocumensoWebhook } from './esign.webhook';

const router = Router();

router.post('/', (req, res, next) => {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
  const signature =
    req.header('x-documenso-signature') ?? req.header('x-signature') ?? undefined;
  handleDocumensoWebhook(rawBody, signature, req.body)
    .then((result) => res.status(200).json(result))
    .catch(next);
});

export default router;
