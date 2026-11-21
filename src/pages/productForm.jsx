import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import './userForm.css';

const emptyForm = {
  name: '',
  sku: '',
  barcode_type: '',
  barcode_number: '',
  category_id: '',
  alert_quantity: '',
  description: '',
  not_for_selling: false,
  rack_row_position: '',
  applicable_tax_id: '',
  selling_price_tax_type: '',
  cost_price: '',
  default_selling_price: '',
  warranty_info: '',
  is_active: true,
};

function autoSku(name) {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const base =
    name
      .trim()
      .slice(0, 3)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || 'PRD';

  return `${base}-${stamp}`;
}

function getTaxRate(taxId, taxRates) {
  const tax = taxRates.find((t) => String(t.id) === String(taxId));
  return tax ? Number(tax.rate_percentage || 0) : 0;
}

function calculateSellingPrice({
  costPrice,
  profitMargin,
  taxRate,
  taxType,
}) {
  const cost = Number(costPrice);
  const margin = Number(profitMargin);
  const tax = Number(taxRate);

  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(margin) ||
    cost < 0 ||
    margin < 0
  ) {
    return '';
  }

  const priceBeforeTax = cost + (cost * margin) / 100;

  if (taxType === 'inclusive') {
    return Number(priceBeforeTax * (1 + tax / 100)).toFixed(2);
  }

  return Number(priceBeforeTax).toFixed(2);
}

