import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { todayLocal } from '../lib/timezone.js';
import LineItemsEditor, { computeLine } from '../components/LineItemsEditor.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import {
  checkLowStockForItems,
  notifyPaymentDueCustomer,
} from '../lib/notifications.js';
import { getFifoCosts } from '../lib/fifoCost.js';
import Loader from '../components/Loader.jsx';
import './userForm.css';
import useLocationScope from '../hooks/useLocationScope.js';
import QuickAddContactModal from '../components/QuickAddContactModal.jsx';

export default function SaleForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const editSaleId = searchParams.get('edit');
  const isEditMode = Boolean(editSaleId);

  const { business, profile } = useAuth();
  const { isScopedToLocation, scopedLocationIds } = useLocationScope();

  const [locations, setLocations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);

  const [locationId, setLocationId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [salesAgentId, setSalesAgentId] = useState('');
  const [saleDate, setSaleDate] = useState(
    todayLocal(business?.time_zone)
  );
  const [payTerm, setPayTerm] = useState('');
  const [items, setItems] = useState([]);
  const [discountType, setDiscountType] = useState('fixed');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [shippingCharges, setShippingCharges] = useState('0');
  const [paidAmount, setPaidAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [error, setError] = useState('');

  const [stockMap, setStockMap] = useState({});

  /*
   * This stores the original sale information when editing.
   * It is required so we can correctly reverse the old stock deduction
   * before applying the edited sale.
   */
  const [originalSale, setOriginalSale] = useState(null);
  const [originalItems, setOriginalItems] = useState([]);

  /*
   * LOAD FORM DATA
   */
  useEffect(() => {
    if (!business?.id) return;

    Promise.all([
      api.locations.getAll(),
      api.contacts.getAll({
        business_id: business.id,
        contact_type: 'customer',
      }),
      api.products.getAll({ business_id: business.id }),
      api.taxRates.getAll(),
    ]).then(([locRes, custRes, prodRes, taxRes]) => {
      let loadedLocations = Array.isArray(locRes?.data)
        ? locRes.data
        : (locRes?.data?.rows || []);
      if (isScopedToLocation) {
        loadedLocations = loadedLocations.filter((l) => scopedLocationIds.includes(l.id));
      }
      setLocations(loadedLocations);
      setCustomers(Array.isArray(custRes?.data) ? custRes.data : (custRes?.data?.rows || []));
      setAgents([]);
      setProducts(Array.isArray(prodRes?.data) ? prodRes.data : (prodRes?.data?.rows || []));
      setTaxRates(Array.isArray(taxRes?.data) ? taxRes.data : (taxRes?.data?.rows || []));

      if (loadedLocations.length > 0 && !isEditMode) {
        setLocationId((prev) => prev || String(loadedLocations[0].id));
      }
    });
  }, [business?.id, isEditMode]);

  /*
   * LOAD EXISTING SALE FOR EDITING
   */
  useEffect(() => {
    if (!business?.id || !editSaleId) return;

    const loadSale = async () => {
      setLoadingSale(true);
      setError('');

      try {
        const { data: sale, error: saleError } = await api.sales.getById(editSaleId);

        if (saleError) throw new Error(saleError);
        if (!sale) throw new Error('Sale not found.');

        if (
          sale.status === 'returned' ||
          sale.status === 'partially_returned'
        ) {
          throw new Error(
            'Returned or partially returned sales cannot be edited.'
          );
        }

        const saleItems = sale.items || [];

        setOriginalSale(sale);
        setOriginalItems(saleItems);

        setLocationId(String(sale.location_id || ''));
        setCustomerId(String(sale.customer_id || ''));
        setSalesAgentId(String(sale.sales_agent_id || ''));
        setSaleDate(
          sale.sale_date || todayLocal(business?.time_zone)
        );
        setPayTerm(sale.pay_term || '');
        setDiscountType(sale.discount_type || 'fixed');
        setDiscountAmount(String(sale.discount_amount || 0));
        setShippingCharges(String(sale.shipping_charges || 0));
        setPaidAmount(String(sale.paid_amount || 0));
        setPaymentMethod(sale.payment_method || '');

        setItems(
          saleItems.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            quantity: String(item.quantity),
            unit_price: String(item.unit_price),
            discount_type: item.discount_type || 'fixed',
            discount_amount: String(item.discount_amount || 0),
            tax_id: item.tax_id || '',
          }))
        );
      } catch (err) {
        setError(
          err.message || 'Could not load this sale for editing.'
        );
      } finally {
        setLoadingSale(false);
      }
    };

    loadSale();
  }, [business?.id, editSaleId]);

  /*
   * LOAD STOCK
   */
  useEffect(() => {
    const loadStock = async () => {
      if (!business?.id || !locationId) {
        setStockMap({});
        return;
      }

      const res = await api.purchases.getStockByLocation({
        business_id: business.id,
        location_id: locationId,
      });

      if (res?.error) {
        console.error('Could not load stock:', res.error);
        setStockMap({});
        return;
      }

      const rawData = res?.data;
      const stockTotals = {};

      if (Array.isArray(rawData)) {
        rawData.forEach((row) => {
          stockTotals[row.product_id] = Number(row.total_qty || 0);
        });
      } else if (rawData && typeof rawData === 'object') {
        Object.assign(stockTotals, rawData);
      }

      setStockMap(stockTotals);
    };

    loadStock();
  }, [business?.id, locationId]);

  const taxRatesById = useMemo(
    () => Object.fromEntries((Array.isArray(taxRates) ? taxRates : []).map((t) => [t.id, t])),
    [taxRates]
  );

  const productsById = useMemo(
    () => Object.fromEntries((Array.isArray(products) ? products : []).map((p) => [p.id, p])),
    [products]
  );

  /*
   * CALCULATE TOTALS
   */
  const totals = useMemo(() => {
    let subtotalPreOverall = 0;

    items.forEach((it) => {
      const qty = Number(it.quantity) || 0;
      const unitPrice = Number(it.unit_price) || 0;
      const lineSub = qty * unitPrice;

      let itemDisc = Number(it.discount_amount) || 0;
      if (it.discount_type === 'percentage') {
        itemDisc = (lineSub * itemDisc) / 100;
      }
      subtotalPreOverall += Math.max(lineSub - itemDisc, 0);
    });

    let overallDiscountAmt = Number(discountAmount) || 0;
    if (discountType === 'percentage') {
      overallDiscountAmt =
        (subtotalPreOverall * overallDiscountAmt) / 100;
    }

    const overallDiscountRatio =
      subtotalPreOverall > 0
        ? overallDiscountAmt / subtotalPreOverall
        : 0;

    let subtotal = 0;
    let taxAmount = 0;
    let lineTotal = 0;

    items.forEach((it) => {
      const c = computeLine(
        it,
        taxRatesById,
        productsById,
        overallDiscountRatio
      );

      subtotal += Math.max(c.subtotal - c.discount, 0);
      taxAmount += c.taxAmount;
      lineTotal += c.lineTotal;
    });

    const shipping = Number(shippingCharges) || 0;
    const grandTotal = Math.max(lineTotal, 0) + shipping;
    const due = Math.max(
      grandTotal - (Number(paidAmount) || 0),
      0
    );
    const paymentStatus = due > 0 ? 'due' : 'paid';

    return {
      subtotal,
      taxAmount,
      overallDiscount: overallDiscountAmt,
      overallDiscountRatio,
      shipping,
      grandTotal,
      due,
      paymentStatus,
    };
  }, [
    items,
    taxRatesById,
    productsById,
    discountType,
    discountAmount,
    shippingCharges,
    paidAmount,
  ]);

  /*
   * STOCK CHECK
   */
  const getAvailableStockForEdit = (productId) => {
    let available = Number(
      stockMap[productId] || 0
    );

    if (
      isEditMode &&
      originalSale?.status === 'confirmed' &&
      String(originalSale.location_id) === String(locationId)
    ) {
      const oldQuantity = originalItems
        .filter(
          (item) =>
            String(item.product_id) ===
            String(productId)
        )
        .reduce(
          (sum, item) =>
            sum + Number(item.quantity || 0),
          0
        );

      available += oldQuantity;
    }

    return available;
  };

  /*
   * SAVE / UPDATE SALE
   */
  const save = async (statusToSet) => {
    setError('');

    if (!locationId) {
      setError('Select a location.');
      return;
    }

    if (items.length === 0) {
      setError('Add at least one item.');
      return;
    }

    const invalidQuantity = items.some(
      (item) =>
        item.quantity === '' ||
        !/^\d+$/.test(
          String(item.quantity)
        ) ||
        Number(item.quantity) <= 0
    );

    if (invalidQuantity) {
      setError(
        'Every item quantity must be greater than 0.'
      );
      return;
    }

    /*
     * STOCK CHECK
     */
    const requestedByProduct = {};

    items.forEach((item) => {
      requestedByProduct[item.product_id] =
        (requestedByProduct[item.product_id] || 0) +
        Number(item.quantity);
    });

    for (const [
      productId,
      requestedQuantity,
    ] of Object.entries(
      requestedByProduct
    )) {
      const availableQuantity =
        getAvailableStockForEdit(productId);

      if (
        statusToSet === 'confirmed' &&
        requestedQuantity > availableQuantity
      ) {
        const product = products.find(
          (p) =>
            String(p.id) ===
            String(productId)
        );

        setError(
          `${product?.name || 'Product'} has only ${availableQuantity} available, but you requested ${requestedQuantity}.`
        );

        return;
      }
    }

    setSubmitting(true);

    try {
      // Pre-flight: compute FIFO costs before making database writes
      const fifoCosts = await getFifoCosts(business.id, items);

      const computedItems = items.map((it) => {
        const c = computeLine(
          it,
          taxRatesById,
          productsById,
          totals.overallDiscountRatio
        );

        return {
          product_id: it.product_id,
          variant_id: it.variant_id || null,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          unit_cost: fifoCosts[it.product_id] || 0,
          discount_type: it.discount_type || 'fixed',
          discount_amount: c.discount,
          tax_id: it.tax_id || null,
          line_total: c.lineTotal,
        };
      });

      const salePayload = {
        business_id: business.id,
        location_id: locationId,
        customer_id: customerId || null,
        sales_agent_id: salesAgentId || null,
        channel: 'manual',
        sale_date: saleDate,
        status: statusToSet,
        pay_term: payTerm || null,
        subtotal: totals.subtotal,
        discount_type: discountType,
        discount_amount: totals.overallDiscount,
        tax_amount: totals.taxAmount,
        shipping_charges: totals.shipping,
        grand_total: totals.grandTotal,
        payment_method: paymentMethod || null,
        paid_amount: Number(paidAmount) || 0,
        due_amount: totals.due,
        created_by: profile?.id || null,
        items: computedItems,
        fifoCosts,
      };

      let result;
      if (isEditMode) {
        result = await api.sales.update({
          id: editSaleId,
          ...salePayload,
          originalStatus: originalSale?.status,
          originalLocationId: originalSale?.location_id,
          originalItems,
        });
      } else {
        result = await api.sales.create(salePayload);
      }

      if (result?.error) throw new Error(result.error);
      const savedSaleId = result?.data?.id || editSaleId;

      /*
       * LOW STOCK + PAYMENT DUE NOTIFICATIONS
       */
      if (statusToSet === 'confirmed') {
        try {
          const productsByIdForNotification =
            Object.fromEntries(
              products.map((p) => [
                p.id,
                p,
              ])
            );

          const locationName =
            locations.find(
              (l) =>
                String(l.id) ===
                String(locationId)
            )?.name;

          await checkLowStockForItems({
            businessId: business.id,
            locationId,
            locationName,
            items: items.map((it) => ({
              product_id: it.product_id,
              quantity: it.quantity,
            })),
            productsById:
              productsByIdForNotification,
          });

          if (
            customerId &&
            totals.due > 0
          ) {
            const customerName =
              customers.find(
                (c) =>
                  String(c.id) ===
                  String(customerId)
              )?.name ||
              'the customer';

            await notifyPaymentDueCustomer({
              businessId: business.id,
              saleId: savedSaleId,
              customerName,
              dueAmount: totals.due,
              currency: business.currency,
            });
          }
        } catch {
          // Notifications are best-effort.
        }
      }

      navigate('/sales');
    } catch (err) {
      setError(
        err.message ||
        `Could not ${isEditMode
          ? 'update'
          : 'save'
        } this sale.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingSale) {
    return (
      <AppLayout>
        <Loader text="Loading sale..." />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="compact-page-header">
        <div>
          <h1>
            {isEditMode ? `Edit Sale #${editSaleId}` : 'New Sale'}
            {isEditMode && originalSale?.status && (
              <span
                className={`badge ${originalSale.status === 'confirmed'
                  ? 'badge-success'
                  : 'badge-warning'
                  }`}
                style={{ fontSize: 11, padding: '2px 8px', textTransform: 'capitalize' }}
              >
                {originalSale.status}
              </span>
            )}
          </h1>
          <p>
            {isEditMode
              ? 'Update the existing sale record, prices, quantities, and settlement parameters.'
              : 'Create a draft quotation or confirm sale to deduct stock and record transactions.'}
          </p>
        </div>

        <div className="compact-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/sales')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={submitting}
            onClick={() => save('draft')}
          >
            {isEditMode ? 'Update Draft' : 'Save Draft'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={submitting}
            onClick={() => save('confirmed')}
          >
            {isEditMode ? 'Update & Deduct Stock' : 'Confirm & Deduct Stock'}
          </button>
        </div>
      </div>

      <div className="form-shell">
        {/* SALE DETAILS PARAMETER BAR */}
        <div className="form-section-compact">
          <div className="form-section-header">
            <span className="form-section-title">Sale Parameters & Customer</span>
            <span className="form-section-subtitle">* Required</span>
          </div>

          <div className="form-grid-5">
            {/* Location selector hidden per single-location setup */}

            <div className="compact-field">
              <label className="compact-label">Customer</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select
                  className="compact-select"
                  style={{ flex: 1 }}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Walk-in Customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Add new customer"
                  onClick={() => setShowAddCustomer(true)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    border: '1.5px solid var(--navy-border, #cbd5e1)',
                    background: '#fff',
                    color: 'var(--navy-800, #1e293b)',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    lineHeight: '1',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* <div className="compact-field">
              <label className="compact-label">Sales Agent</label>
              <select
                className="compact-select"
                value={salesAgentId}
                onChange={(e) => setSalesAgentId(e.target.value)}
              >
                <option value="">None </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.first_name} {a.last_name || ''}
                  </option>
                ))}
              </select>
            </div> */}

            <div className="compact-field">
              <label className="compact-label">Sale Date</label>
              <input
                type="date"
                className="compact-input"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>

            {/* <div className="compact-field">
              <label className="compact-label">Pay Term</label>
              <input
                className="compact-input"
                value={payTerm}
                onChange={(e) => setPayTerm(e.target.value)}
                placeholder="e.g. Due on receipt"
              />
            </div> */}
          </div>
        </div>

        {/* LINE ITEMS SECTION */}
        <div className="form-section-compact">
          <div className="form-section-header">
            <span className="form-section-title">Line Items & Products</span>
            <span className="badge badge-info" style={{ fontSize: 11, padding: '2px 8px' }}>
              {items.length} {items.length === 1 ? 'Item' : 'Items'}
            </span>
          </div>

          <LineItemsEditor
            items={items}
            onChange={setItems}
            products={products}
            taxRates={taxRates}
            priceField="default_selling_price"
            stockMap={stockMap}
            mode="sale"
          />
        </div>

        {/* SETTLEMENT & ACCOUNTING LEDGER PANEL */}
        <div className="form-section-compact">
          <div className="form-section-header">
            <span className="form-section-title">Payments </span>
            <span className="form-section-subtitle">
              Discounts, shipping & payment allocation
            </span>
          </div>

          <div className="form-layout-2col">
            {/* Payment & Adjustment Inputs */}
            <div>
              <div className="form-grid-3">
                <div className="compact-field">
                  <label className="compact-label">Overall Discount Type</label>
                  <select
                    className="compact-select"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value)}
                  >
                    <option value="fixed">Fixed ({business?.currency || 'PKR'})</option>
                    <option value="percentage">Percentage (%)</option>
                  </select>
                </div>

                <div className="compact-field">
                  <label className="compact-label">Discount Value</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="compact-input"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">Shipping Charges</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="compact-input "
                    value={shippingCharges}
                    onChange={(e) => setShippingCharges(e.target.value)}
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">Paid Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="compact-input"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">Payment Method</label>
                  <input
                    className="compact-input"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    placeholder="Cash, Card, Transfer…"
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">Payment Status</label>
                  <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                    <span
                      className={`badge ${totals.due > 0 ? 'badge-warning' : 'badge-success'
                        }`}
                      style={{ fontSize: 11, padding: '3px 10px', textTransform: 'capitalize' }}
                    >
                      {totals.due > 0 ? `Due: ${business?.currency} ${totals.due.toFixed(2)}` : 'Fully Paid'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Financial Ledger Summary Box */}
            <div className="financial-ledger-box">
              <div className="financial-ledger-row">
                <span>Subtotal (Items)</span>
                <span className="financial-ledger-val">
                  {business?.currency} {totals.subtotal.toFixed(2)}
                </span>
              </div>

              {totals.overallDiscount > 0 && (
                <div className="financial-ledger-row">
                  <span>Overall Discount</span>
                  <span className="financial-ledger-val" style={{ color: 'var(--danger)' }}>
                    - {business?.currency} {totals.overallDiscount.toFixed(2)}
                  </span>
                </div>
              )}

              {totals.taxAmount > 0 && (
                <div className="financial-ledger-row">
                  <span>Tax Amount</span>
                  <span className="financial-ledger-val">
                    + {business?.currency} {totals.taxAmount.toFixed(2)}
                  </span>
                </div>
              )}

              {totals.shipping > 0 && (
                <div className="financial-ledger-row">
                  <span>Shipping Charges</span>
                  <span className="financial-ledger-val">
                    + {business?.currency} {totals.shipping.toFixed(2)}
                  </span>
                </div>
              )}

              <div className="financial-ledger-row">
                <span>Paid Amount</span>
                <span className="financial-ledger-val" style={{ color: '#10633e' }}>
                  {business?.currency} {Number(paidAmount || 0).toFixed(2)}
                </span>
              </div>

              <div className="financial-ledger-row">
                <span style={{ fontWeight: 600 }}>Due Balance</span>
                <span
                  className="financial-ledger-val"
                  style={{
                    color: totals.due > 0 ? 'var(--danger)' : 'var(--text-secondary)',
                    fontWeight: 700,
                  }}
                >
                  {business?.currency} {totals.due.toFixed(2)}
                </span>
              </div>

              <div className="financial-ledger-row grand-row">
                <span>Grand Total</span>
                <span style={{ color: 'var(--navy-900)' }}>
                  {business?.currency} {totals.grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div
            className="error-text"
            style={{
              padding: '8px 12px',
              background: 'var(--danger-bg)',
              borderRadius: 4,
              border: '1px solid #f5c2c2',
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {/* BOTTOM ACTION BAR */}
        <div className="compact-summary-bar">
          <div className="compact-stat-group">
            <div className="compact-stat-item">
              <span className="stat-label">Total Items:</span>
              <span className="stat-val">{items.length}</span>
            </div>

            <div className="compact-stat-item">
              <span className="stat-label">Grand Total:</span>
              <span className="stat-val stat-val-highlight">
                {business?.currency} {totals.grandTotal.toFixed(2)}
              </span>
            </div>

            <div className="compact-stat-item">
              <span className="stat-label">Due:</span>
              <span
                className="stat-val"
                style={{ color: totals.due > 0 ? 'var(--danger)' : 'var(--success)' }}
              >
                {business?.currency} {totals.due.toFixed(2)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/sales')}
            >
              Cancel
            </button>

            {/* <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={submitting}
              onClick={() => save('draft')}
            >
              {isEditMode ? 'Update Draft' : 'Save as Draft'}
            </button> */}

            {/* <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={submitting}
              onClick={() => save('quotation')}
            >
              {isEditMode ? 'Update Quotation' : 'Save as Quotation'}
            </button> */}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={submitting}
              onClick={() => save('confirmed')}
            >
              {isEditMode ? 'Update & Deduct Stock' : 'Confirm & Deduct Stock'}
            </button>
          </div>
        </div>
      </div>

      <QuickAddContactModal
        isOpen={showAddCustomer}
        onClose={() => setShowAddCustomer(false)}
        contactType="customer"
        businessId={business?.id}
        onContactAdded={(newCustomer) => {
          setCustomers((prev) => [...prev, newCustomer]);
          setCustomerId(String(newCustomer.id));
        }}
      />
    </AppLayout>
  );
}
