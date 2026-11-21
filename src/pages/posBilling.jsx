import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Calculator from '../components/Calculator.jsx';
import { computeLine } from '../components/LineItemsEditor.jsx';
import { formatTimestamp, todayLocal, startOfDayUTC } from '../lib/timezone.js';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import {
  checkLowStockForItems,
  notifyPaymentDueCustomer,
} from '../lib/notifications.js';
import { printSaleInvoice, printThermalSaleInvoice } from '../lib/printInvoice.js';
import { getFifoCosts } from '../lib/fifoCost.js';
import useRegister from '../hooks/useRegister.js';
import { OpenRegisterModal, CloseRegisterModal } from '../components/pos/RegisterModals.jsx';
import './posBilling.css';

// Reference list shown in the "Keyboard shortcuts" popover in the toolbar.
// Keep this in sync with the keydown handler further down in this file.
const SHORTCUTS = [
  {
    title: 'Navigation & Focus',
    items: [
      { key: 'Shift + S', desc: 'Focus the product name / SKU search field.' },
      { key: 'Shift + B', desc: 'Focus the barcode scanner input field.' },
      { key: 'Shift + C', desc: 'Focus the customer search field.' },
      { key: 'Shift + N', desc: 'Focus the sale note field.' },
      { key: 'Ctrl + Space', desc: 'Toggle fullscreen mode.' },
      { key: 'Esc', desc: 'Close whichever modal or popover is open.' },
    ],
  },
  {
    title: 'Cart Editing',
    items: [
      { key: '+  /  -', desc: 'Increase / decrease quantity of the last cart line.' },
      { key: 'Shift + D', desc: 'Remove the last line from the cart.' },
      { key: 'Shift + X', desc: 'Clear the entire cart (asks to confirm).' },
    ],
  },
  {
    title: 'Payment & Checkout',
    items: [
      { key: 'Shift + F8', desc: 'Open Multi (split) Pay.' },
      { key: 'Shift + F9', desc: 'Pay by Card and complete the sale.' },
      { key: 'Shift + F10', desc: 'Pay by Cash and complete the sale.' },
      { key: 'Shift + F12', desc: 'Complete the sale as Credit.' },
      { key: 'Enter', desc: "Pay Cash — only when nothing is focused." },
    ],
  },
  {
    title: 'Sale Management',
    items: [
      { key: 'Shift + F11', desc: 'Suspend the current sale.' },
      { key: 'Shift + Q', desc: 'Save the cart as a Quotation.' },
      { key: 'Shift + W', desc: 'Save the cart as a Draft.' },
    ],
  },
  {
    title: 'Utility',
    items: [
      { key: 'Shift + R', desc: 'Open Recent Transactions.' },
      { key: 'Shift + A', desc: 'Refresh stock counts.' },
      { key: 'Shift + E', desc: 'Open Add Expense.' },
      { key: 'Shift + O', desc: 'Open the Register Report.' },
    ],
  },
];

function autoSku(name) {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const base =
    (name || '')
      .trim()
      .slice(0, 3)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || 'PRD';

  return `${base}-${stamp}`;
}

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function decimalInput(rawValue) {
  if (rawValue === '') return '';

  const num = Math.max(
    0,
    Number(rawValue) || 0
  );

  return String(num);
}

function useLiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(
      () => setNow(new Date()),
      1000 * 30
    );

    return () => clearInterval(id);
  }, []);

  return now;
}

