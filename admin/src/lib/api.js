const token = () => localStorage.getItem('ge_crm_token');

export async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('ge_crm_token');
    localStorage.removeItem('ge_crm_user');
    localStorage.removeItem('ge_crm_permissions');
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
      typeof raw === 'string'      ? raw
      : raw && typeof raw === 'object' && typeof raw.message === 'string' ? raw.message
      : `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('ge_crm_user') || 'null');
  } catch {
    return null;
  }
}

export function getPermissions() {
  try {
    return JSON.parse(localStorage.getItem('ge_crm_permissions') || '{}');
  } catch {
    return {};
  }
}

export function logout() {
  localStorage.removeItem('ge_crm_token');
  localStorage.removeItem('ge_crm_user');
  localStorage.removeItem('ge_crm_permissions');
  window.location.href = '/login';
}
