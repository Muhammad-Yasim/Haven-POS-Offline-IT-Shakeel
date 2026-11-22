import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import LineItemsEditor, { computeLine } from '../components/LineItemsEditor.jsx';
import { todayLocal } from '../lib/timezone.js';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { notifyPaymentDueSupplier } from '../lib/notifications.js';
import Loader from '../components/Loader.jsx';
import useLocationScope from '../hooks/useLocationScope.js';
import QuickAddContactModal from '../components/QuickAddContactModal.jsx';
import './userForm.css';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export default function PurchaseForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const purchaseId = searchParams.get('id');
  const isEditMode = Boolean(purchaseId);

  const { business, profile } = useAuth();
  const { isScopedToLocation, scopedLocationIds } = useLocationScope();

  const [locations, setLocations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);

  const [locationId, setLocationId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(
    todayLocal(business?.time_zone)
  );

  const [payTerm, setPayTerm] = useState('');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const [items, setItems] = useState([]);

  const [discountType, setDiscountType] = useState('fixed');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [shippingCharges, setShippingCharges] = useState('0');

  const [advancePayment, setAdvancePayment] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('');

  const [stockMap, setStockMap] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [loadingForm, setLoadingForm] = useState(true);
  const [error, setError] = useState('');

  const [originalPurchase, setOriginalPurchase] = useState(null);
  const [originalItems, setOriginalItems] = useState([]);

  /*
   * Load purchase-related data.
   * In edit mode, preload the existing purchase and items.
   */
  useEffect(() => {
    if (!business?.id) return;

    const loadData = async () => {
      setLoadingForm(true);
      setError('');

      try {
        const [
          locationsRes,
          suppliersRes,
          productsRes,
          taxRatesRes,
        ] = await Promise.all([
          api.locations.getAll(),
          api.contacts.getAll({
            business_id: business.id,
            contact_type: 'supplier',
          }),
          api.products.getAll(),
          api.taxRates.getAll(),
        ]);

        if (locationsRes.error) console.error('Locations error:', locationsRes.error);
        if (suppliersRes.error) console.error('Suppliers error:', suppliersRes.error);
        if (productsRes.error) console.error('Products error:', productsRes.error);
        if (taxRatesRes.error) console.error('Tax rates error:', taxRatesRes.error);

        let loadedLocations = Array.isArray(locationsRes.data)
          ? locationsRes.data
          : (locationsRes.data?.rows || []);
        if (isScopedToLocation) {
          loadedLocations = loadedLocations.filter((l) => scopedLocationIds.includes(l.id));
        }
        const loadedSuppliers = Array.isArray(suppliersRes.data)
          ? suppliersRes.data
          : (suppliersRes.data?.rows || []);
        const loadedProducts = Array.isArray(productsRes.data)
          ? productsRes.data
          : (productsRes.data?.rows || []);
        const loadedTaxRates = Array.isArray(taxRatesRes.data)
          ? taxRatesRes.data
          : (taxRatesRes.data?.rows || []);

        setLocations(loadedLocations);
        setSuppliers(loadedSuppliers);
        setProducts(loadedProducts);
        setTaxRates(loadedTaxRates);

        if (!isEditMode && loadedLocations.length > 0) {
          setLocationId((prev) => prev || String(loadedLocations[0].id));
        }

        if (isEditMode) {
          const { data: purchase, error: purchaseErr } = await api.purchases.getById(Number(purchaseId));

          if (purchaseErr) throw new Error(purchaseErr);
          if (!purchase) throw new Error('Purchase not found.');

          const purchaseItems = purchase.items || [];

          setOriginalPurchase(purchase);
          setOriginalItems(purchaseItems || []);

          setLocationId(String(purchase.location_id || ''));
          setSupplierId(String(purchase.supplier_id || ''));
          setPurchaseDate(purchase.purchase_date || todayLocal(business?.time_zone));
          setPayTerm(purchase.pay_term || '');
          setSupplierInvoice(purchase.supplier_invoice_number || '');
          setDiscountType(purchase.discount_type || 'fixed');
          setDiscountAmount(String(purchase.discount_amount || 0));
          setShippingCharges(String(purchase.shipping_charges || 0));
          setAdvancePayment(String(purchase.advance_payment || 0));
          setPaymentMethod(purchase.payment_method || '');
          setPaymentNote(purchase.payment_note || '');

          setItems(
            (purchaseItems || []).map((item) => ({
              id: item.id,
              product_id: item.product_id,
              variant_id: item.variant_id || null,
              quantity: String(item.quantity),
              unit_price: String(item.unit_cost),
              discount_type: item.discount_type || 'fixed',
              discount_amount: String(item.discount_amount || 0),
              tax_id: item.tax_id || '',
              selling_price: '',
            }))
          );
        }
      } catch (err) {
        setError(err.message || 'Could not load purchase data.');
      } finally {
        setLoadingForm(false);
      }
    };

    loadData();
  }, [business?.id, isEditMode, purchaseId]);

  /*
   * Fetch stock ledger quantities for current location
   */
  useEffect(() => {
    const loadStock = async () => {
      if (!business?.id || !locationId) {
        setStockMap({});
        return;
      }

      const { data, error: stockErr } = await api.purchases.getStockByLocation({
        business_id: business.id,
        location_id: Number(locationId),
      });

      if (stockErr) {
        console.error('Could not load stock:', stockErr);
        setStockMap({});
        return;
      }

      const rawData = data;
      const map = {};
      if (Array.isArray(rawData)) {
        rawData.forEach((row) => {
          map[row.product_id] = Number(row.total_qty || 0);
        });
      } else if (rawData && typeof rawData === 'object') {
        Object.assign(map, rawData);
      }

      setStockMap(map);
    };

    loadStock();
  }, [business?.id, locationId]);

  const taxRatesById = useMemo(
    () => Object.fromEntries((Array.isArray(taxRates) ? taxRates : []).map((tax) => [tax.id, tax])),
    [taxRates]
  );

  const productsById = useMemo(
    () => Object.fromEntries((Array.isArray(products) ? products : []).map((product) => [product.id, product])),
    [products]
  );

  /*
   * Calculate totals for multiple purchase items
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

    items.forEach((item) => {
      const calculated = computeLine(
        item,
        taxRatesById,
        productsById,
        overallDiscountRatio
      );
      subtotal += Math.max(calculated.subtotal - calculated.discount, 0);
      taxAmount += calculated.taxAmount;
      lineTotal += calculated.lineTotal;
    });

    const shipping = Number(shippingCharges) || 0;
    const grandTotal = Math.max(lineTotal, 0) + shipping;

    return {
      subtotal,
      taxAmount,
      overallDiscount: overallDiscountAmt,
      overallDiscountRatio,
      shipping,
      grandTotal,
    };
  }, [items, taxRatesById, productsById, discountType, discountAmount, shippingCharges]);

  const supplierDue = Math.max(
    totals.grandTotal - (Number(advancePayment) || 0),
    0
  );

  const getEffectiveStockMap = (purchaseStatus, purchaseLocationId, purchaseItemRows) => {
    const map = new Map();
    if (purchaseStatus !== 'received') return map;

    for (const item of purchaseItemRows || []) {
      const key = `${Number(item.product_id)}|${item.variant_id ? Number(item.variant_id) : ''}|${Number(purchaseLocationId)}`;
      const qty = Number(item.quantity || 0);
      map.set(key, (map.get(key) || 0) + qty);
    }

    return map;
  };

  /*
   * Save purchase
   */
  const save = async (statusToSet) => {
    setError('');

    const activeLocId = locationId || (locations[0] ? String(locations[0].id) : '1');

    if (items.length === 0) {
      setError('Add at least one item.');
      return;
    }

    const invalidQuantity = items.some((item) => {
      const quantity = Number(item.quantity);
      return (
        item.quantity === '' ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      );
    });

    if (invalidQuantity) {
      setError('Every item quantity must be greater than 0.');
      return;
    }

    const invalidProduct = items.some((item) => !item.product_id);
    if (invalidProduct) {
      setError('Every purchase item must have a product.');
      return;
    }

    setSubmitting(true);

    try {
      const purchasePayload = {
        business_id: business.id,
        location_id: Number(activeLocId),
        supplier_id: supplierId ? Number(supplierId) : null,

        purchase_date: purchaseDate,
        purchase_status: statusToSet,

        pay_term: payTerm || null,
        supplier_invoice_number: supplierInvoice || null,

        subtotal: totals.subtotal,
        discount_type: discountType,
        discount_amount: totals.overallDiscount,
        tax_amount: totals.taxAmount,
        shipping_charges: totals.shipping,
        grand_total: totals.grandTotal,

        advance_payment: Number(advancePayment) || 0,
        payment_method: paymentMethod || null,
        payment_note: paymentNote || null,
        paid_on: Number(advancePayment) > 0 ? purchaseDate : null,

        created_by: profile?.id || null,
      };

      const itemRows = items.map((item) => {
        const calculated = computeLine(
          item,
          taxRatesById,
          productsById,
          totals.overallDiscountRatio
        );

        return {
          product_id: Number(item.product_id),
          variant_id: item.variant_id ? Number(item.variant_id) : null,
          quantity: Number(item.quantity),
          unit_cost: Number(item.unit_price) || 0,
          discount_type: item.discount_type || 'fixed',
          discount_amount: calculated.discount,
          tax_id: item.tax_id ? Number(item.tax_id) : null,
          line_total: calculated.lineTotal,
          selling_price: item.selling_price || null,
        };
      });

      const sellingPriceUpdates = statusToSet === 'received'
        ? items
          .filter((item) => item.product_id && Number(item.selling_price) > 0)
          .map((item) => ({
            product_id: Number(item.product_id),
            selling_price: Number(item.selling_price),
          }))
        : [];

      const originalStatus = originalPurchase?.purchase_status || 'draft';
      const originalLocationId = originalPurchase?.location_id ?? null;
      const originalSupplierId = originalPurchase?.supplier_id ?? null;
      const originalAdvancePayment = Number(originalPurchase?.advance_payment || 0);
      const originalGrandTotal = Number(originalPurchase?.grand_total || 0);
      const originalDue = round2(originalGrandTotal - originalAdvancePayment);

      const newGrandTotal = round2(totals.grandTotal);
      const newAdvancePayment = Number(advancePayment) || 0;
      const newDue = round2(newGrandTotal - newAdvancePayment);

      const oldEffectiveMap = isEditMode
        ? getEffectiveStockMap(originalStatus, originalLocationId, originalItems)
        : new Map();

      const newEffectiveMap = getEffectiveStockMap(
        statusToSet,
        Number(locationId),
        items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id ? Number(item.variant_id) : null,
          quantity: Number(item.quantity),
        }))
      );

      const deltaKeys = new Set([...oldEffectiveMap.keys(), ...newEffectiveMap.keys()]);
      const stockRows = [];

      for (const key of deltaKeys) {
        const [productIdStr, variantIdStr, locationIdStr] = key.split('|');

        const oldQty = Number(oldEffectiveMap.get(key) || 0);
        const newQty = Number(newEffectiveMap.get(key) || 0);
        const delta = newQty - oldQty;

        if (delta !== 0) {
          stockRows.push({
            business_id: business.id,
            product_id: Number(productIdStr),
            variant_id: variantIdStr ? Number(variantIdStr) : null,
            location_id: Number(locationIdStr),
            change_qty: delta,
            reason: isEditMode ? 'purchase_edit' : 'purchase',
            reference_type: isEditMode ? 'purchase_edit' : 'purchase',
            created_by: profile?.id || null,
          });
        }
      }

      const hadSupplierLedger = originalStatus === 'received' && !!originalSupplierId;
      const willHaveSupplierLedger = statusToSet === 'received' && !!supplierId;
      const ledgerOps = [];

      if (isEditMode && hadSupplierLedger) {
        ledgerOps.push({
          business_id: business.id,
          contact_id: Number(originalSupplierId),
          reference_type: 'purchase_edit',
          amount: -originalDue,
        });
      }

      if (willHaveSupplierLedger) {
        ledgerOps.push({
          business_id: business.id,
          contact_id: Number(supplierId),
          reference_type: isEditMode ? 'purchase_edit' : 'purchase',
          amount: newDue,
        });
      }

      let savedPurchaseId = purchaseId;

      if (isEditMode) {
        const { data: updateRes, error: updateErr } = await api.purchases.update({
          id: Number(purchaseId),
          ...purchasePayload,
          items: itemRows,
          stockRows,
          ledgerOps,
          sellingPriceUpdates,
        });

        if (updateErr) throw new Error(updateErr);
        savedPurchaseId = updateRes?.id || purchaseId;
      } else {
        const { data: createRes, error: createErr } = await api.purchases.create({
          ...purchasePayload,
          items: itemRows,
        });

        if (createErr) throw new Error(createErr);
        savedPurchaseId = createRes?.id;
      }

      if (statusToSet === 'received' && supplierId) {
        const shouldNotify =
          !isEditMode ||
          originalStatus !== 'received' ||
          String(originalSupplierId || '') !== String(supplierId || '');

        if (shouldNotify) {
          try {
            await notifyPaymentDueSupplier({
              businessId: business.id,
              purchaseId: savedPurchaseId,
              supplierName:
                suppliers.find(
                  (supplier) => Number(supplier.id) === Number(supplierId)
                )?.name || 'the supplier',
              owedAmount: newDue,
              currency: business.currency,
            });
          } catch {
            // Notification failure must not block purchase save.
          }
        }
      }

      navigate('/purchases');
    } catch (err) {
      setError(err.message || 'Could not save this purchase.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="compact-page-header">
        <div>
          <h1>
            {isEditMode ? `Edit Purchase #${purchaseId}` : 'New Purchase'}
            {isEditMode && originalPurchase?.purchase_status && (
              <span
                className={`badge ${originalPurchase.purchase_status === 'received'
                  ? 'badge-success'
                  : 'badge-warning'
                  }`}
                style={{ fontSize: 11, padding: '2px 8px', textTransform: 'capitalize' }}
              >
                {originalPurchase.purchase_status}
              </span>
            )}
          </h1>
          {/* <p>
            {isEditMode
              ? 'Update purchase details, inbound costs, and supplier payments.'
              : 'Save as a draft or mark as received to add incoming inventory to stock.'}
          </p> */}
        </div>

        <div className="compact-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/purchases')}
          >
            Cancel
          </button>
          {/* <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={submitting || loadingForm}
            onClick={() => save('draft')}
          >
            {isEditMode ? 'Update Draft' : 'Save as Draft'}
          </button> */}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={submitting || loadingForm}
            onClick={() => save('received')}
          >
            {isEditMode ? 'Update & Receive Stock' : 'Save & Receive Stock'}
          </button>
        </div>
      </div>

      <div className="form-shell">
        {loadingForm ? (
          <div className="form-section-compact" style={{ padding: 24 }}>
            <Loader text="Loading purchase data…" />
          </div>
        ) : (
          <>
            {/* PURCHASE PARAMETERS & SUPPLIER BAR */}
            <div className="form-section-compact">
              <div className="form-section-header">
                <span className="form-section-title">Purchase Details & Supplier</span>
                <span className="form-section-subtitle">* Required</span>
              </div>

              <div className="form-grid-5">
                {/* Location — hidden for single location */}
                {/* <div className="compact-field">
                  <label className="compact-label">
                    Location <span className="req">*</span>
                  </label>
                  <select
                    className="compact-select"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">Select location…</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div> */}

                <div className="compact-field">
                  <label className="compact-label">Supplier</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <select
                      className="compact-select"
                      style={{ flex: 1 }}
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                    >
                      <option value="">Cash / Unspecified</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      title="Add new supplier"
                      onClick={() => setShowAddSupplier(true)}
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

                <div className="compact-field">
                  <label className="compact-label">Purchase Date</label>
                  <input
                    type="date"
                    className="compact-input"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">Supplier Invoice #</label>
                  <input
                    className="compact-input"
                    value={supplierInvoice}
                    onChange={(e) => setSupplierInvoice(e.target.value)}
                    placeholder="Bill / Invoice #"
                  />
                </div>

                {/* Pay Term — hidden */}
                {/* <div className="compact-field">
                  <label className="compact-label">Pay Term</label>
                  <input
                    className="compact-input"
                    value={payTerm}
                    onChange={(e) => setPayTerm(e.target.value)}
                    placeholder="e.g. Net 30"
                  />
                </div> */}
              </div>
            </div>

            {/* PURCHASE LINE ITEMS */}
            <div className="form-section-compact">
              <div className="form-section-header">
                <span className="form-section-title">Purchase Line Items & Stock Inward</span>
                <span className="badge badge-info" style={{ fontSize: 11, padding: '2px 8px' }}>
                  {items.length} {items.length === 1 ? 'Item' : 'Items'}
                </span>
              </div>

              <LineItemsEditor
                items={items}
                onChange={setItems}
                products={products}
                taxRates={taxRates}
                priceField="cost_price"
                stockMap={stockMap}
                mode="purchase"
              />
            </div>

            {/* SETTLEMENT & INVOICING ACCOUNTING LEDGER */}
            <div className="form-section-compact">
              <div className="form-section-header">
                <span className="form-section-title">Payment Details</span>
                <span className="form-section-subtitle">
                  Payments & ledger impact
                </span>
              </div>

              <div className="form-layout-2col">
                {/* Adjustments & Advance Payment Inputs */}
                <div>
                  <div className="form-grid-3">
                    {/* Discount Type — hidden */}
                    {/* <div className="compact-field">
                      <label className="compact-label">Discount Type</label>
                      <select
                        className="compact-select"
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value)}
                      >
                        <option value="fixed">Fixed ({business?.currency || 'PKR'})</option>
                        <option value="percentage">Percentage (%)</option>
                      </select>
                    </div> */}

                    {/* Discount Amount — hidden */}
                    {/* <div className="compact-field">
                      <label className="compact-label">Discount Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="compact-input num-align"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                      />
                    </div> */}

                    <div className="compact-field">
                      <label className="compact-label">Shipping Charges</label>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        className="compact-input"
                        value={shippingCharges}
                        onChange={(e) => setShippingCharges(e.target.value)}
                      />
                    </div>

                    <div className="compact-field">
                      <label className="compact-label">Amount Paid</label>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        className="compact-input"
                        value={advancePayment}
                        onChange={(e) => setAdvancePayment(e.target.value)}
                      />
                    </div>

                    {/* Payment Method — hidden */}
                    {/* <div className="compact-field">
                      <label className="compact-label">Payment Method</label>
                      <input
                        className="compact-input"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        placeholder="Cash, Bank Transfer…"
                      />
                    </div> */}

                    <div className="compact-field">
                      <label className="compact-label">Payment Note</label>
                      <input
                        className="compact-input"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                        placeholder="Optional payment note"
                      />
                    </div>
                  </div>
                </div>

                {/* Financial Ledger Breakdown */}
                <div className="financial-ledger-box">
                  <div className="financial-ledger-row">
                    <span>Subtotal (Items)</span>
                    <span className="financial-ledger-val">
                      {business?.currency} {totals.subtotal.toFixed(2)}
                    </span>
                  </div>

                  {/* {totals.overallDiscount > 0 && (
                    <div className="financial-ledger-row">
                      <span>Overall Discount</span>
                      <span className="financial-ledger-val" style={{ color: 'var(--danger)' }}>
                        - {business?.currency} {totals.overallDiscount.toFixed(2)}
                      </span>
                    </div>
                  )} */}

                  {/* {totals.taxAmount > 0 && (
                    <div className="financial-ledger-row">
                      <span>Tax Amount</span>
                      <span className="financial-ledger-val">
                        + {business?.currency} {totals.taxAmount.toFixed(2)}
                      </span>
                    </div>
                  )} */}

                  {totals.shipping > 0 && (
                    <div className="financial-ledger-row">
                      <span>Shipping Charges</span>
                      <span className="financial-ledger-val">
                        + {business?.currency} {totals.shipping.toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="financial-ledger-row">
                    <span>Advance Payment Paid</span>
                    <span className="financial-ledger-val" style={{ color: '#10633e' }}>
                      {business?.currency} {Number(advancePayment || 0).toFixed(2)}
                    </span>
                  </div>

                  <div className="financial-ledger-row">
                    <span style={{ fontWeight: 600 }}>Supplier Balance Due</span>
                    <span
                      className="financial-ledger-val"
                      style={{
                        color: supplierDue > 0 ? 'var(--danger)' : 'var(--text-secondary)',
                        fontWeight: 700,
                      }}
                    >
                      {business?.currency} {supplierDue.toFixed(2)}
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

            {/* BOTTOM SUMMARY / ACTIONS BAR */}
            <div className="compact-summary-bar">
              <div className="compact-stat-group">
                <div className="compact-stat-item">
                  <span className="stat-label">Items:</span>
                  <span className="stat-val">{items.length}</span>
                </div>

                <div className="compact-stat-item">
                  <span className="stat-label">Grand Total:</span>
                  <span className="stat-val stat-val-highlight">
                    {business?.currency} {totals.grandTotal.toFixed(2)}
                  </span>
                </div>

                <div className="compact-stat-item">
                  <span className="stat-label">Supplier Balance Due:</span>
                  <span
                    className="stat-val"
                    style={{ color: supplierDue > 0 ? 'var(--danger)' : 'var(--success)' }}
                  >
                    {business?.currency} {supplierDue.toFixed(2)}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('/purchases')}
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

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={submitting}
                  onClick={() => save('received')}
                >
                  {isEditMode ? 'Update & Receive Stock' : 'Save & Receive Stock'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <QuickAddContactModal
        isOpen={showAddSupplier}
        onClose={() => setShowAddSupplier(false)}
        contactType="supplier"
        businessId={business?.id}
        onContactAdded={(newSupplier) => {
          setSuppliers((prev) => [...prev, newSupplier]);
          setSupplierId(String(newSupplier.id));
        }}
      />
    </AppLayout>
  );
}