export default function PosBilling() {
  const { business, profile } = useAuth();
  const navigate = useNavigate();
  const now = useLiveClock();

  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');

  const prefLocationKey =
    business?.id && profile?.id
      ? `havenpos_pref_loc_${business.id}_${profile.id}`
      : null;
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [expenseCategories, setExpenseCategories] =
    useState([]);
  const [stockMap, setStockMap] = useState({});

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] =
    useState(false);
  const [searchActiveIndex, setSearchActiveIndex] =
    useState(-1);

  const [categoryFilter, setCategoryFilter] =
    useState('');
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] =
    useState('');
  const [customerSearchFocused, setCustomerSearchFocused] =
    useState(false);
  const [discountType, setDiscountType] =
    useState('fixed');
  const [discountAmount, setDiscountAmount] =
    useState('0');
  const [shippingCharges, setShippingCharges] =
    useState('0');
  const [paymentMethod, setPaymentMethod] =
    useState('Cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [saleNote, setSaleNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] =
    useState('');
  const [calcOpen, setCalcOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [activeModal, setActiveModal] =
    useState(null);

  const [suspendedSales, setSuspendedSales] =
    useState([]);
  const [recentSales, setRecentSales] =
    useState([]);
  const [todaySummary, setTodaySummary] =
    useState(null);

  const [lastSale, setLastSale] = useState(null);

  // Refs for keyboard-shortcut focus targets
  const searchInputRef = useRef(null);
  const customerInputRef = useRef(null);
  const saleNoteRef = useRef(null);
  const barcodeInputRef = useRef(null);

  // ---------- Barcode scanner ----------
  const [barcodeInput, setBarcodeInput] = useState('');
  // barcodeMsg: { type: 'success'|'error'|'', text: '' }
  const [barcodeMsg, setBarcodeMsg] = useState({ type: '', text: '' });
  const barcodeMsgTimer = useRef(null);
  // Tracks whether the barcode field is focused (shows "READY" indicator)
  const [barcodeReady, setBarcodeReady] = useState(false);
  // Dedup: prevents same barcode being processed twice within 200 ms
  // (handles scanners that fire twice on a single trigger pull)
  const lastScanRef = useRef({ barcode: '', ts: 0 });

  // Cleanup: cancel any pending dismiss timer when the component unmounts
  useEffect(() => () => clearTimeout(barcodeMsgTimer.current), []);

  const [newCustomer, setNewCustomer] =
    useState({
      name: '',
      contact_number: '',
      address: '',
    });

  const [newProduct, setNewProduct] =
    useState({
      name: '',
      sku: '',
      cost_price: '',
      default_selling_price: '',
      category_id: '',
      opening_stock: '0',
    });

  const [newExpense, setNewExpense] =
    useState({
      category_id: '',
      amount: '',
      note: '',
    });

  const [splitPay, setSplitPay] =
    useState({
      cash: '',
      card: '',
    });

  const [modalError, setModalError] =
    useState('');
  const [modalSubmitting, setModalSubmitting] =
    useState(false);

  // ---------- Register (cash drawer) ----------
  // Registers are one-per-USER (see uq_registers_one_open_per_user), not
  // per-location — useRegister() always resolves to "my open register",
  // regardless of which location is currently selected below.
  const {
    register,
    loading: registerLoading,
    openRegister,
    closeRegister,
  } = useRegister();

  const [showOpenRegister, setShowOpenRegister] = useState(false);
  const [showCloseRegister, setShowCloseRegister] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

  // Prompt to open a register commented out — no forced register popup
  /* useEffect(() => {
    if (!locationId || registerLoading) return;
    setShowOpenRegister(!register);
  }, [locationId, registerLoading, register]); */

  // Once a register is open, lock POS Billing to that register's location.
  // The drawer is tied to one location_id at open time — selling against a
  // different location while it's open would tag sales to the wrong
  // register's location, so the dropdown below gets disabled instead.
  useEffect(() => {
    if (register?.location_id && locationId !== register.location_id) {
      setLocationId(register.location_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register?.location_id]);

  const loadCatalog = async () => {
    if (!business?.id) return;

    const res = await api.products.getAll({ business_id: business.id });
    const allProds = Array.isArray(res?.data)
      ? res.data
      : (res?.data?.rows || []);
    const sellable = allProds.filter(
      (p) => (p.is_active === 1 || p.is_active === true) && !p.not_for_selling
    );

    setProducts(sellable);
  };

  const refreshStock = async () => {
    if (!business?.id || !locationId) return;

    const res = await api.purchases.getStockByLocation({
      business_id: business.id,
      location_id: locationId,
    });

    const rawData = res?.data;
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

  useEffect(() => {
    if (!business?.id || !profile?.id) return;

    async function load() {
      const [
        locRes,
        catRes,
        taxRes,
        custRes,
        expCatRes,
      ] = await Promise.all([
        api.locations.getAll(),
        api.categories.getAll(),
        api.taxRates.getAll(),
        api.contacts.getAll({
          business_id: business.id,
          contact_type: 'customer',
        }),
        api.expenseCategories.getAll(),
      ]);

      const allLocations = (locRes?.data || []).filter(
        (l) => l.is_active === 1 || l.is_active === true
      );
      const usable = allLocations;

      setLocations(usable);
      setCategories(catRes?.data || []);
      setTaxRates((taxRes?.data || []).filter((t) => t.is_active === 1 || t.is_active === true));
      setCustomers(custRes?.data || []);
      setExpenseCategories(expCatRes?.data || []);

      await loadCatalog();

      const savedLocId = prefLocationKey ? localStorage.getItem(prefLocationKey) : null;
      const initialLoc =
        (register?.location_id && usable.find((l) => l.id === register.location_id)) ||
        (savedLocId && usable.find((l) => String(l.id) === String(savedLocId))) ||
        usable[0];

      if (initialLoc) {
        setLocationId(initialLoc.id);
      }
    }

    load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, profile?.id]);

  useEffect(() => {
    refreshStock();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, locationId]);

  // Auto-refocus the barcode field whenever a modal closes.
  // This is the #1 real-world POS problem: cashier closes receipt →
  // scanner fires → nothing is focused → product is silently lost.
  useEffect(() => {
    if (activeModal === null) {
      const id = setTimeout(
        () => barcodeInputRef.current?.focus(),
        80           // slight delay lets the modal finish its DOM removal
      );
      return () => clearTimeout(id);
    }
  }, [activeModal]);

  const taxRatesById = useMemo(
    () =>
      Object.fromEntries(
        taxRates.map((t) => [t.id, t])
      ),
    [taxRates]
  );

  const productsById = useMemo(
    () =>
      Object.fromEntries(
        products.map((p) => [p.id, p])
      ),
    [products]
  );

  // O(1) barcode lookup — barcode_number is unique per business (DB constraint).
  // Keys are lower-cased so lookup is case-insensitive (handles CODE128/CODE39/QR
  // barcodes that may contain letters).
  const productsByBarcode = useMemo(
    () =>
      Object.fromEntries(
        products
          .filter((p) => p.barcode_number)
          .map((p) => [p.barcode_number.trim().toLowerCase(), p])
      ),
    [products]
  );

  const currentLocationName =
    locations.find(
      (l) => l.id === Number(locationId)
    )?.name || '';

  const inCartQty = (productId) =>
    cart
      .filter(
        (c) => c.product_id === productId
      )
      .reduce(
        (s, c) => s + Number(c.quantity),
        0
      );

  const availableQty = (productId) =>
    (stockMap[productId] || 0) -
    inCartQty(productId);

  const filteredProducts = products
    .filter((p) => {
      const q = search.toLowerCase();

      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q);

      const matchesCategory =
        !categoryFilter ||
        p.category_id === Number(categoryFilter);

      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      const stockA = availableQty(a.id);
      const stockB = availableQty(b.id);

      // Products with stock first
      const aOut = stockA <= 0;
      const bOut = stockB <= 0;

      if (aOut && !bOut) return 1;
      if (!aOut && bOut) return -1;

      // Within the same stock group, sort alphabetically
      return (a.name || '').localeCompare(
        b.name || '',
        undefined,
        { sensitivity: 'base' }
      );
    });

  const searchDropdownProducts = search.trim()
    ? filteredProducts
    : [];

  const customerSearchResults = customers.filter(
    (c) => {
      const q = customerSearch.trim().toLowerCase();

      // For non-owner staff: show customers assigned to this location or global
      if (!profile?.is_owner && c.location_id) {
        if (Number(c.location_id) !== Number(locationId)) {
          return false;
        }
      }

      return (
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.contact_number?.toLowerCase().includes(q)
      );
    }
  );

  const addToCart = (product) => {
    // Stock guard is intentionally INSIDE the setCart updater so it always
    // reads the latest prev-cart state. This prevents rapid consecutive scans
    // of the same product from pushing the cart quantity above available stock,
    // because React guarantees the updater receives the most recent prev value
    // even when multiple setState calls are batched within the same render.
    setCart((prev) => {
      // Recompute in-cart qty from prev (not from stale closure)
      const inCartForProduct = prev
        .filter((c) => c.product_id === product.id)
        .reduce((s, c) => s + Number(c.quantity), 0);

      const avail = (stockMap[product.id] || 0) - inCartForProduct;

      if (avail <= 0) return prev; // stock exhausted — leave cart unchanged

      const idx = prev.findIndex(
        (c) => c.product_id === product.id
      );

      if (idx >= 0) {
        const next = [...prev];

        next[idx] = {
          ...next[idx],
          quantity: Number(next[idx].quantity) + 1,
        };

        return next;
      }

      return [
        ...prev,
        {
          product_id: product.id,
          quantity: 1,
          unit_price: Number(
            product.default_selling_price
          ),
          discount_type: 'fixed',
          discount_amount: 0,
          tax_id: product.applicable_tax_id || null,
        },
      ];
    });
  };

  // ---------- Barcode scanner handler ----------
  // Called when Enter fires in the dedicated barcode input.
  // Uses the same addToCart() path as manual product selection.
  const showBarcodeMsg = (type, text) => {
    clearTimeout(barcodeMsgTimer.current);
    setBarcodeMsg({ type, text });
    barcodeMsgTimer.current = setTimeout(
      () => setBarcodeMsg({ type: '', text: '' }),
      2500
    );
  };

  const handleBarcodeScan = (e) => {
    if (e.key === 'Escape') {
      setBarcodeInput('');
      setBarcodeMsg({ type: '', text: '' });
      barcodeInputRef.current?.blur();
      return;
    }

    if (e.key !== 'Enter') return;

    e.preventDefault();

    const raw = barcodeInput.trim();

    if (!raw) return; // accidental Enter with empty field

    // ── Scan dedup ────────────────────────────────────────────────────────────
    // Some scanners fire the same barcode twice on a single trigger pull, or a
    // cashier accidentally double-pulls within milliseconds. Allow the same
    // barcode to be processed again only after 200 ms.
    const now = Date.now();
    if (
      raw === lastScanRef.current.barcode &&
      now - lastScanRef.current.ts < 200
    ) {
      setBarcodeInput('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
      return;
    }
    lastScanRef.current = { barcode: raw, ts: now };
    // ─────────────────────────────────────────────────────────────────────────

    // Case-insensitive lookup (productsByBarcode keys are already lower-cased)
    const product = productsByBarcode[raw.toLowerCase()];

    if (!product) {
      showBarcodeMsg('error', `Not found: ${raw}`);
      setBarcodeInput('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
      return;
    }

    // Pre-check using current cart state (best-effort; addToCart also guards
    // inside its setCart updater with always-fresh prev state).
    const avail = availableQty(product.id);

    if (avail <= 0) {
      showBarcodeMsg('error', `Out of stock: ${product.name}`);
      setBarcodeInput('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
      return;
    }

    // Delegate to the exact same addToCart used by manual selection
    addToCart(product);
    showBarcodeMsg('success', `${product.name} added`);
    setBarcodeInput('');
    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  };

  const addByBarcode = (e) => {
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp'
    ) {
      e.preventDefault();

      if (
        searchDropdownProducts.length === 0
      ) {
        return;
      }

      const direction =
        e.key === 'ArrowDown' ? 1 : -1;

      let nextIndex =
        searchActiveIndex;

      for (
        let i = 0;
        i < searchDropdownProducts.length;
        i++
      ) {
        nextIndex =
          nextIndex + direction;

        if (
          nextIndex >=
          searchDropdownProducts.length
        ) {
          nextIndex = 0;
        }

        if (nextIndex < 0) {
          nextIndex =
            searchDropdownProducts.length - 1;
        }

        if (
          availableQty(
            searchDropdownProducts[
              nextIndex
            ].id
          ) > 0
        ) {
          setSearchActiveIndex(
            nextIndex
          );

          return;
        }
      }

      return;
    }

    if (e.key === 'Escape') {
      setSearchFocused(false);
      setSearchActiveIndex(-1);
      return;
    }

    if (e.key !== 'Enter') return;

    e.preventDefault();

    const q = search.trim().toLowerCase();

    if (!q) return;

    const match = products.find(
      (p) => p.sku?.toLowerCase() === q
    );

    if (match) {
      addToCart(match);
      setSearch('');
      setSearchFocused(false);
      setSearchActiveIndex(-1);
      return;
    }

    const selectedProduct =
      searchDropdownProducts[
      searchActiveIndex
      ];

    if (
      selectedProduct &&
      availableQty(selectedProduct.id) > 0
    ) {
      addToCart(selectedProduct);
      setSearch('');
      setSearchFocused(false);
      setSearchActiveIndex(-1);
    }
  };

  const updateCartQty = (idx, qty) => {
    // Never allow negative quantity
    const quantity = Math.max(
      0,
      Math.floor(Number(qty) || 0)
    );

    const item = cart[idx];

    if (!item) return;

    const productId = item.product_id;
    const currentQty = Number(item.quantity) || 0;
    const totalStock = Number(stockMap[productId] || 0);

    // Maximum quantity allowed based on available stock
    const maxAllowed =
      availableQty(productId) + currentQty;

    // Do not allow quantity above available stock
    if (quantity > maxAllowed) {
      setError(`Stock is ${totalStock}`);
      return;
    }

    if (error?.startsWith('Stock is')) {
      setError('');
    }

    // Keep the product in the cart even when quantity is 0
    setCart((prev) =>
      prev.map((c, i) =>
        i === idx
          ? {
            ...c,
            quantity,
          }
          : c
      )
    );
  };

  const updateCartPrice = (idx, rawValue) => {
    const item = cart[idx];

    if (!item) return;

    const nextValue = decimalInput(rawValue);

    setCart((prev) =>
      prev.map((c, i) =>
        i === idx
          ? {
            ...c,
            unit_price:
              nextValue === ''
                ? ''
                : Number(nextValue),
          }
          : c
      )
    );
  };

  const revertCartPriceIfBlank = (idx) => {
    const item = cart[idx];

    if (!item || item.unit_price !== '') return;

    const product = productsById[item.product_id];

    const fallback = product
      ? Number(product.default_selling_price) || 0
      : 0;

    setCart((prev) =>
      prev.map((c, i) =>
        i === idx
          ? { ...c, unit_price: fallback }
          : c
      )
    );
  };

  const removeCartLine = (idx) => {
    setCart((prev) =>
      prev.filter((_, i) => i !== idx)
    );
  };

  const resetRegister = ({
    confirmFirst = false,
  } = {}) => {
    if (
      confirmFirst &&
      cart.length > 0 &&
      !window.confirm(
        'Clear the current sale?'
      )
    ) {
      return;
    }

    setCart([]);
    setCustomerId('');
    setCustomerSearch('');
    setCustomerSearchFocused(false);
    setDiscountType('fixed');
    setDiscountAmount('0');
    setShippingCharges('0');
    setPaymentMethod('Cash');
    setPaidAmount('');
    setSaleNote('');
    setError('');
    setSearch('');
    setSearchFocused(false);
    setSearchActiveIndex(-1);
    // Clear barcode field and any pending feedback message so the
    // next transaction starts with a clean scanner input.
    setBarcodeInput('');
    setBarcodeMsg({ type: '', text: '' });
    clearTimeout(barcodeMsgTimer.current);
    // Re-focus the barcode field so the cashier can scan immediately
    // after a sale completes without touching the keyboard or mouse.
    setTimeout(() => barcodeInputRef.current?.focus(), 100);
  };

  const totals = useMemo(() => {
    let subtotalBeforeOverall = 0;
    cart.forEach((it) => {
      const c = computeLine(
        it,
        taxRatesById,
        productsById
      );
      subtotalBeforeOverall +=
        c.subtotal - c.discount;
    });

    let overallDiscount =
      Number(discountAmount) || 0;

    if (discountType === 'percentage') {
      overallDiscount =
        (subtotalBeforeOverall * overallDiscount) / 100;
    }

    const overallDiscountRatio =
      subtotalBeforeOverall > 0
        ? overallDiscount / subtotalBeforeOverall
        : 0;

    let taxAmount = 0;
    let lineTotal = 0;

    cart.forEach((it) => {
      const c = computeLine(
        it,
        taxRatesById,
        productsById,
        overallDiscountRatio
      );

      taxAmount += c.taxAmount;
      lineTotal += c.lineTotal;
    });

    const shipping =
      Number(shippingCharges) || 0;

    const subtotalR = Number(subtotalBeforeOverall.toFixed(2));
    const taxR = Number(taxAmount.toFixed(2));
    const discountR =
      Number(overallDiscount.toFixed(2));
    const shippingR =
      Number(shipping.toFixed(2));
    const lineTotalR = Number(lineTotal.toFixed(2));

    const grandTotal =
      Math.max(lineTotalR, 0) + shippingR;

    const itemCount = cart.reduce(
      (s, it) =>
        s + Number(it.quantity || 0),
      0
    );

    // overallDiscountRatio is returned here (not recomputed from rounded
    // values later) so that finalizeSale() and saveAs() use the exact
    // same ratio the cart display already applied — avoids floating-point
    // drift when discountR / subtotalR diverges from the true ratio.
    const overallDiscountRatioFinal =
      subtotalBeforeOverall > 0
        ? overallDiscount / subtotalBeforeOverall
        : 0;

    return {
      subtotal: subtotalR,
      taxAmount: taxR,
      overallDiscount: discountR,
      overallDiscountRatio: overallDiscountRatioFinal,
      shipping: shippingR,
      grandTotal,
      itemCount,
    };
  }, [
    cart,
    taxRatesById,
    productsById,
    discountType,
    discountAmount,
    shippingCharges,
  ]);

  // Only positive-quantity products are submitted to the database.
  // Products with quantity 0 remain visible in the cart but are ignored
  // when completing, drafting, or quoting a sale.
  const getSaleCart = () =>
    cart.filter(
      (item) => Number(item.quantity) > 0
    );

  const finalizeSale = async ({
    paymentMethodLabel,
    paidAmountValue,
  }) => {
    setError('');
    setSuccessMsg('');

    if (!locationId) {
      setError('Select a location.');
      return;
    }

    /* if (!register) {
      setError('Open a register before starting sales.');
      return;
    } */

    // Ignore zero-quantity products when submitting
    const saleCart = getSaleCart();

    if (saleCart.length === 0) {
      setError('Cart is empty.');
      return;
    }

    // Use the exact ratio from the totals memo — avoids floating-point
    // drift when recomputing from already-rounded display values.
    const overallDiscountRatio = totals.overallDiscountRatio;

    const due = Math.max(
      Math.round(
        (totals.grandTotal -
          paidAmountValue) * 100
      ) / 100,
      0
    );

    if (due > 0 && !customerId) {
      setError(
        'Select a customer to record a balance, or pay in full.'
      );

      return;
    }

    setSubmitting(true);

    try {
      // Pre-flight: compute FIFO costs before creating the sale record in DB
      const fifoCosts = await getFifoCosts(
        business.id,
        saleCart
      );

      // Only positive-quantity products are inserted into sale_items
      const itemRows = saleCart.map((it) => {
        const c = computeLine(
          it,
          taxRatesById,
          productsById,
          overallDiscountRatio
        );

        return {
          product_id: it.product_id,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          unit_cost: fifoCosts[it.product_id] || 0,
          discount_type: it.discount_type,
          discount_amount: c.discount,
          tax_id: it.tax_id || null,
          line_total: c.lineTotal,
        };
      });

      const salePayload = {
        business_id: business.id,
        location_id: locationId,
        register_id: register?.id || null,
        customer_id: customerId || null,
        channel: 'pos',
        sale_date: todayLocal(business?.time_zone),
        status: 'confirmed',
        subtotal: totals.subtotal,
        discount_type: discountType,
        discount_amount: totals.overallDiscount,
        tax_amount: totals.taxAmount,
        shipping_charges: totals.shipping,
        grand_total: totals.grandTotal,
        payment_method: paymentMethodLabel || null,
        paid_amount: paidAmountValue,
        due_amount: due,
        created_by: profile.id,
        staff_note: saleNote.trim() || null,
        items: itemRows,
        fifoCosts,
      };

      const res = await api.sales.create(salePayload);
      if (res?.error) throw new Error(res.error);

      const sale = { id: res.data.id, ...salePayload };

      try {
        await checkLowStockForItems({
          businessId: business.id,
          locationId,
          locationName: currentLocationName,
          items: saleCart.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
          })),
          productsById,
        });

        if (customerId && due > 0) {
          const customerName =
            customers.find((c) => c.id === Number(customerId))?.name || 'the customer';

          await notifyPaymentDueCustomer({
            businessId: business.id,
            saleId: sale.id,
            customerName,
            dueAmount: due,
            currency: business.currency,
          });
        }
      } catch {
        // Notifications are best-effort.
      }

      // Receipt only contains products actually sold
      setLastSale({
        sale,
        note: saleNote.trim(),

        items: saleCart.map((it) => {
          const product = productsById[it.product_id];
          const c = computeLine(it, taxRatesById, productsById);

          return {
            product_name: product?.name || 'Item',
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
            discount_amount: Number(c.discount || 0),
            line_total: Number(c.lineTotal || 0),
          };
        }),

        customer:
          customers.find((c) => c.id === Number(customerId)) || null,
      });

      setActiveModal('receipt');
      resetRegister();
      refreshStock();
    } catch (err) {
      setError(
        err.message || 'Could not complete this sale.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const payCash = () =>
    finalizeSale({
      paymentMethodLabel: 'Cash',
      paidAmountValue:
        totals.grandTotal,
    });

  const payCard = () =>
    finalizeSale({
      paymentMethodLabel: 'Card',
      paidAmountValue:
        totals.grandTotal,
    });

  const payCredit = () =>
    finalizeSale({
      paymentMethodLabel: 'Credit',
      paidAmountValue: 0,
    });

  const saveAs = async (status) => {
    setError('');
    setSuccessMsg('');

    if (!locationId) {
      setError('Select a location.');
      return;
    }

    /* if (!register) {
      setError('Open a register before starting sales.');
      return;
    } */

    // Ignore zero-quantity products when saving
    // drafts and quotations as well.
    const saleCart = getSaleCart();

    if (saleCart.length === 0) {
      setError('Cart is empty.');
      return;
    }

    // Use the exact ratio from the totals memo — avoids floating-point
    // drift when recomputing from already-rounded display values.
    const overallDiscountRatio = totals.overallDiscountRatio;

    setSubmitting(true);

    try {
      const itemRows = saleCart.map((it) => {
        const c = computeLine(
          it,
          taxRatesById,
          productsById,
          overallDiscountRatio
        );

        return {
          product_id: it.product_id,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          discount_type: it.discount_type,
          discount_amount: c.discount,
          tax_id: it.tax_id || null,
          line_total: c.lineTotal,
        };
      });

      const res = await api.sales.create({
        business_id: business.id,
        location_id: locationId,
        register_id: register?.id || null,
        customer_id: customerId || null,
        channel: 'pos',
        sale_date: todayLocal(business?.time_zone),
        status,
        subtotal: totals.subtotal,
        discount_type: discountType,
        discount_amount: totals.overallDiscount,
        tax_amount: totals.taxAmount,
        shipping_charges: totals.shipping,
        grand_total: totals.grandTotal,
        paid_amount: 0,
        due_amount: totals.grandTotal,
        created_by: profile.id,
        items: itemRows,
        fifoCosts: {},
      });

      if (res?.error) throw new Error(res.error);

      setSuccessMsg(
        `Saved as ${status === 'draft' ? 'a draft' : 'a quotation'} (#${res.data.id}).`
      );

      resetRegister();
    } catch (err) {
      setError(
        err.message || 'Could not save this sale.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const suspendSale = () => {
    if (cart.length === 0) {
      setError(
        'Nothing to suspend — the cart is empty.'
      );

      return;
    }

    setSuspendedSales((prev) => [
      ...prev,
      {
        key: Date.now(),
        savedAt:
          new Date().toLocaleTimeString(),
        cart,
        customerId,
        discountType,
        discountAmount,
        shippingCharges,
        itemCount:
          totals.itemCount,
        total:
          totals.grandTotal,
        customerName:
          customers.find(
            (c) =>
              c.id ===
              Number(customerId)
          )?.name ||
          'Walk-in',
      },
    ]);

    resetRegister();

    setSuccessMsg(
      'Sale suspended — resume it any time from the history icon.'
    );
  };

  const resumeSuspended = (key) => {
    const found =
      suspendedSales.find(
        (s) => s.key === key
      );

    if (!found) return;

    setCart(found.cart);
    setCustomerId(
      found.customerId
    );
    setCustomerSearch(
      found.customerId
        ? customers.find(
          (c) =>
            c.id ===
            Number(found.customerId)
        )?.name || ''
        : ''
    );
    setDiscountType(
      found.discountType
    );
    setDiscountAmount(
      found.discountAmount
    );
    setShippingCharges(
      found.shippingCharges
    );

    setSuspendedSales((prev) =>
      prev.filter(
        (s) => s.key !== key
      )
    );

    setActiveModal(null);
  };

  const discardSuspended = (key) =>
    setSuspendedSales((prev) =>
      prev.filter(
        (s) => s.key !== key
      )
    );

  const openRecent = async () => {
    setActiveModal('recent');

    const res = await api.sales.getRecentPos({
      business_id: business.id,
      limit: 10,
    });

    setRecentSales(res?.data || []);
  };

  const openSummary = async () => {
    setActiveModal('summary');

    const tz = business?.time_zone;
    const since = startOfDayUTC(todayLocal(tz), tz);

    const res = await api.sales.getPosSummary({
      business_id: business.id,
      location_id: locationId,
      since,
    });

    setTodaySummary({
      count: res?.data?.count || 0,
      total: res?.data?.total || 0,
    });
  };

  const submitNewCustomer = async (e) => {
    e.preventDefault();

    setModalError('');

    const trimmedName = newCustomer.name?.trim();
    const trimmedNumber = newCustomer.contact_number?.trim();

    if (
      !trimmedName ||
      !trimmedNumber
    ) {
      setModalError(
        'Name and contact number are required.'
      );

      return;
    }

    setModalSubmitting(true);

    try {
      const targetLocationId = locationId ? Number(locationId) : null;

      const res = await api.contacts.create({
        business_id: business.id,
        contact_type: 'customer',
        name: trimmedName,
        contact_number: trimmedNumber,
        address: newCustomer.address?.trim() || null,
        location_id: targetLocationId,
        created_by: profile.id,
      });

      if (res?.error) {
        if (
          res.error.includes('UNIQUE') ||
          res.error.includes('unique') ||
          res.error.includes('duplicate') ||
          res.error.includes('exists')
        ) {
          setModalError(
            'A customer/contact with this contact number already exists. Please enter a unique contact number.'
          );
        } else {
          setModalError(res.error);
        }
        setModalSubmitting(false);
        return;
      }

      const contactId = res.data?.id;
      const getRes = await api.contacts.getById(contactId);
      const data = getRes?.data || {
        id: contactId,
        name: trimmedName,
        contact_number: trimmedNumber,
        address: newCustomer.address?.trim() || null,
        location_id: targetLocationId,
      };

      setCustomers((prev) => [
        ...prev,
        data,
      ]);

      setCustomerId(data.id);
      setCustomerSearch(data.name);

      setNewCustomer({
        name: '',
        contact_number: '',
        address: '',
      });

      setActiveModal(null);
    } catch (err) {
      setModalError(
        err.message ||
        'Could not add this customer.'
      );
    } finally {
      setModalSubmitting(false);
    }
  };

  const submitNewProduct = async (e) => {
    e.preventDefault();
    setModalError('');

    const skuValue = newProduct.sku.trim() || autoSku(newProduct.name);

    if (
      !newProduct.name ||
      newProduct.cost_price === '' ||
      newProduct.default_selling_price === ''
    ) {
      setModalError('Name, cost, and selling price are required.');
      return;
    }

    setModalSubmitting(true);

    try {
      const res = await api.products.create({
        business_id: business.id,
        name: newProduct.name,
        sku: skuValue,
        category_id: newProduct.category_id || null,
        cost_price: Number(newProduct.cost_price),
        default_selling_price: Number(newProduct.default_selling_price),
        selectedLocations: locationId ? [locationId] : [],
      });

      if (res?.error) throw new Error(res.error);
      const productId = res.data.id;

      // Add opening stock to stock_ledger if specified
      const openingQty = Number(newProduct.opening_stock || 0);
      if (openingQty > 0) {
        await api.products.addOpeningStock({
          businessId: business.id,
          productId,
          locationId,
          quantity: openingQty,
          unitCost: Number(newProduct.cost_price) || 0,
        });
        // Update local stockMap
        setStockMap((prev) => ({ ...prev, [productId]: openingQty }));
      }

      const getProdRes = await api.products.getById(productId);
      const fullProd = getProdRes?.data || {
        id: productId,
        name: newProduct.name,
        sku: skuValue,
        category_id: newProduct.category_id || null,
        cost_price: Number(newProduct.cost_price),
        default_selling_price: Number(newProduct.default_selling_price),
      };

      setProducts((prev) => [...prev, fullProd]);
      addToCart(fullProd);

      setNewProduct({ name: '', sku: '', cost_price: '', default_selling_price: '', category_id: '', opening_stock: '0' });
      setActiveModal(null);
    } catch (err) {
      setModalError(err.message || 'Could not add this product.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const submitNewExpense = async (e) => {
    e.preventDefault();

    setModalError('');

    if (
      !newExpense.category_id ||
      newExpense.amount === ''
    ) {
      setModalError(
        'Category and amount are required.'
      );

      return;
    }

    setModalSubmitting(true);

    try {
      const res = await api.expenses.create({
        business_id: business.id,
        location_id: locationId,
        register_id: register?.id || null,
        category_id: newExpense.category_id,
        expense_date: todayLocal(business?.time_zone),
        expense_from_user_id: profile.id,
        amount: Number(newExpense.amount),
        title:
          newExpense.note?.trim() ||
          expenseCategories.find(
            (c) => c.id === Number(newExpense.category_id)
          )?.name ||
          'POS expense',
        note: newExpense.note || null,
        payment_method: 'Cash',
        status: 'paid',
      });

      if (res?.error) throw new Error(res.error);

      setNewExpense({
        category_id: '',
        amount: '',
        note: '',
      });

      setActiveModal(null);

      setSuccessMsg(
        'Expense recorded.'
      );
    } catch (err) {
      setModalError(
        err.message ||
        'Could not record this expense.'
      );
    } finally {
      setModalSubmitting(false);
    }
  };

  const submitSplitPay = async (e) => {
    e.preventDefault();

    setModalError('');

    const cash = Math.max(
      0,
      Math.round(
        (Number(splitPay.cash) || 0) * 100
      ) / 100
    );

    const card = Math.max(
      0,
      Math.round(
        (Number(splitPay.card) || 0) * 100
      ) / 100
    );

    const sum = cash + card;

    if (sum <= 0) {
      setModalError(
        'Enter at least one amount.'
      );

      return;
    }

    if (
      sum > totals.grandTotal
    ) {
      setModalError(
        'That adds up to more than the total due.'
      );

      return;
    }

    setActiveModal(null);

    await finalizeSale({
      paymentMethodLabel: [
        cash > 0
          ? `Cash ${business.currency
          } ${formatMoney(
            cash
          )}`
          : null,

        card > 0
          ? `Card ${business.currency
          } ${formatMoney(
            card
          )}`
          : null,
      ]
        .filter(Boolean)
        .join(' + '),

      paidAmountValue: sum,
    });

    setSplitPay({
      cash: '',
      card: '',
    });
  };

  const closeReceipt = () => {
    setActiveModal(null);
    setLastSale(null);
  };

  const dateStr = now
    .toLocaleDateString('en-GB')
    .split('/')
    .join('-');

  const timeStr =
    now.toLocaleTimeString(
      undefined,
      {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }
    );
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => { });
      setIsFullscreen(false);
    }
  };

  // Keyboard shortcuts:
  //   Ctrl + Space   → toggle fullscreen
  //   Shift + S      → focus product search
  //   Shift + C      → focus customer search
  //   Shift + F8     → Multi Pay
  //   Shift + F9     → Card
  //   Shift + F10    → Cash
  //   Shift + F11    → Suspend sale
  //   Shift + F12    → Credit sale
  //   Shift + D      → Remove last cart line
  //   Shift + X      → Clear entire cart
  //   Shift + Q      → Save as Quotation
  //   Shift + W      → Save as Draft
  //   Shift + R      → Recent transactions
  //   Shift + A      → Refresh stock
  //   Shift + N      → Focus sale note
  //   Shift + E      → Add expense
  //   Shift + O      → Register report
  //   +  / -         → Increase / decrease qty of last cart line
  //   Enter           → Pay Cash (only when nothing is focused)
  //   Esc             → Close the open modal / shortcuts popover
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl + Space → toggle fullscreen
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => { });
          setIsFullscreen(true);
        } else {
          document.exitFullscreen().catch(() => { });
          setIsFullscreen(false);
        }
        return;
      }

      // Esc → close whichever modal or popover is open
      if (e.key === 'Escape' && activeModal) {
        e.preventDefault();
        setActiveModal(null);
        return;
      }

      if (e.key === 'Escape' && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }

      // Shift + S → focus product search
      if (e.shiftKey && e.code === 'KeyS' && !activeModal) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Shift + B → focus barcode input
      if (e.shiftKey && e.code === 'KeyB' && !activeModal) {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
        return;
      }

      // Shift + C → focus customer search
      if (e.shiftKey && e.code === 'KeyC' && !activeModal) {
        e.preventDefault();
        customerInputRef.current?.focus();
        customerInputRef.current?.select();
        return;
      }

      // Shift + F8 → Multi Pay
      if (e.shiftKey && e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && !activeModal && !submitting) setActiveModal('multiplePay');
        return;
      }

      // Shift + F9 → Card
      if (e.shiftKey && e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && !activeModal && !submitting) payCard();
        return;
      }

      // Shift + F10 → Cash
      if (e.shiftKey && e.key === 'F10') {
        e.preventDefault();
        if (cart.length > 0 && !activeModal && !submitting) payCash();
        return;
      }

      // Shift + F11 → Suspend sale
      if (e.shiftKey && e.key === 'F11') {
        e.preventDefault();
        if (cart.length > 0 && !activeModal && !submitting) suspendSale();
        return;
      }

      // Shift + F12 → Credit sale
      if (e.shiftKey && e.key === 'F12') {
        e.preventDefault();
        if (cart.length > 0 && !activeModal && !submitting) payCredit();
        return;
      }

      // From here on, ignore shortcuts while the person is actively typing
      // in a text field, so letters like D/X/Q/W/R/A/N/E/O still type normally.
      const activeTag = document.activeElement?.tagName;
      const isTyping =
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT';

      // Shift + D → remove last cart line
      if (e.shiftKey && e.code === 'KeyD' && !activeModal && !isTyping) {
        e.preventDefault();
        if (cart.length > 0) removeCartLine(cart.length - 1);
        return;
      }

      // Shift + X → clear entire cart
      if (e.shiftKey && e.code === 'KeyX' && !activeModal && !isTyping) {
        e.preventDefault();
        resetRegister({ confirmFirst: true });
        return;
      }

      // Shift + Q → save as quotation
      if (e.shiftKey && e.code === 'KeyQ' && !activeModal && !isTyping) {
        e.preventDefault();
        if (!submitting) saveAs('quotation');
        return;
      }

      // Shift + W → save as draft
      if (e.shiftKey && e.code === 'KeyW' && !activeModal && !isTyping) {
        e.preventDefault();
        if (!submitting) saveAs('draft');
        return;
      }

      // Shift + R → recent transactions
      if (e.shiftKey && e.code === 'KeyR' && !activeModal && !isTyping) {
        e.preventDefault();
        openRecent();
        return;
      }

      // Shift + A → refresh stock
      if (e.shiftKey && e.code === 'KeyA' && !activeModal && !isTyping) {
        e.preventDefault();
        refreshStock();
        return;
      }

      // Shift + N → focus sale note
      if (e.shiftKey && e.code === 'KeyN' && !activeModal && !isTyping) {
        e.preventDefault();
        saleNoteRef.current?.focus();
        return;
      }

      // Shift + E → add expense
      if (e.shiftKey && e.code === 'KeyE' && !activeModal && !isTyping) {
        e.preventDefault();
        setActiveModal('expense');
        return;
      }

      // Shift + O → register report
      if (e.shiftKey && e.code === 'KeyO' && !activeModal && !isTyping) {
        e.preventDefault();
        if (register) navigate(`/registers/${register.id}`);
        return;
      }

      // + / - → increase / decrease quantity of the last cart line
      if ((e.key === '+' || e.key === '=') && !activeModal && !isTyping) {
        e.preventDefault();
        if (cart.length > 0) {
          const lastIdx = cart.length - 1;
          updateCartQty(lastIdx, Number(cart[lastIdx].quantity) + 1);
        }
        return;
      }

      if ((e.key === '-' || e.key === '_') && !activeModal && !isTyping) {
        e.preventDefault();
        if (cart.length > 0) {
          const lastIdx = cart.length - 1;
          updateCartQty(lastIdx, Number(cart[lastIdx].quantity) - 1);
        }
        return;
      }

      // Enter → pay Cash, only when nothing is focused (avoids clashing
      // with Enter inside search boxes, modals, or other inputs/buttons)
      if (
        e.key === 'Enter' &&
        !activeModal &&
        document.activeElement === document.body
      ) {
        e.preventDefault();
        if (cart.length > 0 && !submitting) payCash();
        return;
      }
    };

    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [cart, activeModal, submitting, register, shortcutsOpen]);

  return (
    <div className="pos-fullscreen">
      <div className="pos-wrap">

        <div className="pos-toolbar">

          <Link
            to="/dashboard"
            className="pos-icon-btn pos-exit-btn"
            title="Back to Dashboard"
          >
            ←
          </Link>

          <div className="pos-toolbar-location">
            <span className="muted">
              Location:
            </span>

            {locations.length > 1 && !register ? (
              <select
                value={locationId}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocationId(val);
                  if (prefLocationKey && val) {
                    localStorage.setItem(prefLocationKey, String(val));
                  }
                  resetRegister();
                }}
              >
                {locations.map((l) => (
                  <option
                    key={l.id}
                    value={l.id}
                  >
                    {l.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong title={register ? 'Locked while your register is open' : undefined}>
                {currentLocationName}
                {register && ' 🔒'}
              </strong>
            )}
          </div>

          <div className="pos-toolbar-clock">
            🕐 {dateStr} {timeStr}
          </div>

          <div className="pos-toolbar-icons">

            {register && (
              <button
                className="pos-icon-btn"
                title="View Register Report"
                onClick={() => navigate(`/registers/${register.id}`)}
              >
                📊
              </button>
            )}
            <button
              className="pos-icon-btn"
              title={
                registerLoading
                  ? 'Checking register…'
                  : register
                    ? `Register open since ${new Date(register.opened_at).toLocaleTimeString()} — click to close`
                    : 'No register open — open one to start selling'
              }
              onClick={() => register && setShowCloseRegister(true)}
            >
              🗄
              {register && (
                <span
                  className="pos-icon-badge"
                  style={{ background: 'var(--success)' }}
                >
                  ●
                </span>
              )}
              {!registerLoading && !register && (
                <span className="pos-icon-badge">!</span>
              )}
            </button>

            <button
              className="pos-icon-btn"
              title="Suspended sales"
              onClick={() =>
                setActiveModal(
                  'suspended'
                )
              }
            >
              ⏪

              {suspendedSales.length >
                0 && (
                  <span className="pos-icon-badge">
                    {
                      suspendedSales.length
                    }
                  </span>
                )}
            </button>

            <button
              className="pos-icon-btn"
              title="Clear sale"
              onClick={() =>
                resetRegister({
                  confirmFirst:
                    true,
                })
              }
            >
              ✕
            </button>

            <button
              className="pos-icon-btn"
              title="Today's summary"
              onClick={openSummary}
            >
              💼
            </button>

            <button
              className="pos-icon-btn"
              title="Keyboard shortcuts"
              onClick={() =>
                setShortcutsOpen(
                  (v) => !v
                )
              }
            >
              ⌨
            </button>

            <button
              className="pos-icon-btn"
              title="Calculator"
              onClick={() =>
                setCalcOpen(
                  (v) => !v
                )
              }
            >
              🧮
            </button>

            <button
              className="pos-icon-btn"
              title="Suspend sale"
              onClick={
                suspendSale
              }
            >
              ⏸
            </button>

            <button
              className="pos-icon-btn"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? '⛶' : '⛶'}
              <span style={{ fontSize: '10px', display: 'block', lineHeight: 1 }}>
                {isFullscreen ? 'Exit FS' : 'Full'}
              </span>
            </button>

            {shortcutsOpen && (
              <div className="pos-shortcuts-popover">
                <div className="pos-shortcuts-popover-header">
                  <strong>Keyboard shortcuts</strong>

                  <button
                    type="button"
                    className="pos-shortcuts-close"
                    onClick={() =>
                      setShortcutsOpen(false)
                    }
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="pos-shortcuts-list">
                  {SHORTCUTS.map((group) => (
                    <div
                      key={group.title}
                      className="pos-shortcuts-group"
                    >
                      <div className="pos-shortcuts-group-title">
                        {group.title}
                      </div>

                      {group.items.map((item) => (
                        <div
                          key={item.key}
                          className="pos-shortcuts-row"
                        >
                          <span className="pos-shortcuts-key">
                            {item.key}
                          </span>

                          <span className="pos-shortcuts-desc">
                            {item.desc}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {calcOpen && (
              <div className="pos-calc-popover">
                <Calculator
                  onClose={() =>
                    setCalcOpen(
                      false
                    )
                  }
                />
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            onClick={() =>
              setActiveModal(
                'expense'
              )
            }
          >
            + Add Expense
          </button>
        </div>

        {/* {!registerLoading && !register && locationId && (
          <div className="error-text pos-alert">
            You don't have a register open. Open one to start selling.
          </div>
        )} */}

        {error && (
          <div className="error-text pos-alert">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="badge badge-success pos-alert">
            {successMsg}
          </div>
        )}

        <div className="pos-main">

          <div className="pos-left-col">

            <section className="pos-cart-panel card">

              <div className="pos-cart-topbar">

                <div
                  className="pos-select-with-add pos-product-search-wrapper"
                  onBlur={(e) => {
                    if (
                      !e.currentTarget.contains(
                        e.relatedTarget
                      )
                    ) {
                      setCustomerSearchFocused(
                        false
                      );

                      const selectedName =
                        customerId
                          ? customers.find(
                            (c) =>
                              c.id ===
                              Number(
                                customerId
                              )
                          )?.name || ''
                          : '';

                      setCustomerSearch(
                        selectedName
                      );
                    }
                  }}
                >

                  <input
                    ref={customerInputRef}
                    placeholder="Search name or number"
                    value={customerSearch}
                    onFocus={() => {
                      setCustomerSearchFocused(
                        true
                      );

                      setCustomerSearch('');
                    }}
                    onChange={(e) => {
                      setCustomerSearch(
                        e.target.value
                      );
                      setCustomerSearchFocused(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setCustomerSearchFocused(
                          false
                        );

                        const selectedName =
                          customerId
                            ? customers.find(
                              (c) =>
                                c.id ===
                                Number(
                                  customerId
                                )
                            )?.name || ''
                            : '';

                        setCustomerSearch(
                          selectedName
                        );

                        return;
                      }

                      if (e.key !== 'Enter')
                        return;

                      e.preventDefault();

                      if (
                        customerSearchResults.length ===
                        0
                      ) {
                        setCustomerId('');
                        setCustomerSearch('');
                        setCustomerSearchFocused(
                          false
                        );

                        return;
                      }

                      const first =
                        customerSearchResults[0];

                      setCustomerId(first.id);
                      setCustomerSearch(
                        first.name
                      );
                      setCustomerSearchFocused(
                        false
                      );
                    }}
                  />

                  <button
                    type="button"
                    className="pos-add-btn"
                    title="Add new customer"
                    onClick={() =>
                      setActiveModal(
                        'customer'
                      )
                    }
                  >
                    +
                  </button>

                  {customerSearchFocused && (
                    <div className="pos-product-search-dropdown">

                      <button
                        type="button"
                        className="pos-search-result"
                        onMouseDown={(e) => {
                          e.preventDefault();

                          setCustomerId('');
                          setCustomerSearch('');
                          setCustomerSearchFocused(
                            false
                          );
                        }}
                      >
                        <div className="pos-search-result-info">
                          <strong>
                            Walk-In Customer
                          </strong>
                        </div>
                      </button>

                      {customerSearchResults.length ===
                        0 ? (
                        <div className="pos-search-empty">
                          No customers found
                        </div>
                      ) : (
                        customerSearchResults.map(
                          (c) => (
                            <button
                              type="button"
                              key={c.id}
                              className="pos-search-result"
                              onMouseDown={(
                                e
                              ) => {
                                e.preventDefault();

                                setCustomerId(
                                  c.id
                                );
                                setCustomerSearch(
                                  c.name
                                );
                                setCustomerSearchFocused(
                                  false
                                );
                              }}
                            >
                              <div className="pos-search-result-info">
                                <strong>
                                  {c.name}
                                </strong>
                                {c.contact_number && (
                                  <div className="muted" style={{ fontSize: '13px', marginTop: '2px' }}>
                                    {c.contact_number}
                                  </div>
                                )}
                                {c.address && (
                                  <div className="muted" style={{ fontSize: '12px', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {c.address}
                                  </div>
                                )}
                              </div>
                            </button>
                          )
                        )
                      )}

                    </div>
                  )}

                </div>

                <div
                  className="pos-select-with-add pos-product-search-wrapper"
                  onBlur={(e) => {
                    if (
                      !e.currentTarget.contains(
                        e.relatedTarget
                      )
                    ) {
                      setSearchFocused(
                        false
                      );

                      setSearchActiveIndex(
                        -1
                      );
                    }
                  }}
                >

                  <input
                    ref={searchInputRef}
                    placeholder="Enter Product name / SKU "
                    value={search}
                    onFocus={() => {
                      setSearchFocused(
                        true
                      );

                      setSearchActiveIndex(
                        -1
                      );
                    }}
                    onChange={(e) => {
                      setSearch(
                        e.target.value
                      );
                      setSearchFocused(true);
                      setSearchActiveIndex(
                        -1
                      );
                    }}
                    onKeyDown={
                      addByBarcode
                    }
                  />

                  <button
                    type="button"
                    className="pos-add-btn"
                    title="Add new product"
                    onClick={() =>
                      setActiveModal(
                        'product'
                      )
                    }
                  >
                    +
                  </button>

                  {searchFocused &&
                    search.trim() && (
                      <div className="pos-product-search-dropdown">

                        {searchDropdownProducts.length ===
                          0 ? (
                          <div className="pos-search-empty">
                            No products found
                          </div>
                        ) : (
                          searchDropdownProducts.map(
                            (product, productIndex) => {
                              const avail =
                                availableQty(
                                  product.id
                                );

                              return (
                                <button
                                  type="button"
                                  key={
                                    product.id
                                  }
                                  className={`pos-search-result ${productIndex ===
                                    searchActiveIndex
                                    ? 'pos-search-result-active'
                                    : ''
                                    }`}
                                  disabled={
                                    avail <=
                                    0
                                  }
                                  onMouseDown={(
                                    e
                                  ) => {
                                    e.preventDefault();

                                    if (
                                      avail >
                                      0
                                    ) {
                                      addToCart(
                                        product
                                      );

                                      setSearch(
                                        ''
                                      );

                                      setSearchFocused(
                                        false
                                      );

                                      setSearchActiveIndex(
                                        -1
                                      );
                                    }
                                  }}
                                >
                                  <div className="pos-search-result-info">

                                    <strong>
                                      {
                                        product.name
                                      }
                                    </strong>

                                    <span>
                                      {
                                        product.sku
                                      }
                                    </span>

                                  </div>

                                  <div
                                    className={`pos-search-result-stock ${avail <=
                                      0
                                      ? 'out-of-stock'
                                      : ''
                                      }`}
                                  >
                                    {avail <=
                                      0
                                      ? 'Out of stock'
                                      : `${avail} Pc(s)`}
                                  </div>
                                </button>
                              );
                            }
                          )
                        )}

                      </div>
                    )}

                </div>

              </div>

              {/* ---------- Barcode scanner input ---------- */}
              <div className={`pos-barcode-row${barcodeReady ? ' pos-barcode-row--ready' : ''}`}>
                <input
                  ref={barcodeInputRef}
                  id="pos-barcode-input"
                  className="pos-barcode-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  // autoFocus puts the scanner in ready state as soon as the
                  // POS loads — cashier can start scanning without clicking.
                  autoFocus
                  placeholder="⬛ Scan barcode or enter manually (Enter to confirm)"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={handleBarcodeScan}
                  onFocus={() => setBarcodeReady(true)}
                  onBlur={() => setBarcodeReady(false)}
                />
                {/* Visual indicator so the cashier knows the scanner is ready */}
                <span
                  className={`pos-barcode-ready-badge${barcodeReady ? ' pos-barcode-ready-badge--on' : ''
                    }`}
                  title={barcodeReady ? 'Scanner ready' : 'Click to activate scanner'}
                >
                  {barcodeReady ? '● READY' : '○ INACTIVE'}
                </span>
                {barcodeMsg.text && (
                  <span
                    className={`pos-barcode-msg pos-barcode-msg--${barcodeMsg.type}`}
                    role="status"
                    aria-live="polite"
                  >
                    {barcodeMsg.type === 'success' ? '✓ ' : '✕ '}
                    {barcodeMsg.text}
                  </span>
                )}
              </div>

              <div className="pos-cart-table-wrap">

                <table className="pos-cart-table">

                  <thead>
                    <tr>
                      <th>
                        Product
                      </th>

                      <th>
                        Price
                      </th>

                      <th>
                        Quantity
                      </th>

                      <th>
                        Subtotal
                      </th>

                      <th></th>
                    </tr>
                  </thead>

                  <tbody>

                    {cart.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="muted pos-cart-empty"
                        >
                          Search or tap a product on the right to add it.
                        </td>
                      </tr>
                    )}

                    {cart.map(
                      (
                        item,
                        idx
                      ) => {
                        const product =
                          productsById[
                          item.product_id
                          ];

                        const c =
                          computeLine(
                            item,
                            taxRatesById,
                            productsById
                          );

                        return (
                          <tr
                            key={idx}
                          >

                            <td>
                              <div className="pos-row-product-name">
                                {
                                  product?.name
                                }
                              </div>

                              <div className="muted pos-row-product-sku">
                                {
                                  product?.sku
                                }
                              </div>
                            </td>

                            <td>
                              <div className="pos-price-control">

                                <span className="pos-price-currency">
                                  {
                                    business?.currency
                                  }
                                </span>

                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="numeric"
                                  className="pos-price-input"
                                  title="Edit the selling price for this sale only — the product's price is unchanged"
                                  value={
                                    item.unit_price
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    updateCartPrice(
                                      idx,
                                      e.target
                                        .value
                                    )
                                  }
                                  onBlur={() =>
                                    revertCartPriceIfBlank(
                                      idx
                                    )
                                  }
                                />

                              </div>

                              {product &&
                                Number(
                                  item.unit_price
                                ) !==
                                Number(
                                  product.default_selling_price
                                ) && (
                                  <div className="pos-price-original">
                                    was{' '}
                                    {
                                      business?.currency
                                    }{' '}
                                    {formatMoney(
                                      product.default_selling_price
                                    )}
                                  </div>
                                )}
                            </td>

                            <td>
                              <div className="pos-qty-control">

                                <button
                                  type="button"
                                  className="pos-qty-btn"
                                  aria-label="Decrease quantity"
                                  onClick={() =>
                                    updateCartQty(
                                      idx,
                                      Number(
                                        item.quantity
                                      ) -
                                      1
                                    )
                                  }
                                >
                                  −
                                </button>

                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  className="pos-qty-input"
                                  value={
                                    item.quantity
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    updateCartQty(
                                      idx,
                                      e.target
                                        .value
                                    )
                                  }
                                />

                                <button
                                  type="button"
                                  className="pos-qty-btn"
                                  aria-label="Increase quantity"
                                  onClick={() =>
                                    updateCartQty(
                                      idx,
                                      Number(
                                        item.quantity
                                      ) +
                                      1
                                    )
                                  }
                                >
                                  +
                                </button>

                              </div>
                            </td>

                            <td className="pos-row-subtotal">
                              {
                                business?.currency
                              }{' '}
                              {formatMoney(
                                c.lineTotal
                              )}
                            </td>

                            <td>
                              <button
                                className="pos-row-remove"
                                onClick={() =>
                                  removeCartLine(
                                    idx
                                  )
                                }
                              >
                                ✕
                              </button>
                            </td>

                          </tr>
                        );
                      }
                    )}

                  </tbody>

                </table>
              </div>

              <div className="pos-totals-block">

                <div className="pos-totals-row pos-totals-row-lg">

                  <span>
                    Items:{' '}
                    <strong>
                      {
                        totals.itemCount
                      }
                    </strong>
                  </span>

                  <span>
                    Total:{' '}
                    <strong>
                      {
                        business?.currency
                      }{' '}
                      {formatMoney(
                        totals.grandTotal
                      )}
                    </strong>
                  </span>

                </div>

                <div className="pos-totals-row pos-totals-row-fields">

                  <div className="pos-payment-buttons">

                    <button
                      type="button"
                      className="pos-pay-btn pos-pay-multi"
                      disabled={
                        submitting
                      }
                      onClick={() =>
                        setActiveModal(
                          'multiplePay'
                        )
                      }
                      title="Multiple Pay (F8)"
                    >
                      ⊞ Multi
                    </button>

                    <button
                      type="button"
                      className="pos-pay-btn pos-pay-card"
                      disabled={
                        submitting
                      }
                      onClick={
                        payCard
                      }
                      title="Card (F9)"
                    >
                      💳 Card
                    </button>

                    <button
                      type="button"
                      className="pos-pay-btn pos-pay-cash"
                      disabled={
                        submitting
                      }
                      onClick={
                        payCash
                      }
                      title="Cash (F10)"
                    >
                      💵 Cash
                    </button>

                  </div>

                  <label>
                    Discount (-):

                    <select
                      value={
                        discountType
                      }
                      onChange={(
                        e
                      ) =>
                        setDiscountType(
                          e.target
                            .value
                        )
                      }
                    >
                      <option value="fixed">
                        {
                          business?.currency
                        }
                      </option>

                      <option value="percentage">
                        %
                      </option>
                    </select>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="numeric"
                      value={
                        discountAmount
                      }
                      onChange={(
                        e
                      ) =>
                        setDiscountAmount(
                          decimalInput(
                            e.target
                              .value
                          )
                        )
                      }
                    />
                  </label>

                  <label>
                    Order Tax (+):{' '}

                    <span className="pos-computed-value">
                      {
                        business?.currency
                      }{' '}
                      {formatMoney(
                        totals.taxAmount
                      )}{' '}

                      <span className="muted">
                        (auto)
                      </span>
                    </span>
                  </label>

                  <label>
                    Shipping (+):

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="numeric"
                      value={
                        shippingCharges
                      }
                      onChange={(
                        e
                      ) =>
                        setShippingCharges(
                          decimalInput(
                            e.target
                              .value
                          )
                        )
                      }
                    />
                  </label>

                  <label className="pos-note-label">
                    Note:
                    <textarea
                      ref={saleNoteRef}
                      className="pos-note-input"
                      placeholder="Optional note (printed on receipt)"
                      rows={2}
                      maxLength={300}
                      value={saleNote}
                      onChange={(e) => setSaleNote(e.target.value)}
                    />
                  </label>

                </div>
              </div>

            </section>

            <div className="pos-footer">

              <div className="pos-footer-quick">

                <button
                  className="pos-quick-btn"
                  disabled={
                    submitting
                  }
                  onClick={() =>
                    saveAs(
                      'draft'
                    )
                  }
                >
                  ✎
                  <span>
                    Draft
                  </span>
                </button>

                <button
                  className="pos-quick-btn"
                  disabled={
                    submitting
                  }
                  onClick={() =>
                    saveAs(
                      'quotation'
                    )
                  }
                >
                  🏷
                  <span>
                    Quotation
                  </span>
                </button>

                <button
                  className="pos-quick-btn"
                  disabled={
                    submitting
                  }
                  onClick={
                    suspendSale
                  }
                >
                  ⏸
                  <span>
                    Suspend
                  </span>
                </button>

                <button
                  className="pos-quick-btn"
                  disabled={
                    submitting
                  }
                  onClick={
                    payCredit
                  }
                >
                  ✓
                  <span>
                    Credit Sale
                  </span>
                </button>

                <button
                  className="pos-quick-btn pos-quick-btn-danger"
                  disabled={
                    submitting
                  }
                  onClick={() =>
                    resetRegister({
                      confirmFirst:
                        true,
                    })
                  }
                >
                  ✕
                  <span>
                    Cancel
                  </span>
                </button>

              </div>

              <button
                className="btn pos-recent-btn"
                onClick={
                  openRecent
                }
              >
                🕐 Recent Transactions
              </button>

            </div>

          </div>

          <section className="pos-product-panel">

            <div
              className="pos-category-tabs"
              onWheel={(e) => {
                if (e.deltaY !== 0) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
            >

              <button
                className={`list-tab ${!categoryFilter
                  ? 'list-tab-active'
                  : ''
                  }`}
                onClick={() =>
                  setCategoryFilter(
                    ''
                  )
                }
              >
                All
              </button>

              {categories.map(
                (c) => (
                  <button
                    key={c.id}
                    className={`list-tab ${categoryFilter ===
                      String(
                        c.id
                      )
                      ? 'list-tab-active'
                      : ''
                      }`}
                    onClick={() =>
                      setCategoryFilter(
                        String(
                          c.id
                        )
                      )
                    }
                  >
                    {c.name}
                  </button>
                )
              )}

            </div>

            <div className="pos-product-grid">

              {filteredProducts.map(
                (p) => {
                  const avail =
                    availableQty(
                      p.id
                    );

                  return (
                    <button
                      key={p.id}
                      className="pos-product-card"
                      disabled={
                        avail <= 0
                      }
                      onClick={() =>
                        addToCart(
                          p
                        )
                      }
                    >
                      <div className="pos-product-thumb">
                        🖼
                      </div>

                      <div className="pos-product-name">
                        {
                          p.name
                        }
                      </div>

                      <div className="muted pos-product-sku">
                        (
                        {
                          p.sku
                        }
                        )
                      </div>

                      <div
                        className={`pos-product-stock ${avail <=
                          0
                          ? 'pos-product-stock-out'
                          : ''
                          }`}
                      >
                        {avail <=
                          0
                          ? 'Out of stock'
                          : `${avail} Pc(s) in stock`}
                      </div>
                    </button>
                  );
                }
              )}

              {filteredProducts.length ===
                0 && (
                  <div
                    className="muted"
                    style={{
                      padding: 24,
                    }}
                  >
                    No products match.
                  </div>
                )}

            </div>

          </section>

        </div>
      </div>

      {/* Keep all your existing modal JSX below this point unchanged. */}

      {/* Customer Modal */}
      {activeModal === 'customer' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>Add customer</h2>

            <form
              onSubmit={
                submitNewCustomer
              }
              className="pos-modal-form"
            >
              <div className="field">
                <label>Name *</label>

                <input
                  value={
                    newCustomer.name
                  }
                  onChange={(e) =>
                    setNewCustomer(
                      (f) => ({
                        ...f,
                        name: e.target
                          .value,
                      })
                    )
                  }
                  autoFocus
                />
              </div>

              <div className="field">
                <label>
                  Contact number *
                </label>

                <input
                  value={
                    newCustomer.contact_number
                  }
                  onChange={(e) =>
                    setNewCustomer(
                      (f) => ({
                        ...f,
                        contact_number:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <label>Address</label>

                <input
                  value={
                    newCustomer.address
                  }
                  onChange={(e) =>
                    setNewCustomer(
                      (f) => ({
                        ...f,
                        address:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              {modalError && (
                <div className="error-text">
                  {modalError}
                </div>
              )}

              <div className="pos-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setActiveModal(
                      null
                    )
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    modalSubmitting
                  }
                >
                  {modalSubmitting
                    ? 'Adding…'
                    : 'Add & select'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Modal — Add new product */}
      {activeModal === 'product' && (
        <div
          className="pos-modal-backdrop"
          onClick={() => {
            setActiveModal(null);
          }}
        >
          <div
            className="pos-modal"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 12 }}>Add Product</h2>

            <form onSubmit={submitNewProduct} className="pos-modal-form">
              <div className="field">
                <label>Product Name *</label>
                <input
                  autoFocus
                  value={newProduct.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewProduct((f) => ({
                      ...f,
                      name,
                      sku: f.sku || autoSku(name),
                    }));
                  }}
                  placeholder="e.g. Wireless Mouse"
                />
              </div>

              <div className="field">
                <label>SKU <span className="muted" style={{ fontSize: 11 }}>(auto-generated, editable)</span></label>
                <input
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct((f) => ({ ...f, sku: e.target.value }))}
                  placeholder={autoSku(newProduct.name) || 'e.g. WRL-A1B2C'}
                />
              </div>

              <div className="field">
                <label>Category</label>
                <select
                  value={newProduct.category_id}
                  onChange={(e) => setNewProduct((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">— No category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label>Cost Price *</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={newProduct.cost_price}
                    onChange={(e) => setNewProduct((f) => ({ ...f, cost_price: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>

                <div className="field">
                  <label>Selling Price *</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={newProduct.default_selling_price}
                    onChange={(e) => setNewProduct((f) => ({ ...f, default_selling_price: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="field">
                <label>Opening Stock <span className="muted" style={{ fontSize: 11 }}>(units at this location)</span></label>
                <input
                  type="number" min="0" step="0.01"
                  value={newProduct.opening_stock}
                  onChange={(e) => setNewProduct((f) => ({ ...f, opening_stock: e.target.value }))}
                  placeholder="0"
                />
              </div>

              {modalError && <div className="error-text">{modalError}</div>}

              <div className="pos-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setActiveModal(null); setNewProduct({ name: '', sku: '', cost_price: '', default_selling_price: '', category_id: '', opening_stock: '0' }); }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={modalSubmitting}>
                  {modalSubmitting ? 'Creating…' : 'Create & Add to Cart'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      {activeModal === 'expense' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>Add expense</h2>

            <form
              onSubmit={
                submitNewExpense
              }
              className="pos-modal-form"
            >
              <div className="field">
                <label>
                  Category *
                </label>

                <select
                  value={
                    newExpense.category_id
                  }
                  onChange={(e) =>
                    setNewExpense(
                      (f) => ({
                        ...f,
                        category_id:
                          e.target.value,
                      })
                    )
                  }
                  autoFocus
                >
                  <option value="">
                    Select…
                  </option>

                  {expenseCategories.map(
                    (c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="field">
                <label>
                  Amount *
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    newExpense.amount
                  }
                  onChange={(e) =>
                    setNewExpense(
                      (f) => ({
                        ...f,
                        amount:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <label>Note</label>

                <input
                  value={
                    newExpense.note
                  }
                  onChange={(e) =>
                    setNewExpense(
                      (f) => ({
                        ...f,
                        note: e.target
                          .value,
                      })
                    )
                  }
                />
              </div>

              <p
                className="muted"
                style={{
                  fontSize: 12,
                }}
              >
                Recorded against{' '}
                {currentLocationName},
                paid by cash.
              </p>

              {modalError && (
                <div className="error-text">
                  {modalError}
                </div>
              )}

              <div className="pos-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setActiveModal(
                      null
                    )
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    modalSubmitting
                  }
                >
                  {modalSubmitting
                    ? 'Saving…'
                    : 'Save expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Multiple Payment Modal */}
      {activeModal === 'multiplePay' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>Split payment</h2>

            <p
              className="muted"
              style={{
                fontSize: 13,
                marginTop: -6,
              }}
            >
              Total due:{' '}
              {
                business?.currency
              }{' '}
              {formatMoney(
                totals.grandTotal
              )}
            </p>

            <form
              onSubmit={
                submitSplitPay
              }
              className="pos-modal-form"
            >
              <div className="field">
                <label>
                  Cash amount
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="numeric"
                  value={
                    splitPay.cash
                  }
                  onChange={(e) =>
                    setSplitPay(
                      (f) => ({
                        ...f,
                        cash:
                          e.target.value,
                      })
                    )
                  }
                  autoFocus
                />
              </div>

              <div className="field">
                <label>
                  Card amount
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="numeric"
                  value={
                    splitPay.card
                  }
                  onChange={(e) =>
                    setSplitPay(
                      (f) => ({
                        ...f,
                        card:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              {modalError && (
                <div className="error-text">
                  {modalError}
                </div>
              )}

              <div className="pos-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setActiveModal(
                      null
                    )
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    submitting
                  }
                >
                  {submitting
                    ? 'Processing…'
                    : 'Complete sale'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recent Transactions Modal */}
      {activeModal === 'recent' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal pos-modal-wide"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>
              Recent transactions
            </h2>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Total</th>
                </tr>
              </thead>

              <tbody>
                {recentSales.length ===
                  0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="muted table-empty"
                      >
                        No POS sales yet.
                      </td>
                    </tr>
                  )}

                {recentSales.map(
                  (s) => (
                    <tr
                      key={s.id}
                    >
                      <td>
                        {
                          s.sale_date
                        }
                      </td>

                      <td>
                        {s.contacts
                          ?.name ||
                          'Walk-in'}
                      </td>

                      <td
                        style={{
                          textTransform:
                            'capitalize',
                        }}
                      >
                        {
                          s.status
                        }
                      </td>

                      <td>
                        {
                          s.payment_method ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          business?.currency
                        }{' '}
                        {formatMoney(
                          s.grand_total
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>

            <div className="pos-modal-actions">
              <Link
                to="/sales"
                className="btn btn-secondary"
              >
                View all in Sales
              </Link>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setActiveModal(
                    null
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspended Sales Modal */}
      {activeModal === 'suspended' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal pos-modal-wide"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>
              Suspended sales
            </h2>

            {suspendedSales.length ===
              0 ? (
              <p className="muted">
                Nothing on hold right now.
                Kept only in this browser tab
                until you resume or reload.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {suspendedSales.map(
                    (s) => (
                      <tr
                        key={s.key}
                      >
                        <td>
                          {
                            s.savedAt
                          }
                        </td>

                        <td>
                          {
                            s.customerName
                          }
                        </td>

                        <td>
                          {
                            s.itemCount
                          }
                        </td>

                        <td>
                          {
                            business?.currency
                          }{' '}
                          {formatMoney(
                            s.total
                          )}
                        </td>

                        <td className="table-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              resumeSuspended(
                                s.key
                              )
                            }
                          >
                            Resume
                          </button>

                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              discardSuspended(
                                s.key
                              )
                            }
                          >
                            Discard
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            <div className="pos-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setActiveModal(
                    null
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today's Summary Modal */}
      {activeModal === 'summary' && (
        <div
          className="pos-modal-backdrop"
          onClick={() =>
            setActiveModal(null)
          }
        >
          <div
            className="pos-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <h2>
              Today at{' '}
              {
                currentLocationName
              }
            </h2>

            {!todaySummary ? (
              <p className="muted">
                Loading…
              </p>
            ) : (
              <div
                className="summary-grid"
                style={{
                  gridTemplateColumns:
                    '1fr 1fr',
                  marginTop: 12,
                }}
              >
                <div className="summary-card">
                  <div className="summary-card-label">
                    Transactions
                  </div>

                  <div className="summary-card-value">
                    {
                      todaySummary.count
                    }
                  </div>
                </div>

                <div className="summary-card">
                  <div className="summary-card-label">
                    Total sales
                  </div>

                  <div className="summary-card-value">
                    {
                      business?.currency
                    }{' '}
                    {formatMoney(
                      todaySummary.total
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="pos-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setActiveModal(
                    null
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completed Sale / Print Invoice Modal */}
      {activeModal === 'receipt' &&
        lastSale && (
          <div
            className="pos-modal-backdrop"
            onClick={
              closeReceipt
            }
          >
            <div
              className="pos-modal pos-receipt-modal"
              onClick={(e) =>
                e.stopPropagation()
              }
            >
              <div className="pos-receipt-success">
                <div className="pos-receipt-success-icon">
                  ✓
                </div>

                <h2>
                  Sale completed
                </h2>

                <p className="muted">
                  Sale #
                  {
                    lastSale.sale
                      .id
                  }{' '}
                  —{' '}
                  {
                    business?.currency
                  }{' '}
                  {formatMoney(
                    lastSale.sale
                      .grand_total
                  )}
                </p>
              </div>

              <div className="pos-modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeReceipt}
                >
                  Close
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const printPayload = {
                      business: {
                        name: business?.business_name || business?.name || '',
                        business_name: business?.business_name || business?.name || '',
                        address: business?.landmark || business?.address || '',
                        city: business?.city || '',
                        country: business?.country || '',
                        contact_number: business?.contact_number || '',
                      },
                      sale: lastSale.sale,
                      items: lastSale.items,
                      customer: lastSale.customer,
                      seller: {
                        name: profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
                        contact_number: profile?.mobile_number || profile?.contact_number || '',
                      },
                      footerNote: business?.settings?.invoice_footer_note || 'Thank you for shopping with us!',
                      saleNote: lastSale.note || '',
                    };
                    printSaleInvoice(printPayload);
                  }}
                >
                  🖨 Full Page (A4)
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const printPayload = {
                      business: {
                        name: business?.business_name || business?.name || '',
                        business_name: business?.business_name || business?.name || '',
                        address: business?.landmark || business?.address || '',
                        city: business?.city || '',
                        country: business?.country || '',
                        contact_number: business?.contact_number || '',
                      },
                      sale: lastSale.sale,
                      items: lastSale.items,
                      customer: lastSale.customer,
                      seller: {
                        name: profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
                        contact_number: profile?.mobile_number || profile?.contact_number || '',
                      },
                      footerNote: business?.settings?.receipt_footer_note || business?.settings?.invoice_footer_note || 'Thank you for shopping with us!',
                      saleNote: lastSale.note || '',
                    };
                    printThermalSaleInvoice(printPayload);
                  }}
                >
                  🧾 Thermal Receipt (80mm)
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Open Register Modal — hidden / disabled */}
      {/* {showOpenRegister && locationId && !registerLoading && (
        <OpenRegisterModal
          locationName={currentLocationName}
          locations={locations}
          selectedLocationId={locationId}
          onLocationChange={(newLoc) => {
            setLocationId(newLoc);
            if (prefLocationKey && newLoc) {
              localStorage.setItem(prefLocationKey, String(newLoc));
            }
          }}
          submitting={registerSubmitting}
          onCancel={() => setShowOpenRegister(false)}
          onConfirm={async (amt, chosenLocId) => {
            setRegisterSubmitting(true);
            setError('');
            const targetLoc = chosenLocId || locationId;
            try {
              await openRegister(targetLoc, amt);
              setLocationId(targetLoc);
              if (prefLocationKey && targetLoc) {
                localStorage.setItem(prefLocationKey, String(targetLoc));
              }
              setShowOpenRegister(false);
            } catch (err) {
              setError(err.message || 'Could not open register.');
            } finally {
              setRegisterSubmitting(false);
            }
          }}
        />
      )} */}

      {/* Close Register Modal */}
      {showCloseRegister && register && (
        <CloseRegisterModal
          register={register}
          business={business}
          submitting={registerSubmitting}
          onCancel={() => setShowCloseRegister(false)}
          onConfirm={async (amt) => {
            setRegisterSubmitting(true);
            setError('');
            try {
              const closed = await closeRegister(amt);
              setShowCloseRegister(false);
              navigate(`/registers/${closed.id}`);
            } catch (err) {
              setError(err.message || 'Could not close register.');
            } finally {
              setRegisterSubmitting(false);
            }
          }}
        />
      )}

    </div>
  );
}