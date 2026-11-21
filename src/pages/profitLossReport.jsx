import { useEffect, useMemo, useState } from 'react';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { getPresetRange, PRESETS } from '../lib/dateRanges.js';
import PrintReportHeader from '../components/PrintReportHeader.jsx';
import { downloadPDF, buildPdfFilename } from '../utils/pdfGenerator.js';
import { toLocalDate } from '../lib/timezone.js';
import useLocationScope from '../hooks/useLocationScope.js';

export default function ProfitLossReport() {
  const { business } = useAuth();
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();
  const [range, setRange] = useState(getPresetRange('this_month', business?.time_zone));
  const [activePreset, setActivePreset] = useState('this_month');
  const [locationId, setLocationId] = useState('');

  // Data lists from DB
  const [locations, setLocations] = useState([]);
  const [sales, setSales] = useState([]);
  const [saleItems, setSaleItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [stockLedger, setStockLedger] = useState([]);
  const [sellReturns, setSellReturns] = useState([]);
  const [purchaseReturns, setPurchaseReturns] = useState([]);
  const [sellReturnItems, setSellReturnItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contacts, setContacts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tabs and search for detailed breakdowns
  const [activeTab, setActiveTab] = useState('products');
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api.reports.getProfitLoss({ businessId: business.id });
      if (err) throw new Error(err);

      setLocations((data?.locations || []).filter((l) => l.is_active !== 0 && l.is_active !== false));
      setSales(data?.sales || []);
      setSaleItems(data?.saleItems || []);
      setPurchases(data?.purchases || []);
      setPurchaseItems(data?.purchaseItems || []);
      setExpenses(data?.expenses || []);
      setStockLedger(data?.stockLedger || []);
      setSellReturns(data?.sellReturns || []);
      setSellReturnItems(data?.sellReturnItems || []);
      setPurchaseReturns(data?.purchaseReturns || []);
      setProducts(data?.products || []);
      setCategories(data?.categories || []);
      setContacts(data?.contacts || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Error loading report data');
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);


  const handlePresetSelect = (presetKey) => {
  setActivePreset(presetKey);
  if (presetKey === 'custom') return;
  setRange(getPresetRange(presetKey, business?.time_zone));
};

const calculations = useMemo(() => {
  // 1. Helper filters
  const inDateRange = (dateStr) => {
    if (!dateStr) return false;
    const date = dateStr.slice(0, 10);
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  };

  const matchLocation = (itemLocId) => {
    if (isScopedToLocation) {
      if (scopedLocationIds.length === 0) return false;
      return scopedLocationIds.includes(itemLocId);
    }
    if (!locationId) return true;
    return String(itemLocId) === String(locationId);
  };

  // 2. Lookup Maps
  const productsMap = {};
  products.forEach((p) => {
    productsMap[p.id] = p;
  });

  const purchaseItemsByProduct = {};
  purchaseItems.forEach((pi) => {
    const pid = String(pi.product_id);
    if (!purchaseItemsByProduct[pid]) {
      purchaseItemsByProduct[pid] = { qty: 0, value: 0 };
    }
    const qty = Number(pi.quantity || 0);
    const unitCost = Number(pi.unit_cost || 0);
    purchaseItemsByProduct[pid].qty += qty;
    purchaseItemsByProduct[pid].value += qty * unitCost;
  });

  const saleItemsByProduct = {};
  saleItems.forEach((si) => {
    const pid = String(si.product_id);
    if (!saleItemsByProduct[pid]) {
      saleItemsByProduct[pid] = { qty: 0, value: 0 };
    }
    const qty = Number(si.quantity || 0);
    const lineTotal = Number(si.line_total || 0);
    saleItemsByProduct[pid].qty += qty;
    saleItemsByProduct[pid].value += lineTotal;
  });

  const getWeightedAverageCost = (productId) => {
    const pid = String(productId);
    const bucket = purchaseItemsByProduct[pid];
    if (bucket && bucket.qty > 0) {
      return bucket.value / bucket.qty;
    }
    return Number(productsMap[productId]?.cost_price || 0);
  };

  const getWeightedAverageSalePrice = (productId) => {
    const pid = String(productId);
    const bucket = saleItemsByProduct[pid];
    if (bucket && bucket.qty > 0) {
      return bucket.value / bucket.qty;
    }
    return Number(productsMap[productId]?.default_selling_price || 0);
  };

  const purchasesMap = {};
  purchases.forEach((p) => {
    purchasesMap[p.id] = p;
  });

  const salesMap = {};
  sales.forEach((s) => {
    salesMap[s.id] = s;
  });

  // 3. Filter Records
  const filteredSales = sales.filter((s) => matchLocation(s.location_id) && inDateRange(s.sale_date));
  const filteredPurchases = purchases.filter((p) => matchLocation(p.location_id) && inDateRange(p.purchase_date));
  const filteredExpenses = expenses.filter((e) => matchLocation(e.location_id) && inDateRange(e.expense_date));
  // sell_returns has no location_id column of its own — resolve it
  // through the parent sale, same pattern purchase_returns already
  // uses via purchasesMap below.
  const filteredSellReturns = sellReturns.filter((sr) => {
    const parentLoc = sr.sale_id ? salesMap[sr.sale_id]?.location_id : null;
    return matchLocation(parentLoc) && inDateRange(sr.return_date);
  });
  const filteredPurchaseReturns = purchaseReturns.filter((pr) => {
    const parentLoc = pr.purchase_id ? purchasesMap[pr.purchase_id]?.location_id : null;
    return matchLocation(parentLoc) && inDateRange(pr.return_date);
  });

  // ── Sales Profit (simple: selling price − purchase cost per item) ──
  // This is the same figure you'd get by summing the "Profit" column
  // in any of the breakdown tabs (products, dates, invoices, etc.).
  const filteredSaleIds = new Set(filteredSales.map((s) => s.id));
  const periodSaleItemsForProfit = saleItems.filter((si) => filteredSaleIds.has(si.sale_id));

  // Build a quick map of returned qty/amount per sale_item_id within
  // the filtered sell-return period so we can net them out.
  const filteredSrIds = new Set(filteredSellReturns.map(sr => sr.id));
  const returnsBySaleItemCalc = {};
  // sellReturnItems comes from the outer scope (component state)
  sellReturnItems.forEach(sri => {
    if (filteredSrIds.has(sri.sell_return_id)) {
      if (!returnsBySaleItemCalc[sri.sale_item_id]) {
        returnsBySaleItemCalc[sri.sale_item_id] = { qty: 0, amount: 0 };
      }
      returnsBySaleItemCalc[sri.sale_item_id].qty += Number(sri.quantity_returned) || 0;
      returnsBySaleItemCalc[sri.sale_item_id].amount += Number(sri.amount) || 0;
    }
  });

  let totalSalesProfit = 0;
  periodSaleItemsForProfit.forEach((si) => {
    const prod = productsMap[si.product_id];
    const returns = returnsBySaleItemCalc[si.id] || { qty: 0, amount: 0 };
    const netQty = (Number(si.quantity) || 0) - returns.qty;
    const netSalesAmt = (Number(si.line_total) || 0) - returns.amount;
    const cost = Number(si.unit_cost) || (prod ? (Number(prod.cost_price) || 0) : 0);
    totalSalesProfit += netSalesAmt - (netQty * cost);
  });

  // 4. Ledger-based Inventory Calculations
  const ledgerByLocation = stockLedger.filter((sl) => matchLocation(sl.location_id));

  const openingQuantities = {};
  const closingQuantities = {};

  ledgerByLocation.forEach((sl) => {
    const ledgerDate = sl.created_at ? toLocalDate(sl.created_at, business?.time_zone) : '';
    const qty = Number(sl.change_qty) || 0;

    if (range.from && ledgerDate < range.from) {
      openingQuantities[sl.product_id] = (openingQuantities[sl.product_id] || 0) + qty;
    }
    if (!range.to || ledgerDate <= range.to) {
      closingQuantities[sl.product_id] = (closingQuantities[sl.product_id] || 0) + qty;
    }
  });

  let openingStockPurchaseVal = 0;
  let openingStockSaleVal = 0;
  Object.entries(openingQuantities).forEach(([pId, qty]) => {
    const prod = productsMap[pId];
    if (prod) {
      const avgCost = getWeightedAverageCost(pId);
      const avgSellPrice = getWeightedAverageSalePrice(pId);
      openingStockPurchaseVal += qty * avgCost;
      openingStockSaleVal += qty * avgSellPrice;
    }
  });

  let closingStockPurchaseVal = 0;
  let closingStockSaleVal = 0;
  Object.entries(closingQuantities).forEach(([pId, qty]) => {
    const prod = productsMap[pId];
    if (prod) {
      const avgCost = getWeightedAverageCost(pId);
      const avgSellPrice = getWeightedAverageSalePrice(pId);
      closingStockPurchaseVal += qty * avgCost;
      closingStockSaleVal += qty * avgSellPrice;
    }
  });

  // 5. Aggregate calculations
  const totalPurchases = filteredPurchases.reduce((sum, p) => sum + (Number(p.grand_total) || 0), 0);

  const periodAdjustments = ledgerByLocation.filter((sl) => {
    const ledgerDate = sl.created_at ? toLocalDate(sl.created_at, business?.time_zone) : '';
    return sl.reason === 'adjustment' && inDateRange(ledgerDate);
  });

  const totalStockAdjustmentVal = periodAdjustments.reduce((sum, sl) => {
    // Prefer the cost frozen on the row at the moment of the adjustment
    // (see stock.jsx) — using today's product.cost_price instead would
    // mean changing a product's price later silently rewrites the value
    // of past adjustments in every prior period's P&L, exactly the bug
    // already fixed for sale_items.unit_cost. Only rows created before
    // stock_ledger.unit_cost existed fall back to the live cost_price.
    const prod = productsMap[sl.product_id];
    const cost = sl.unit_cost != null
      ? Number(sl.unit_cost)
      : (prod ? Number(prod.cost_price) || 0 : 0);
    return sum + (-Number(sl.change_qty) * cost);
  }, 0);

  const totalExpense = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // sell_returns uses `total_amount`, not `grand_total` — that column
  // doesn't exist on this row, so this was always silently 0 before.
  const totalSellReturnVal = filteredSellReturns.reduce((sum, sr) => sum + (Number(sr.total_amount) || 0), 0);

  // purchase_returns was being filtered but never summed or applied
  // to the profit formula at all.
  const totalPurchaseReturnVal = filteredPurchaseReturns.reduce((sum, pr) => sum + (Number(pr.total_amount) || 0), 0);

  const totalPurchaseShippingCharge = filteredPurchases.reduce((sum, p) => sum + (Number(p.shipping_charges) || 0), 0);
  const totalSales = filteredSales.reduce((sum, s) => sum + (Number(s.grand_total) || 0), 0);

  // formulas
  // grand_total on both sales and purchases already nets out discount,
  // adds tax, and adds shipping (per schema) — so cogs/grossProfit
  // below are already shipping- and discount-correct. Nothing further
  // below should add shipping/discount again.
  const cogs = openingStockPurchaseVal + totalPurchases - closingStockPurchaseVal;

  // Net Sales accounts for returns
  const netSales = totalSales - totalSellReturnVal;
  const grossProfit = netSales - cogs;

  // Kept for informational display in the UI cards only — these are
  // NOT added into credits/debits below because they're already
  // embedded inside totalSales/totalPurchases via grand_total.
  const totalSellShippingCharge = filteredSales.reduce((sum, s) => sum + (Number(s.shipping_charges) || 0), 0);
  const sellAdditionalExpenses = 0;
  const totalStockRecovered = 0;
  const totalPurchaseDiscount = filteredPurchases.reduce((sum, p) => sum + (Number(p.discount_amount) || 0), 0);
  const totalSellRoundOff = 0;

  const totalTransferShippingCharge = 0;
  const purchaseAdditionalExpenses = 0;
  const totalSellDiscount = filteredSales.reduce((sum, s) => sum + (Number(s.discount_amount) || 0), 0);
  const totalCustomerReward = 0;

  // Sell returns are already netted out from Gross Profit above (via netSales).
  // Purchase returns are handled differently: purchases.grand_total is
  // reduced directly at the moment of return (see purchases.jsx
  // submitReturn), so totalPurchases above — and therefore cogs below —
  // already excludes the returned value. 
  const credits = sellAdditionalExpenses + totalStockRecovered + totalSellRoundOff;

  // totalStockAdjustmentVal is intentionally NOT included here. Every
  // adjustment ledger row already changes the product's on-hand quantity,
  // which flows straight into closingStockPurchaseVal above — and COGS
  // (openingStockPurchaseVal + totalPurchases - closingStockPurchaseVal)
  // already reflects that change. Adding totalStockAdjustmentVal into debits
  // as well double-counted every adjustment: once through the closing-stock
  // valuation, once again here.
  const debits = totalExpense + totalTransferShippingCharge + purchaseAdditionalExpenses + totalCustomerReward;

  const netProfit = grossProfit + credits - debits;

  return {
    openingStockPurchaseVal,
    openingStockSaleVal,
    totalPurchases,
    totalStockAdjustmentVal,
    totalExpense,
    totalSellReturnVal,
    totalPurchaseReturnVal,
    totalPurchaseShippingCharge,
    closingStockPurchaseVal,
    closingStockSaleVal,
    totalSales,
    cogs,
    grossProfit,
    totalSellShippingCharge,
    sellAdditionalExpenses,
    totalStockRecovered,
    totalPurchaseDiscount,
    totalSellRoundOff,
    totalTransferShippingCharge,
    purchaseAdditionalExpenses,
    totalSellDiscount,
    totalCustomerReward,
    netProfit,
    totalSalesProfit,
    filteredSales,
    filteredPurchases,
    filteredExpenses,
    filteredSellReturns,
    filteredPurchaseReturns,
    productsMap,
    purchasesMap
  };
}, [sales, saleItems, purchases, purchaseItems, expenses, stockLedger, sellReturns, sellReturnItems, purchaseReturns, products, range, locationId]);

// Interactive Detailed Tab calculations
const breakdownLists = useMemo(() => {
  const { filteredSales, productsMap } = calculations;
  const filteredSaleIds = new Set(filteredSales.map((s) => s.id));
  const periodSaleItems = saleItems.filter((si) => filteredSaleIds.has(si.sale_id));

  const saleItemsBySaleId = {};
  periodSaleItems.forEach((si) => {
    if (!saleItemsBySaleId[si.sale_id]) saleItemsBySaleId[si.sale_id] = [];
    saleItemsBySaleId[si.sale_id].push(si);
  });

  const categoriesMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const contactsMap = Object.fromEntries(contacts.map((c) => [c.id, c.name]));
  const locationsMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const returnedAmountBySaleId = {};
  calculations.filteredSellReturns.forEach((sellReturn) => {
    returnedAmountBySaleId[sellReturn.sale_id] =
      (returnedAmountBySaleId[sellReturn.sale_id] || 0) +
      (Number(sellReturn.total_amount) || 0);
  });

  // Helper: Map returned quantities and amounts by sale_item_id
  const returnsBySaleItem = {};
  const filteredSrIds = new Set(calculations.filteredSellReturns.map(sr => sr.id));
  sellReturnItems.forEach(sri => {
    if (filteredSrIds.has(sri.sell_return_id)) {
      if (!returnsBySaleItem[sri.sale_item_id]) {
        returnsBySaleItem[sri.sale_item_id] = { qty: 0, amount: 0 };
      }
      returnsBySaleItem[sri.sale_item_id].qty += Number(sri.quantity_returned) || 0;
      returnsBySaleItem[sri.sale_item_id].amount += Number(sri.amount) || 0;
    }
  });

  // 1. Products
  const prodData = {};
  periodSaleItems.forEach((si) => {
    const prod = productsMap[si.product_id];
    if (!prod) return;

    const returns = returnsBySaleItem[si.id] || { qty: 0, amount: 0 };
    const netQty = (Number(si.quantity) || 0) - returns.qty;
    const netSales = (Number(si.line_total) || 0) - returns.amount;

    const cost = Number(si.unit_cost) || (Number(prod.cost_price) || 0);

    if (!prodData[si.product_id]) {
      prodData[si.product_id] = { id: si.product_id, name: prod.name, sku: prod.sku || '—', qty: 0, sales: 0, cost: 0, profit: 0 };
    }
    prodData[si.product_id].qty += netQty;
    prodData[si.product_id].sales += netSales;
    prodData[si.product_id].cost += netQty * cost;
    prodData[si.product_id].profit = prodData[si.product_id].sales - prodData[si.product_id].cost;
  });

  // 2. Categories
  const catData = {};
  periodSaleItems.forEach((si) => {
    const prod = productsMap[si.product_id];
    const name = prod && categoriesMap[prod.category_id] ? categoriesMap[prod.category_id] : 'Uncategorized';

    const returns = returnsBySaleItem[si.id] || { qty: 0, amount: 0 };
    const netQty = (Number(si.quantity) || 0) - returns.qty;
    const netSales = (Number(si.line_total) || 0) - returns.amount;

    const cost = Number(si.unit_cost) || (prod ? (Number(prod.cost_price) || 0) : 0);

    if (!catData[name]) {
      catData[name] = { name, qty: 0, sales: 0, cost: 0, profit: 0 };
    }
    catData[name].qty += netQty;
    catData[name].sales += netSales;
    catData[name].cost += netQty * cost;
    catData[name].profit = catData[name].sales - catData[name].cost;
  });

  // 3. Brands (calculated from product name's first word)
  const brandData = {};
  periodSaleItems.forEach((si) => {
    const prod = productsMap[si.product_id];
    let brand = 'Default';
    if (prod && prod.name) {
      const word = prod.name.trim().split(/\s+/)[0];
      if (word && word.length > 2) brand = word;
    }

    const returns = returnsBySaleItem[si.id] || { qty: 0, amount: 0 };
    const netQty = (Number(si.quantity) || 0) - returns.qty;
    const netSales = (Number(si.line_total) || 0) - returns.amount;

    const cost = Number(si.unit_cost) || (prod ? (Number(prod.cost_price) || 0) : 0);

    if (!brandData[brand]) {
      brandData[brand] = { name: brand, qty: 0, sales: 0, cost: 0, profit: 0 };
    }
    brandData[brand].qty += netQty;
    brandData[brand].sales += netSales;
    brandData[brand].cost += netQty * cost;
    brandData[brand].profit = brandData[brand].sales - brandData[brand].cost;
  });

  // 4. Locations
  const locData = {};
  filteredSales.forEach((s) => {
    const name = locationsMap[s.location_id] || 'Default Location';
    const items = saleItemsBySaleId[s.id] || [];

    let netRevenue = Number(s.grand_total) || 0;
    // Deduct return amount for this sale
    const returnedAmount = returnedAmountBySaleId[s.id] || 0;
    netRevenue -= returnedAmount;

    const cost = items.reduce((sum, si) => {
      const prod = productsMap[si.product_id];
      const returns = returnsBySaleItem[si.id] || { qty: 0 };
      const netQty = (Number(si.quantity) || 0) - returns.qty;
      const unitCost = Number(si.unit_cost) || (prod ? Number(prod.cost_price) || 0 : 0);
      return sum + (netQty * unitCost);
    }, 0);

    if (!locData[name]) {
      locData[name] = { name, sales: 0, cost: 0, profit: 0 };
    }
    locData[name].sales += netRevenue;
    locData[name].cost += cost;
    locData[name].profit = locData[name].sales - locData[name].cost;
  });

  // 5. Invoices
  const invoiceList = filteredSales.map((s) => {
    const items = saleItemsBySaleId[s.id] || [];
    let netRevenue = Number(s.grand_total) || 0;
    // Deduct return amount for this sale
    const returnedAmount = returnedAmountBySaleId[s.id] || 0;
    netRevenue -= returnedAmount;

    const cost = items.reduce((sum, si) => {
      const prod = productsMap[si.product_id];
      const returns = returnsBySaleItem[si.id] || { qty: 0 };
      const netQty = (Number(si.quantity) || 0) - returns.qty;
      const unitCost = Number(si.unit_cost) || (prod ? Number(prod.cost_price) || 0 : 0);
      return sum + (netQty * unitCost);
    }, 0);
    return {
      invoiceNo: s.invoice_no || `Sale #${s.id}`,
      date: s.sale_date,
      customer: contactsMap[s.customer_id] || 'Walk-in',
      sales: netRevenue,
      cost,
      profit: netRevenue - cost
    };
  });

  // 6. Dates
  const dateData = {};
  filteredSales.forEach((s) => {
    const key = s.sale_date;
    const items = saleItemsBySaleId[s.id] || [];
    let netRevenue = Number(s.grand_total) || 0;
    // Deduct return amount for this sale
    const returnedAmount = returnedAmountBySaleId[s.id] || 0;
    netRevenue -= returnedAmount;

    const cost = items.reduce((sum, si) => {
      const prod = productsMap[si.product_id];
      const returns = returnsBySaleItem[si.id] || { qty: 0 };
      const netQty = (Number(si.quantity) || 0) - returns.qty;
      const unitCost = Number(si.unit_cost) || (prod ? Number(prod.cost_price) || 0 : 0);
      return sum + (netQty * unitCost);
    }, 0);

    if (!dateData[key]) {
      dateData[key] = { name: key, sales: 0, cost: 0, profit: 0 };
    }
    dateData[key].sales += netRevenue;
    dateData[key].cost += cost;
    dateData[key].profit = dateData[key].sales - dateData[key].cost;
  });

  // 7. Customers
  const custData = {};
  filteredSales.forEach((s) => {
    const name = contactsMap[s.customer_id] || 'Walk-in';
    const items = saleItemsBySaleId[s.id] || [];
    let netRevenue = Number(s.grand_total) || 0;
    // Deduct return amount for this sale
    const returnedAmount = returnedAmountBySaleId[s.id] || 0;
    netRevenue -= returnedAmount;

    const cost = items.reduce((sum, si) => {
      const prod = productsMap[si.product_id];
      const returns = returnsBySaleItem[si.id] || { qty: 0 };
      const netQty = (Number(si.quantity) || 0) - returns.qty;
      const unitCost = Number(si.unit_cost) || (prod ? Number(prod.cost_price) || 0 : 0);
      return sum + (netQty * unitCost);
    }, 0);

    if (!custData[name]) {
      custData[name] = { name, sales: 0, cost: 0, profit: 0 };
    }
    custData[name].sales += netRevenue;
    custData[name].cost += cost;
    custData[name].profit = custData[name].sales - custData[name].cost;
  });

  // 8. Day
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayData = dayNames.map((name) => ({ name, sales: 0, cost: 0, profit: 0 }));
  filteredSales.forEach((s) => {
    const dayIdx = new Date(s.sale_date).getDay();
    const item = dayData[isNaN(dayIdx) ? 0 : dayIdx];
    const items = saleItemsBySaleId[s.id] || [];
    let netRevenue = Number(s.grand_total) || 0;
    // Deduct return amount for this sale
    const returnedAmount = returnedAmountBySaleId[s.id] || 0;
    netRevenue -= returnedAmount;

    const cost = items.reduce((sum, si) => {
      const prod = productsMap[si.product_id];
      const returns = returnsBySaleItem[si.id] || { qty: 0 };
      const netQty = (Number(si.quantity) || 0) - returns.qty;
      const unitCost = Number(si.unit_cost) || (prod ? Number(prod.cost_price) || 0 : 0);
      return sum + (netQty * unitCost);
    }, 0);

    item.sales += netRevenue;
    item.cost += cost;
    item.profit = item.sales - item.cost;
  });

  return {
    products: Object.values(prodData).sort((a, b) => b.profit - a.profit),
    categories: Object.values(catData).sort((a, b) => b.profit - a.profit),
    brands: Object.values(brandData).sort((a, b) => b.profit - a.profit),
    locations: Object.values(locData).sort((a, b) => b.profit - a.profit),
    invoices: invoiceList.sort((a, b) => b.profit - a.profit),
    dates: Object.values(dateData).sort((a, b) => b.name.localeCompare(a.name)),
    customers: Object.values(custData).sort((a, b) => b.profit - a.profit),
    days: dayData
  };
}, [saleItems, categories, contacts, locations, calculations, sellReturnItems]);

// Client-side search match helper
const filterBySearch = (list, textFields) => {
  if (!searchTerm) return list;
  const term = searchTerm.toLowerCase();
  return list.filter((item) =>
    textFields.some((f) => String(item[f] || '').toLowerCase().includes(term))
  );

};

return (
  <AppLayout>
    {/* Self-contained responsive dashboard CSS overrides */}
    <style>{`
        .pl-wrapper {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: -8px; /* Offset original layout spacing */
        }
        .pl-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          background: var(--white);
          padding: 8px 16px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          box-shadow: var(--shadow-sm);
        }
        .pl-title-area h1 {
          font-size: 18px;
          font-weight: 700;
          color: var(--navy-900);
        }
        .pl-title-area p {
          font-size: 12px;
          margin: 1px 0 0;
          color: var(--text-secondary);
        }
        .pl-header-filters {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pl-filter-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .pl-filter-item label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .pl-select-input, .pl-date-input {
          padding: 5px 8px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--navy-border);
          font-size: 12px;
          outline: none;
          background: var(--white);
        }
        .pl-summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .pl-card {
          background: var(--white);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          box-shadow: var(--shadow-sm);
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .pl-card-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--navy-800);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--navy-50);
          padding-bottom: 6px;
          margin-bottom: 6px;
        }
        .pl-ledger-table {
          width: 100%;
          border-collapse: collapse;
        }
        .pl-ledger-table td {
          padding: 6px 0;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .pl-ledger-table tr:not(:last-child) td {
          border-bottom: 1px dashed var(--navy-50);
        }
        .pl-ledger-table td.amount-val {
          text-align: right;
          font-weight: 600;
          color: var(--text-primary);
        }
        .pl-statement-box {
          background: var(--navy-50);
          border-radius: var(--radius-sm);
          padding: 10px;
          margin-top: 10px;
          border-left: 3px solid var(--navy-600);
        }
        .pl-statement-box.success-border {
          border-left-color: var(--success);
          background: var(--success-bg);
        }
        .pl-statement-item {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 700;
          color: var(--navy-900);
        }
        .pl-statement-eq {
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
          margin-top: 1px;
        }
        .pl-tabs-container {
          background: var(--white);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          padding: 12px 16px;
          box-shadow: var(--shadow-sm);
        }
        .pl-tabs-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          border-bottom: 1px solid var(--border-light);
          padding-bottom: 8px;
        }
        .pl-tabs-list {
          display: flex;
          gap: 4px;
          overflow-x: auto;
        }
        .pl-tab-button {
          background: none;
          border: none;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          white-space: nowrap;
          transition: all 0.1s ease;
        }
        .pl-tab-button:hover {
          background: var(--navy-50);
          color: var(--navy-900);
        }
        .pl-tab-button.active {
          background: var(--navy-800);
          color: var(--white);
        }
        .pl-search-input {
          padding: 5px 10px;
          font-size: 12px;
          border: 1px solid var(--navy-border);
          border-radius: var(--radius-sm);
          width: 180px;
          outline: none;
        }
        @media (max-width: 768px) {
          .pl-summary-grid {
            grid-template-columns: 1fr;
          }
          .pl-header-row {
            flex-direction: column;
            align-items: stretch;
            padding: 10px;
          }
          .pl-header-filters {
            justify-content: space-between;
          }
          .pl-search-input {
            width: 100%;
          }
        }
        .print-only {
          display: none !important;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .pl-wrapper {
            margin-top: 0 !important;
            gap: 16px !important;
          }
          .pl-header-row {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin-bottom: 12px !important;
          }
          .pl-summary-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 16px !important;
          }
          .pl-card {
            box-shadow: none !important;
            border: 1px solid #ddd !important;
            padding: 10px 14px !important;
          }
          .pl-statement-box {
            margin-top: 6px !important;
            padding: 6px 10px !important;
          }
          .pl-tabs-container {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin-top: 16px !important;
          }
          .data-table th {
            background-color: #f3f4f6 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

    <div className="pl-wrapper">
      {/* Compact, Space-saving Header Filter Bar */}
      {/* Standardized Print Header (print-only) */}
      <PrintReportHeader
        title="Profit & Loss Report"
        filters={[
          {
            label: 'Period',
            value: activePreset === 'custom'
              ? `${range.from || 'Start'} to ${range.to || 'End'}`
              : (PRESETS.find(p => p.key === activePreset)?.label || activePreset),
          },
          {
            label: 'Location',
            value: locations.find(l => String(l.id) === String(locationId))?.name || 'All Locations',
          },
        ]}
      />

      {/* Compact, Space-saving Header Filter Bar */}
      <div className="pl-header-row">
        <div className="pl-title-area">
          <h1>Profit &amp; Loss Report</h1>
          <p className="no-print">Filtered statement for {business?.name || 'the business'}.</p>
        </div>
        <div className="pl-header-filters no-print">
          <div className="pl-filter-item">
            <label htmlFor="pl-period">Period</label>
            <select
              id="pl-period"
              className="pl-select-input"
              value={activePreset}
              onChange={(e) => handlePresetSelect(e.target.value)}
            >
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </div>

          {activePreset === 'custom' && (
            <div className="pl-filter-item">
              <input
                type="date"
                className="pl-date-input"
                value={range.from || ''}
                onChange={(e) => setRange({ from: e.target.value, to: range.to })}
              />
              <span className="muted" style={{ fontSize: 11 }}>to</span>
              <input
                type="date"
                className="pl-date-input"
                value={range.to || ''}
                onChange={(e) => setRange({ from: range.from, to: e.target.value })}
              />
            </div>
          )}

          {isOwner && (
            <div className="pl-filter-item">
              <label htmlFor="pl-loc">Location</label>
              <select
                id="pl-loc"
                className="pl-select-input"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="pl-filter-item">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => window.print()}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px', marginRight: '8px' }}
            >
              🖨️ Print
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                const period = activePreset === 'custom'
                  ? `${range.from || 'Start'} to ${range.to || 'End'}`
                  : (PRESETS.find(p => p.key === activePreset)?.label || activePreset);
                const locName = locations.find(l => String(l.id) === String(locationId))?.name || 'All Locations';
                downloadPDF(buildPdfFilename('Profit And Loss Report', [{ value: period }, { value: locName }]));
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px' }}
            >
              📄 Save PDF
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="card text-danger" style={{ padding: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <div className="muted">Loading financial statements…</div>
        </div>
      ) : (
        <>
          {/* Dual Ledger Financial Statement Grid */}
          <div className="pl-summary-grid">

            {/* Card 1: Debits & Opening assets */}
            <div className="pl-card">
              <div className="pl-card-title">Debit &amp; Opening Stocks</div>
              <table className="pl-ledger-table">
                <tbody>
                  <tr>
                    <td>Opening stock by purchase price</td>
                    <td className="amount-val">{business?.currency} {calculations.openingStockPurchaseVal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Opening stock by sale price</td>
                    <td className="amount-val">{business?.currency} {calculations.openingStockSaleVal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Total purchase</td>
                    <td className="amount-val">{business?.currency} {calculations.totalPurchases.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Stock adjustments (included in closing stock)</td>
                    <td className="amount-val">{business?.currency} {calculations.totalStockAdjustmentVal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Total sell return</td>
                    <td className="amount-val">{business?.currency} {calculations.totalSellReturnVal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Total expense</td>
                    <td className="amount-val">{business?.currency} {calculations.totalExpense.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Total purchase shipping charge</td>
                    <td className="amount-val">{business?.currency} {calculations.totalPurchaseShippingCharge.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <div></div>
            </div>

            {/* Card 2: Credits & Closing assets */}
            <div className="pl-card">
              <div>
                <div className="pl-card-title">Credit &amp; Closing Stocks</div>
                <table className="pl-ledger-table">
                  <tbody>
                    <tr>
                      <td>Closing stock by purchase price</td>
                      <td className="amount-val">{business?.currency} {calculations.closingStockPurchaseVal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Closing stock by sale price</td>
                      <td className="amount-val">{business?.currency} {calculations.closingStockSaleVal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Total sales</td>
                      <td className="amount-val">{business?.currency} {calculations.totalSales.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Purchase returns (included in purchases)</td>
                      <td className="amount-val">{business?.currency} {calculations.totalPurchaseReturnVal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div>
                {/* COGS Section */}
                <div className="pl-statement-box">
                  <div className="pl-statement-item">
                    <span>COGS:</span>
                    <span>{business?.currency} {calculations.cogs.toFixed(2)}</span>
                  </div>
                  <div className="pl-statement-eq">
                    Opening stock + net purchases − closing stock
                  </div>
                </div>

                {/* Gross Profit Section */}
                <div className="pl-statement-box">
                  <div className="pl-statement-item">
                    <span>Gross Profit:</span>
                    <span>{business?.currency} {calculations.grossProfit.toFixed(2)}</span>
                  </div>
                  <div className="pl-statement-eq">
                    Total sales − COGS
                  </div>
                </div>

                {/* Net Profit Section */}
                <div className="pl-statement-box success-border">
                  <div className="pl-statement-item" style={{ color: calculations.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    <span>Net Profit:</span>
                    <span>{business?.currency} {calculations.netProfit.toFixed(2)}</span>
                  </div>
                  <div className="pl-statement-eq">
                    Gross Profit − Expenses
                  </div>
                </div>

                {/* Sales Profit – simple item-level selling price minus purchase cost */}
                <div className="pl-statement-box" style={{ borderLeftColor: 'var(--primary)', background: 'var(--primary-bg, #eef2ff)' }}>
                  <div className="pl-statement-item" style={{ color: calculations.totalSalesProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    <span>Sales Profit:</span>
                    <span>{business?.currency} {calculations.totalSalesProfit.toFixed(2)}</span>
                  </div>
                  <div className="pl-statement-eq">
                    Total selling price − Total purchase cost of items sold
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Detailed Interactive Breakdowns Section */}
          <div className="pl-tabs-container">
            <div className="pl-tabs-header">
              <div className="pl-tabs-list no-print">
                {[
                  { id: 'products', label: 'Profit by Products' },
                  { id: 'categories', label: 'Profit by Categories' },
                  { id: 'brands', label: 'Profit by Brands' },
                  { id: 'locations', label: 'Profit by Location' },
                  { id: 'invoices', label: 'Profit by Invoice' },
                  { id: 'dates', label: 'Profit by Date' },
                  { id: 'customers', label: 'Profit by Customer' },
                  { id: 'days', label: 'Profit by Day' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    className={`pl-tab-button ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setSearchTerm('');
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="print-only" style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--navy-900)' }}>
                Active Breakdown: {[
                  { id: 'products', label: 'Profit by Products' },
                  { id: 'categories', label: 'Profit by Categories' },
                  { id: 'brands', label: 'Profit by Brands' },
                  { id: 'locations', label: 'Profit by Location' },
                  { id: 'invoices', label: 'Profit by Invoice' },
                  { id: 'dates', label: 'Profit by Date' },
                  { id: 'customers', label: 'Profit by Customer' },
                  { id: 'days', label: 'Profit by Day' }
                ].find((t) => t.id === activeTab)?.label}
              </div>
              <div>
                {activeTab !== 'days' && (
                  <input
                    type="text"
                    className="pl-search-input no-print"
                    placeholder="Search results..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div className="table-scroll" style={{ marginTop: 12 }}>
              {activeTab === 'products' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Qty Sold</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.products, ['name', 'sku']).length === 0 ? (
                      <tr><td colSpan={6} className="muted table-empty">No items sold matching this criteria.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.products, ['name', 'sku']).map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.sku}</td>
                          <td>{p.qty}</td>
                          <td>{business?.currency} {p.sales.toFixed(2)}</td>
                          <td>{business?.currency} {p.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: p.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {p.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'categories' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Qty Sold</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.categories, ['name']).length === 0 ? (
                      <tr><td colSpan={5} className="muted table-empty">No category data.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.categories, ['name']).map((c) => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td>{c.qty}</td>
                          <td>{business?.currency} {c.sales.toFixed(2)}</td>
                          <td>{business?.currency} {c.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: c.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {c.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'brands' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th>Qty Sold</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.brands, ['name']).length === 0 ? (
                      <tr><td colSpan={5} className="muted table-empty">No brand data.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.brands, ['name']).map((b) => (
                        <tr key={b.name}>
                          <td>{b.name}</td>
                          <td>{b.qty}</td>
                          <td>{business?.currency} {b.sales.toFixed(2)}</td>
                          <td>{business?.currency} {b.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: b.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {b.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'locations' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.locations, ['name']).length === 0 ? (
                      <tr><td colSpan={4} className="muted table-empty">No location data.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.locations, ['name']).map((l) => (
                        <tr key={l.name}>
                          <td>{l.name}</td>
                          <td>{business?.currency} {l.sales.toFixed(2)}</td>
                          <td>{business?.currency} {l.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: l.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {l.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'invoices' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice No</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.invoices, ['invoiceNo', 'customer']).length === 0 ? (
                      <tr><td colSpan={6} className="muted table-empty">No invoice matching search term.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.invoices, ['invoiceNo', 'customer']).map((inv) => (
                        <tr key={inv.invoiceNo}>
                          <td>{inv.invoiceNo}</td>
                          <td>{inv.date}</td>
                          <td>{inv.customer}</td>
                          <td>{business?.currency} {inv.sales.toFixed(2)}</td>
                          <td>{business?.currency} {inv.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: inv.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {inv.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'dates' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.dates, ['name']).length === 0 ? (
                      <tr><td colSpan={4} className="muted table-empty">No sales on matching dates.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.dates, ['name']).map((d) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td>{business?.currency} {d.sales.toFixed(2)}</td>
                          <td>{business?.currency} {d.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: d.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {d.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'customers' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer Name</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterBySearch(breakdownLists.customers, ['name']).length === 0 ? (
                      <tr><td colSpan={4} className="muted table-empty">No customer data.</td></tr>
                    ) : (
                      filterBySearch(breakdownLists.customers, ['name']).map((c) => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td>{business?.currency} {c.sales.toFixed(2)}</td>
                          <td>{business?.currency} {c.cost.toFixed(2)}</td>
                          <td style={{ fontWeight: 600, color: c.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {business?.currency} {c.profit.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'days' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Day of the Week</th>
                      <th>Sales Revenue</th>
                      <th>Estimated Cost</th>
                      <th>Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownLists.days.map((d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td>{business?.currency} {d.sales.toFixed(2)}</td>
                        <td>{business?.currency} {d.cost.toFixed(2)}</td>
                        <td style={{ fontWeight: 600, color: d.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {business?.currency} {d.profit.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  </AppLayout>
);
}