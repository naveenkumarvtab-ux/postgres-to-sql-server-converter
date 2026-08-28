const isLocalDevelopment = () =>
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export function getApiUrl(path) {
  if (isLocalDevelopment()) return path;

  const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('The application API is not configured. Set VITE_API_BASE_URL for this deployment.');
  }

  return `${baseUrl}${path}`;
}
