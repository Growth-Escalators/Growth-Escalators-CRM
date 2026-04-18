/**
 * postizService.ts
 * Wraps the Postiz REST API for social media post scheduling,
 * workspace management, and scheduled post retrieval.
 *
 * Postiz instance: https://postiz-production-c081.up.railway.app
 * Env vars required:
 *   POSTIZ_BASE_URL — base URL of the Postiz instance
 *   POSTIZ_API_KEY  — API key generated after first login
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import logger from '../utils/logger';
import { requiredEnv } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SocialChannel = 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'TWITTER' | 'TIKTOK' | 'YOUTUBE';

export interface SchedulePostOptions {
  /** Postiz integration/channel ID (the connected social account) */
  integrationId: string;
  /** Post content */
  content: string;
  /** ISO 8601 datetime to publish */
  publishAt: string;
  /** Optional media file URLs */
  media?: string[];
  /** Short description of the post type for logging */
  type?: string;
}

export interface ScheduledPost {
  id: string;
  content: string;
  publishAt: string;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'ERROR';
  integration?: { id: string; name: string; type: SocialChannel };
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function postizRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let POSTIZ_BASE_URL: string;
    let POSTIZ_API_KEY: string;
    try {
      POSTIZ_BASE_URL = requiredEnv('POSTIZ_BASE_URL');
      POSTIZ_API_KEY = requiredEnv('POSTIZ_API_KEY');
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const parsed = new URL(POSTIZ_BASE_URL + path);
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;

    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${POSTIZ_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(opts, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Postiz API error ${res.statusCode}: ${parsed?.message ?? raw.slice(0, 200)}`));
          } else {
            resolve(parsed as T);
          }
        } catch {
          reject(new Error(`Postiz non-JSON response (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule a social media post.
 * The `integrationId` must match a connected social account in Postiz.
 */
export async function schedulePost(opts: SchedulePostOptions): Promise<ScheduledPost> {
  const payload: Record<string, unknown> = {
    integration: { id: opts.integrationId },
    content: [{ content: opts.content }],
    date: opts.publishAt,
    ...(opts.media?.length ? { media: opts.media.map(url => ({ url })) } : {}),
  };

  logger.info(
    { integrationId: opts.integrationId, publishAt: opts.publishAt, type: opts.type },
    '[postiz] scheduling post',
  );

  const result = await postizRequest<ScheduledPost>('POST', '/posts', payload);

  logger.info({ postId: result.id, status: result.status }, '[postiz] post scheduled');
  return result;
}

/**
 * Get all scheduled (and recently published) posts, optionally filtered by status.
 */
export async function getScheduledPosts(status?: ScheduledPost['status']): Promise<ScheduledPost[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const result = await postizRequest<{ posts: ScheduledPost[] }>('GET', `/api/posts${qs}`);
  return result.posts ?? [];
}

/**
 * Create a new Postiz workspace (organisation) for a client.
 * Each client (AGeD, Aaroha Om, Black Panda) should have their own workspace
 * so social accounts are isolated and reporting is per-client.
 */
export async function createClientWorkspace(
  name: string,
  description?: string,
): Promise<Workspace> {
  logger.info({ name }, '[postiz] creating workspace');

  const result = await postizRequest<Workspace>('POST', '/organizations', {
    name,
    ...(description ? { description } : {}),
  });

  logger.info({ workspaceId: result.id, name: result.name }, '[postiz] workspace created');
  return result;
}

/**
 * List all workspaces the API key has access to.
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const result = await postizRequest<{ organizations: Workspace[] }>('GET', '/organizations');
  return result.organizations ?? [];
}

/**
 * Get connected social integrations for a workspace.
 */
export async function getIntegrations(workspaceId: string): Promise<Array<{ id: string; name: string; type: SocialChannel }>> {
  const result = await postizRequest<{ integrations: Array<{ id: string; name: string; type: SocialChannel }> }>(
    'GET',
    `/integrations?organizationId=${encodeURIComponent(workspaceId)}`,
  );
  return result.integrations ?? [];
}
