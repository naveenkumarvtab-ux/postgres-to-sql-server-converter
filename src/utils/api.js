const isLocalDevelopment = () =>
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export function getApiUrl(path) {
  if (isLocalDevelopment()) return path;

  const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  // A production Render Web Service serves both the Vite app and Express API.
  // Relative URLs keep the browser on that same authenticated origin.
  if (!baseUrl && import.meta.env.PROD) return path;
  if (!baseUrl) {
    throw new Error('The application API is not configured. Set VITE_API_BASE_URL for this deployment.');
  }

  return `${baseUrl}${path}`;
}
