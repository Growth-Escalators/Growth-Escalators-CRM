// Public (no-auth) signing handlers. Authorization is the HMAC signing token in
// the path (validated in esign.signing.service). Captures IP + user-agent for
// the consent/audit record.
import { type Request, type Response, type NextFunction } from 'express';
import * as signing from './esign.signing.service';

function meta(req: Request): signing.SignerRequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
function h(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export const getSignable = h(async (req, res) => {
  res.json(await signing.getSignableContract(String(req.params.token), meta(req)));
});

export const submitSign = h(async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  res.json(
    await signing.submitConsentAndCreateSession(
      String(req.params.token),
      {
        electronicTransactionConsent: b.electronicTransactionConsent === true,
        reviewedDocument: b.reviewedDocument === true,
        intentToSign: b.intentToSign === true,
        authorityConfirmed: b.authorityConfirmed === true,
      },
      meta(req),
    ),
  );
});
