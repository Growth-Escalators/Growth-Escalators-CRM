// Thin HTTP handlers for the contracts module. No business logic here — extract
// the tenant-scoped ctx from req.user (populated by requireAuth), call the
// service, return JSON. Thrown HttpErrors are serialized by the global error
// handler in src/index.ts.
import { type Request, type Response, type NextFunction } from 'express';
import * as service from './esign.service';
import { peekNextContractNumber } from './contract-numbering';

function ctxOf(req: Request): service.Ctx {
  const u = req.user!;
  return { tenantId: u.tenantId, userId: u.id, role: u.role };
}

// Wrap async handlers so rejected promises reach Express's error pipeline.
type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
function h(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export const listContracts = h(async (req, res) => {
  const q = req.query;
  const rows = await service.listContracts(ctxOf(req), {
    status: typeof q.status === 'string' ? q.status : undefined,
    clientCompanyId: typeof q.clientCompanyId === 'string' ? q.clientCompanyId : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  });
  res.json({ contracts: rows });
});

export const previewNumber = h(async (req, res) => {
  res.json(await peekNextContractNumber(ctxOf(req).tenantId));
});

export const createContract = h(async (req, res) => {
  const b = req.body ?? {};
  const detail = await service.createContract(ctxOf(req), {
    title: b.title,
    clientCompanyId: b.clientCompanyId,
    templateId: b.templateId,
    terms: b.terms,
    expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    recipients: Array.isArray(b.recipients) ? b.recipients : undefined,
    metadata: b.metadata,
  });
  res.status(201).json(detail);
});

export const getContract = h(async (req, res) => {
  res.json(await service.getContractDetail(ctxOf(req), String(req.params.id)));
});

export const getAudit = h(async (req, res) => {
  const detail = await service.getContractDetail(ctxOf(req), String(req.params.id));
  res.json({ events: detail.events });
});

export const addRecipients = h(async (req, res) => {
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  res.json(await service.addRecipients(ctxOf(req), String(req.params.id), recipients));
});

export const generateContract = h(async (req, res) => {
  res.json(await service.generateContract(ctxOf(req), String(req.params.id)));
});

export const approveContract = h(async (req, res) => {
  res.json(await service.approveContract(ctxOf(req), String(req.params.id)));
});

export const sendContract = h(async (req, res) => {
  res.json(await service.sendContract(ctxOf(req), String(req.params.id)));
});

export const voidContract = h(async (req, res) => {
  res.json(await service.voidContract(ctxOf(req), String(req.params.id), String(req.body?.reason ?? '')));
});

export const cloneContract = h(async (req, res) => {
  res.status(201).json(await service.cloneContract(ctxOf(req), String(req.params.id)));
});

export const downloadContract = h(async (req, res) => {
  const artifact = (req.query.artifact as string) || 'completed';
  if (!['generated', 'completed', 'audit-certificate'].includes(artifact)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'invalid artifact' } });
    return;
  }
  const url = await service.getDownloadUrl(ctxOf(req), String(req.params.id), artifact as 'generated' | 'completed' | 'audit-certificate');
  res.json({ url, expiresInSeconds: Number(process.env.CONTRACTS_SIGNED_URL_TTL_SECONDS) || 300 });
});
