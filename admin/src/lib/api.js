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
    window.location.href = '/login';
    return null;
  }

  return res.json();
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('ge_crm_user') || 'null');
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem('ge_crm_token');
  localStorage.removeItem('ge_crm_user');
  window.location.href = '/login';
}
