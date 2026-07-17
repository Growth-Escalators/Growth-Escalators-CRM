// Public Documenso webhook router — NO requireAuth (verified by HMAC signature).
// Mounted at /webhooks/documenso in src/index.ts, before the auth wall.
import { Router } from 'express';
import { handleDocumensoWebhook } from './esign.webhook';

const router = Router();

router.post('/', (req, res, next) => {
  // Documenso sends the configured secret verbatim in X-Documenso-Secret.
  const receivedSecret = req.header('x-documenso-secret') ?? undefined;
  handleDocumensoWebhook(receivedSecret, req.body)
    .then((result) => res.status(200).json(result))
    .catch(next);
});

export default router;
