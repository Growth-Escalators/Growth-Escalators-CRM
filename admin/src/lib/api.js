import {
  clearAuthSession,
  getAuthPermissions,
  getAuthToken,
  getAuthUser,
} from './auth.js';

export async function apiFetch(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${getAuthToken()}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearAuthSession();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Backends in this project use two error shapes:
    //   { error: "string" }                         (most routes)
    //   { error: { message: "string", ... } }       (Meta API proxies)
    // Surface the human-readable message in both cases so catch blocks
    // can show alert(err.message) without rendering "[object Object]".
    const raw = data?.error;
    const msg =
      typeof data?.message === 'string' ? data.message
      : typeof raw === 'string'      ? raw
      : raw && typeof raw === 'object' && typeof raw.message === 'string' ? raw.message
      : `Request failed (${res.status})`;
    const error = new Error(msg);
    if (typeof data?.detail === 'string') error.detail = data.detail;
    if (typeof data?.reasonCode === 'string') error.reasonCode = data.reasonCode;
    if (typeof data?.code === 'string') error.code = data.code;
    if (typeof data?.retryable === 'boolean') error.retryable = data.retryable;
    if (Number.isFinite(Number(data?.retryAfterSeconds))) error.retryAfterSeconds = Number(data.retryAfterSeconds);
    throw error;
  }

  return data;
}

export function getUser() {
  return getAuthUser();
}

export function getPermissions() {
  return getAuthPermissions();
}

export function logout() {
  clearAuthSession();
  window.location.href = '/login';
}