function calculateProfitMargin({
  costPrice,
  sellingPrice,
  taxRate,
  taxType,
}) {
  const cost = Number(costPrice);
  const selling = Number(sellingPrice);
  const tax = Number(taxRate);

  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(selling) ||
    cost <= 0 ||
    selling < 0
  ) {
    return '';
  }

  let sellingPriceBeforeTax = selling;

  if (taxType === 'inclusive') {
    sellingPriceBeforeTax = selling / (1 + tax / 100);
  }

  const profit = sellingPriceBeforeTax - cost;
  return Number((profit / cost) * 100).toFixed(2);
}

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { business, profile } = useAuth();

  const [form, setForm] = useState(emptyForm);
  const [categories, setCategories] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [showOpeningStock, setShowOpeningStock] = useState(false);
  const [openingStockLocation, setOpeningStockLocation] = useState('');
  const [openingStockQuantity, setOpeningStockQuantity] = useState('');
  const [createdProductId, setCreatedProductId] = useState(null);

  useEffect(() => {
    Promise.all([
      api.categories.getAll(),
      api.taxRates.getAll(),
      api.locations.getAll(),
    ]).then(([catRes, taxRes, locRes]) => {
      setCategories(catRes.data || []);
      setTaxRates((taxRes.data || []).filter((t) => t.is_active));
      const locs = (locRes.data || []).filter((l) => l.is_active);
      setLocations(locs);
      if (!isEdit && locs.length > 0) {
        setSelectedLocations([locs[0].id]);
      }
    });
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) return;

    let cancelled = false;

    async function load() {
      const res = await api.products.getById(id);
      if (cancelled) return;

      if (res?.data) {
        const productRow = res.data;
        setForm({
          ...emptyForm,
          ...productRow,
          category_id: productRow.category_id || '',
          applicable_tax_id: productRow.applicable_tax_id || '',
          alert_quantity: productRow.alert_quantity ?? '',
          barcode_type: productRow.barcode_type || '',
          barcode_number: productRow.barcode_number || '',
          selling_price_tax_type:
            productRow.selling_price_tax_type || '',
        });
        setSelectedLocations(productRow.location_ids || []);
      }

      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [isEdit, id]);

  const update = (key) => (e) => {
    const val =
      e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value;

    setForm((f) => ({
      ...f,
      [key]: val,
    }));
  };

  const handleCostPriceChange = (e) => {
    setForm((current) => ({
      ...current,
      cost_price: e.target.value,
    }));
  };

  const handleSellingPriceChange = (e) => {
    const sellingPrice = e.target.value;
    const taxRate = getTaxRate(form.applicable_tax_id, taxRates);

    const profitMargin = calculateProfitMargin({
      costPrice: form.cost_price,
      sellingPrice,
      taxRate,
      taxType: form.selling_price_tax_type,
    });

    setForm((current) => ({
      ...current,
      default_selling_price: sellingPrice,
      profit_margin: profitMargin,
    }));
  };

  const handleProfitMarginChange = (e) => {
    const profitMargin = e.target.value;
    const taxRate = getTaxRate(form.applicable_tax_id, taxRates);

    const sellingPrice = calculateSellingPrice({
      costPrice: form.cost_price,
      profitMargin,
      taxRate,
      taxType: form.selling_price_tax_type,
    });

    setForm((current) => ({
      ...current,
      profit_margin: profitMargin,
      default_selling_price: sellingPrice,
    }));
  };

  const handleTaxChange = (e) => {
    const taxId = e.target.value;
    const taxRate = getTaxRate(taxId, taxRates);

    const sellingPrice = calculateSellingPrice({
      costPrice: form.cost_price,
      profitMargin: form.profit_margin,
      taxRate,
      taxType: form.selling_price_tax_type,
    });

    setForm((current) => ({
      ...current,
      applicable_tax_id: taxId,
      default_selling_price:
        form.profit_margin !== ''
          ? sellingPrice
          : current.default_selling_price,
    }));
  };

  const handleTaxTypeChange = (e) => {
    const taxType = e.target.value;
    const taxRate = getTaxRate(form.applicable_tax_id, taxRates);

    const sellingPrice = calculateSellingPrice({
      costPrice: form.cost_price,
      profitMargin: form.profit_margin,
      taxRate,
      taxType,
    });

    setForm((current) => ({
      ...current,
      selling_price_tax_type: taxType,
      default_selling_price:
        form.profit_margin !== ''
          ? sellingPrice
          : current.default_selling_price,
    }));
  };

  const toggleLocation = (locId) => {
    setSelectedLocations((sel) =>
      sel.includes(locId)
        ? sel.filter((l) => l !== locId)
        : [...sel, locId]
    );
  };

  const handleSubmit = async (e, saveAndAddOpeningStock = false) => {
    e.preventDefault();
    setError('');

    const productName = form.name.trim();

    if (
      !productName ||
      form.cost_price === '' ||
      form.default_selling_price === ''
    ) {
      setError('Name, cost price, and selling price are required.');
      return;
    }

    /* if (!isEdit && selectedLocations.length === 0) {
      setError(
        'Select at least one location where this product will be stocked.'
      );
      return;
    } */

    if (
      form.alert_quantity !== '' &&
      (!/^\d+$/.test(String(form.alert_quantity)) ||
        Number(form.alert_quantity) < 0)
    ) {
      setError(
        'Alert quantity must be a whole number greater than or equal to 0.'
      );
      return;
    }

    setSubmitting(true);

    try {
      const activeLocIds = selectedLocations.length > 0
        ? selectedLocations
        : locations.length > 0
        ? [locations[0].id]
        : [1];

      const payload = {
        name: productName,
        sku: form.sku.trim() || autoSku(productName),
        barcode_type: form.barcode_type || null,
        barcode_number: form.barcode_number.trim() || null,
        category_id: form.category_id || null,
        alert_quantity:
          form.alert_quantity === ''
            ? null
            : Number(form.alert_quantity),
        description: form.description || null,
        not_for_selling: form.not_for_selling,
        rack_row_position: form.rack_row_position || null,
        applicable_tax_id: form.applicable_tax_id || null,
        selling_price_tax_type: form.selling_price_tax_type || null,
        cost_price: Number(form.cost_price),
        default_selling_price: Number(form.default_selling_price),
        warranty_info: form.warranty_info || null,
        is_active: form.is_active,
        selectedLocations: activeLocIds,
      };

      let productId = id;

      if (isEdit) {
        const res = await api.products.update({ id, ...payload });
        if (res?.error) throw new Error(res.error);
      } else {
        const res = await api.products.create(payload);
        if (res?.error) throw new Error(res.error);
        productId = res.data.id;
      }

      if (!saveAndAddOpeningStock) {
        navigate('/products');
        return;
      }

      setCreatedProductId(productId);
      setOpeningStockLocation(String(selectedLocations[0] || ''));
      setShowOpeningStock(true);
    } catch (err) {
      setError(err.message || 'Could not save this product.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveOpeningStock = async () => {
    setError('');

    const quantity = Number(openingStockQuantity);

    if (!openingStockLocation) {
      setError('Select a location for the opening stock.');
      return;
    }

    if (
      openingStockQuantity === '' ||
      !/^\d+$/.test(String(openingStockQuantity)) ||
      quantity < 0
    ) {
      setError(
        'Opening quantity must be a whole number greater than or equal to 0.'
      );
      return;
    }

    if (!createdProductId) {
      setError('Product was not created correctly. Please try again.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await api.products.addOpeningStock({
        productId: createdProductId,
        locationId: Number(openingStockLocation),
        quantity,
        unitCost: Number(form.cost_price) || 0,
      });

      if (res?.error) throw new Error(res.error);

      navigate('/products');
    } catch (err) {
      setError(err.message || 'Could not save opening stock.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="muted" style={{ padding: 24 }}>
          Loading product details…
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="compact-page-header">
        <div>
          <h1>{isEdit ? 'Edit Product' : 'Add New Product'}</h1>
          <p>
            Configure product catalog details, automatic SKU, tax & margin calculations, and inventory locations.
          </p>
        </div>

        <div className="compact-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/products')}
          >
            Cancel
          </button>
          {!showOpeningStock ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={(e) => handleSubmit(e, false)}
              >
                {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
              </button>
              {/* {!isEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={submitting}
                  onClick={(e) => handleSubmit(e, true)}
                >
                  Save & Add Opening Stock
                </button>
              )} */}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={submitting}
              onClick={saveOpeningStock}
            >
              {submitting ? 'Saving…' : 'Save Opening Stock'}
            </button>
          )}
        </div>
      </div>

      {!showOpeningStock ? (
        <form onSubmit={(e) => handleSubmit(e, false)} className="form-shell">
          {/* BASIC CATALOG DETAILS */}
          <div className="form-section-compact">
            <div className="form-section-header">
              <span className="form-section-title">Product Information & Identification</span>
              <span className="form-section-subtitle">* Required</span>
            </div>

            <div className="form-grid-4">
              <div className="compact-field col-span-2">
                <label className="compact-label">
                  Product Name <span className="req">*</span>
                </label>
                <input
                  className="compact-input"
                  value={form.name}
                  onChange={update('name')}
                  placeholder="Enter full product name"
                  required
                />
              </div>

              {/* SKU field — hidden */}
              {/* <div className="compact-field">
                <label className="compact-label">SKU</label>
                <input
                  className="compact-input"
                  value={form.sku}
                  onChange={update('sku')}
                  placeholder="Auto-generated if blank"
                />
              </div> */}

              <div className="compact-field">
                <label className="compact-label">Category</label>
                <select
                  className="compact-select"
                  value={form.category_id}
                  onChange={update('category_id')}
                >
                  <option value="">— Uncategorized —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="compact-field">
                <label className="compact-label">Barcode Type</label>
                <select
                  className="compact-select"
                  value={form.barcode_type}
                  onChange={update('barcode_type')}
                >
                  <option value="">— Standard / Auto —</option>
                  {['EAN13', 'EAN8', 'CODE128', 'CODE39', 'QR', 'UPCA'].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="compact-field">
                <label className="compact-label">Barcode Digits / Code</label>
                <input
                  className="compact-input"
                  value={form.barcode_number}
                  onChange={update('barcode_number')}
                  placeholder="Scan or enter code"
                />
              </div>

              <div className="compact-field">
                <label className="compact-label">Low Stock Alert Qty</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="compact-input num-align"
                  value={form.alert_quantity}
                  onChange={update('alert_quantity')}
                  placeholder="e.g. 5"
                />
              </div>

              {/* Rack / Shelf Position — hidden */}
              {/* <div className="compact-field">
                <label className="compact-label">Rack / Shelf Position</label>
                <input
                  className="compact-input"
                  value={form.rack_row_position}
                  onChange={update('rack_row_position')}
                  placeholder="e.g. Aisle 3, Shelf B"
                />
              </div> */}

              {/* Description / Specifications — hidden */}
              {/* <div className="compact-field col-span-3">
                <label className="compact-label">Description / Specifications</label>
                <input
                  className="compact-input"
                  value={form.description}
                  onChange={update('description')}
                  placeholder="Optional brief notes or specs"
                />
              </div> */}

              <div className="compact-field">
                <label className="compact-label">Sales Restriction</label>
                <label
                  className={`compact-toggle-field ${
                    form.not_for_selling ? 'is-active' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.not_for_selling}
                    onChange={update('not_for_selling')}
                  />
                  <span>Not for Selling</span>
                </label>
              </div>
            </div>
          </div>

          {/* PRICING, MARGIN & TAX PANEL */}
          <div className="form-section-compact">
            <div className="form-section-header">
              <span className="form-section-title">Pricing, Tax & Profit Margin</span>
              <span className="form-section-subtitle">
                Dynamic price & margin computation
              </span>
            </div>

            <div className="form-layout-2col">
              {/* Left: Input controls */}
              <div>
                <div className="form-grid-3">
                  <div className="compact-field">
                    <label className="compact-label">
                      Cost Price ({business?.currency || 'PKR'}) <span className="req">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="compact-input num-align"
                      value={form.cost_price}
                      onChange={handleCostPriceChange}
                      placeholder="0.00"
                      required
                    />
                  </div>

                  <div className="compact-field">
                    <label className="compact-label">Profit Margin %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="compact-input num-align"
                      value={form.profit_margin || ''}
                      onChange={handleProfitMarginChange}
                      placeholder="Target %"
                    />
                  </div>

                  <div className="compact-field">
                    <label className="compact-label">
                      Default Selling Price ({business?.currency || 'PKR'}) <span className="req">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="compact-input num-align"
                      value={form.default_selling_price}
                      onChange={handleSellingPriceChange}
                      placeholder="0.00"
                      required
                    />
                  </div>

                  {/* Applicable Tax — hidden */}
                  {/* <div className="compact-field">
                    <label className="compact-label">Applicable Tax</label>
                    <select
                      className="compact-select"
                      value={form.applicable_tax_id}
                      onChange={handleTaxChange}
                    >
                      <option value="">— None (0%) —</option>
                      {taxRates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({Number(t.rate_percentage)}%)
                        </option>
                      ))}
                    </select>
                  </div> */}

                  {/* Tax Treatment — hidden */}
                  {/* <div className="compact-field">
                    <label className="compact-label">Tax Treatment</label>
                    <select
                      className="compact-select"
                      value={form.selling_price_tax_type}
                      onChange={handleTaxTypeChange}
                    >
                      <option value="">— Default —</option>
                      <option value="inclusive">Tax Inclusive</option>
                      <option value="exclusive">Tax Exclusive</option>
                    </select>
                  </div> */}

                  <div className="compact-field">
                    <label className="compact-label">Warranty Information</label>
                    <input
                      className="compact-input"
                      value={form.warranty_info}
                      onChange={update('warranty_info')}
                      placeholder="e.g. 1 Year Official"
                    />
                  </div>

                  <div className="compact-field col-span-3">
                    <label className="compact-label">Product Status</label>
                    <label
                      className={`compact-toggle-field ${
                        form.is_active ? 'is-active' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={update('is_active')}
                      />
                      <span>Active Catalog Item (Available in POS & Inventory)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Right: Price & Profit Calculation Ledger */}
              {(() => {
                const currentCost = Number(form.cost_price || 0);
                const currentSelling = Number(form.default_selling_price || 0);
                const currentTaxRate = getTaxRate(form.applicable_tax_id, taxRates);
                const sellingPreTax =
                  form.selling_price_tax_type === 'inclusive' && currentTaxRate > 0
                    ? currentSelling / (1 + currentTaxRate / 100)
                    : currentSelling;
                const unitProfit = Math.max(sellingPreTax - currentCost, 0);

                return (
                  <div className="financial-ledger-box">
                    <div className="form-section-header" style={{ marginBottom: 4, paddingBottom: 4 }}>
                      <span className="form-section-title">Margin & Price Computation</span>
                    </div>

                    <div className="financial-ledger-row">
                      <span>Unit Cost Basis</span>
                      <span className="financial-ledger-val">
                        {business?.currency} {currentCost.toFixed(2)}
                      </span>
                    </div>

                    <div className="financial-ledger-row">
                      <span>Selling Price (Pre-tax)</span>
                      <span className="financial-ledger-val">
                        {business?.currency} {sellingPreTax.toFixed(2)}
                      </span>
                    </div>

                    <div className="financial-ledger-row">
                      <span>Estimated Profit / Unit</span>
                      <span className="financial-ledger-val" style={{ color: '#10633e', fontWeight: 700 }}>
                        + {business?.currency} {unitProfit.toFixed(2)}
                      </span>
                    </div>

                    <div className="financial-ledger-row">
                      <span>Calculated Margin</span>
                      <span className="financial-ledger-val" style={{ color: '#10633e' }}>
                        {form.profit_margin ? `${form.profit_margin}%` : '—'}
                      </span>
                    </div>

                    <div className="financial-ledger-row">
                      <span>Tax ({currentTaxRate}%)</span>
                      <span className="financial-ledger-val">
                        {currentTaxRate > 0
                          ? `+ ${business?.currency} ${(currentSelling - sellingPreTax).toFixed(2)}`
                          : '0.00'}
                      </span>
                    </div>

                    <div className="financial-ledger-row grand-row">
                      <span>Final Selling Price</span>
                      <span style={{ color: 'var(--navy-900)' }}>
                        {business?.currency} {currentSelling.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* STOCKED LOCATIONS — hidden for single-location setup */}
          {/* <div className="form-section-compact">
            <div className="form-section-header">
              <span className="form-section-title">Stocked At Locations</span>
              <span className="badge badge-info" style={{ fontSize: 11, padding: '2px 8px' }}>
                {selectedLocations.length} Locations Selected
              </span>
            </div>

            <div className="compact-chip-row">
              {locations.map((loc) => {
                const isSelected = selectedLocations.includes(loc.id);
                return (
                  <button
                    type="button"
                    key={loc.id}
                    className={`compact-chip ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => toggleLocation(loc.id)}
                  >
                    {loc.name}
                    {isSelected ? ' ✓' : ''}
                  </button>
                );
              })}

              {locations.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  No locations found. Add locations in Settings.
                </span>
              )}
            </div>
          </div> */}

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
                <span className="stat-label">Cost:</span>
                <span className="stat-val">
                  {business?.currency} {Number(form.cost_price || 0).toFixed(2)}
                </span>
              </div>

              <div className="compact-stat-item">
                <span className="stat-label">Selling Price:</span>
                <span className="stat-val stat-val-highlight">
                  {business?.currency} {Number(form.default_selling_price || 0).toFixed(2)}
                </span>
              </div>

              {form.profit_margin !== '' && (
                <div className="compact-stat-item">
                  <span className="stat-label">Margin:</span>
                  <span className="stat-val" style={{ color: '#10633e' }}>
                    {form.profit_margin}%
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/products')}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={(e) => handleSubmit(e, false)}
              >
                {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
              </button>

              {!isEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={submitting}
                  onClick={(e) => handleSubmit(e, true)}
                >
                  Save & Add Opening Stock
                </button>
              )}
            </div>
          </div>
        </form>
      ) : (
        /* OPENING STOCK SUB-FLOW */
        <div className="form-shell">
          <div className="form-section-compact">
            <div className="form-section-header">
              <span className="form-section-title">Initial Opening Stock</span>
              <span className="form-section-subtitle">
                Record initial inventory quantity for newly added product
              </span>
            </div>

            <div className="form-grid-2">
              <div className="compact-field">
                <label className="compact-label">
                  Stock Location <span className="req">*</span>
                </label>
                <select
                  className="compact-select"
                  value={openingStockLocation}
                  onChange={(e) => setOpeningStockLocation(e.target.value)}
                >
                  <option value="">— Select Location —</option>
                  {selectedLocations.map((locationId) => {
                    const location = locations.find((l) => l.id === locationId);
                    if (!location) return null;
                    return (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="compact-field">
                <label className="compact-label">
                  Opening Quantity <span className="req">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="compact-input num-align"
                  value={openingStockQuantity}
                  onChange={(e) => setOpeningStockQuantity(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
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

          <div className="compact-summary-bar">
            <span className="muted" style={{ fontSize: 12 }}>
              Opening stock will be logged with unit cost basis {business?.currency} {Number(form.cost_price || 0).toFixed(2)}.
            </span>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={submitting}
                onClick={() => navigate('/products')}
              >
                Skip Opening Stock
              </button>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={saveOpeningStock}
              >
                {submitting ? 'Saving Stock…' : 'Confirm Opening Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
