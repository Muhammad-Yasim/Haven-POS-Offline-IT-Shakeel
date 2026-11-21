import { api } from './electronAPI.js';

// Fetch only the latest 10 notifications
export async function getLatestNotifications(businessId) {
  const { data, error } = await api.notifications.getAll();

  if (error) {
    console.error('Failed to fetch notifications:', error);
    return [];
  }

  return (data || []).slice(0, 10);
}

// Creates a notification, but skips it if an UNREAD notification with the
// same type + reference already exists — so repeated sales against an
// already-low product don't spam a new row every time. Once the existing
// one is marked read, the next crossing raises a fresh alert.
export async function notifyOnce({ businessId, type, message, referenceType, referenceId }) {
  const { data: notifications } = await api.notifications.getAll();
  const existing = (notifications || []).find((n) =>
    !n.is_read &&
    n.type === type &&
    (referenceType ? n.related_reference_type === referenceType : true) &&
    (referenceId != null ? Number(n.related_reference_id) === Number(referenceId) : true)
  );

  if (existing) return;

  await api.notifications.create({
    business_id: businessId,
    type,
    message,
    related_reference_type: referenceType || null,
    related_reference_id: referenceId != null ? Number(referenceId) : null,
  });
}

// Sums stock_ledger for one product+location — the live "current stock"
// figure, computed the same way everywhere else in the app.
export async function getOnHandQty(businessId, productId, locationId) {
  const { data } = await api.stock.getLedger({
    productId: productId,
    locationId: locationId,
    limit: 1000,
  });

  return (data || []).reduce((sum, row) => sum + Number(row.change_qty), 0);
}

// Call this AFTER a stock_ledger write for a set of items that could have
// pushed stock down (a sale, a purchase return, a manual adjustment).
// `items`: [{ product_id, quantity }]. `productsById` needs at least
// { name, alert_quantity } per product.
export async function checkLowStockForItems({
  businessId,
  locationId,
  locationName,
  items,
  productsById,
}) {
  for (const it of items) {
    const product = productsById[it.product_id];

    if (!product || product.alert_quantity == null) continue;

    const qty = await getOnHandQty(
      businessId,
      it.product_id,
      locationId
    );

    if (qty > Number(product.alert_quantity)) continue;

    await notifyOnce({
      businessId,
      type: 'low_stock',
      message: `${product.name} is low${
        locationName ? ` at ${locationName}` : ''
      } — ${qty} left (alert at ${product.alert_quantity}).`,
      referenceType: 'product',
      referenceId: it.product_id,
    });
  }
}

// One-off variant for places that already know the resulting quantity
// (e.g. a manual stock adjustment already computes its target qty).
export async function checkLowStockDirect({
  businessId,
  productId,
  productName,
  locationName,
  newQty,
  alertQuantity,
}) {
  if (alertQuantity == null || newQty > Number(alertQuantity)) return;

  await notifyOnce({
    businessId,
    type: 'low_stock',
    message: `${productName} is low${
      locationName ? ` at ${locationName}` : ''
    } — ${newQty} left (alert at ${alertQuantity}).`,
    referenceType: 'product',
    referenceId: productId,
  });
}

export async function notifyPaymentDueCustomer({
  businessId,
  saleId,
  customerName,
  dueAmount,
  currency,
}) {
  if (dueAmount <= 0) return;

  await notifyOnce({
    businessId,
    type: 'payment_due_customer',
    message: `Sale #${saleId} has ${currency} ${dueAmount.toFixed(
      2
    )} due from ${customerName}.`,
    referenceType: 'sale',
    referenceId: saleId,
  });
}

export async function notifyPaymentDueSupplier({
  businessId,
  purchaseId,
  supplierName,
  owedAmount,
  currency,
}) {
  if (owedAmount <= 0) return;

  await notifyOnce({
    businessId,
    type: 'payment_due_supplier',
    message: `Purchase #${purchaseId} has ${currency} ${owedAmount.toFixed(
      2
    )} due to ${supplierName}.`,
    referenceType: 'purchase',
    referenceId: purchaseId,
  });
}
