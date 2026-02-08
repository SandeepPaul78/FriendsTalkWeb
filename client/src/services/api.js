const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const AUTH_STORAGE_KEY = "friendstalk_auth";

export const getStoredAuth = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const storeAuth = ({ token, user }) => {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user }));
};

export const clearStoredAuth = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const apiRequest = async (path, { method = "GET", token, body } = {}) => {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || data?.message || "Request failed";
    throw new Error(message);
  }

  return data;
};

export const uploadRequest = async (path, { token, file, fields } = {}) => {
  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  }
  if (fields) {
    Object.entries(fields).forEach(([key, value]) => {
      formData.append(key, value);
    });
  }

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || data?.message || "Upload failed";
    throw new Error(message);
  }

  return data;
};
