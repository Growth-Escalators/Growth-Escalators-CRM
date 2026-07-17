// Thin HTTP handlers for the contracts module. No business logic here — extract
// the tenant-scoped ctx from req.user (populated by requireAuth), call the
// service, return JSON. Thrown HttpErrors are serialized by the global error
// handler in src/index.ts.
import { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import * as service from './esign.service';
import { peekNextContractNumber } from './contract-numbering';
import { isLocalReference, resolveLocalPath, getContractDownloadUrl } from './document-storage.service';

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

// Bring-your-own-PDF: multipart upload (field "file") stored via multer memory
// storage. The buffer is validated as a real PDF inside the service before it
// reaches the provider.
export const uploadContractPdf = h(async (req, res) => {
  const file = (req as unknown as { file?: { buffer?: Buffer } }).file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'a PDF file is required (multipart form field "file")' } });
    return;
  }
  res.json(await service.uploadContractPdf(ctxOf(req), String(req.params.id), file.buffer));
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

// Stream a stored artifact directly (used for local-filesystem storage; redirects
// to a presigned URL for R2-backed refs).
export const streamContractFile = h(async (req, res) => {
  const artifact = String(req.params.artifact);
  if (!['generated', 'completed', 'audit-certificate'].includes(artifact)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'invalid artifact' } });
    return;
  }
  const ref = await service.getArtifactRef(ctxOf(req), String(req.params.id), artifact as service.DownloadArtifact);
  if (isLocalReference(ref)) {
    const filePath = resolveLocalPath(ref);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'file not found' } });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${artifact}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.redirect(302, await getContractDownloadUrl(ref));
});

export const reissueSigningLink = h(async (req, res) => {
  const url = await service.reissueSigningLink(ctxOf(req), String(req.params.id), String(req.params.rid));
  res.json({ url });
});
