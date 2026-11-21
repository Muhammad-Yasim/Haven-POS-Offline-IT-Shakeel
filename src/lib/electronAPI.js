/**
 * src/lib/electronAPI.js
 *
 * Thin shim that exposes window.electronAPI to the rest of the React app.
 *
 * All React pages and components import from here — never from window directly.
 * This makes it easy to mock during unit tests and keeps the coupling point
 * in one file.
 *
 * Usage:
 *   import { api } from '../lib/electronAPI';
 *   const { data, error } = await api.auth.signIn({ username, password });
 *
 * Every api method returns Promise<{ data: T | null, error: string | null }>.
 * On success:  { data: <result>, error: null }
 * On failure:  { data: null,     error: '<message>' }
 */

if (!window.electronAPI) {
  // This should never happen in production (preload always runs first).
  // During browser-based development it will, so provide a clear error.
  console.error(
    '[electronAPI] window.electronAPI is not defined. ' +
    'Make sure the app is running inside Electron with the preload script loaded.'
  );
}

export const api = window.electronAPI;
