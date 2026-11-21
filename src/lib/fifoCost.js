import { api } from './electronAPI.js';

/**
 * Resolves the FIFO (First-In, First-Out) cost for a set of products
 * being sold using the local SQLite database via IPC.
 *
 * @param {string|number} businessId
 * @param {Array<{product_id: number|string, quantity: number}>} items
 * @returns {Promise<Record<string|number, number>>}
 *   A map of product_id → unit cost (weighted average FIFO cost).
 */
export async function getFifoCosts(businessId, items) {
  if (!items || items.length === 0) return {};
  try {
    const res = await api.sales.getFifoCosts({ businessId, items });
    if (res?.error) {
      console.error('FIFO cost resolution error:', res.error);
      return {};
    }
    return res?.data || {};
  } catch (err) {
    console.error('Failed to get FIFO costs via IPC:', err);
    return {};
  }
}
