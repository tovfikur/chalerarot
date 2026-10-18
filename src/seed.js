"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSeed = exports.VPAY_DATES = exports.COLLECT_DATES = exports.SALE_DATES = exports.PURCHASE_DATES = exports.SALE_UNITS = exports.PURCHASE_UNITS = exports.VENDOR_DEFS = exports.CUSTOMER_DEFS = exports.PRODUCT_DEFS = exports.SEED_VERSION = void 0;
const bags_1 = require("./bags");
// Demo dataset version. Bump when the seed changes during development.
// Storage model: in-memory useState initial values in AppProvider (no
// persistence layer), so buildSeed() runs once per provider mount and can
// never create duplicate records. Reset = reload the app.
exports.SEED_VERSION = 1;
// Deterministic RNG so the demo dataset is stable across reloads.
const rng = (() => {
    let s = 42;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
})();
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const dstr = (deltaDays) => {
    const d = new Date();
    d.setDate(d.getDate() + deltaDays);
    return d.toISOString().slice(0, 10);
};
exports.PRODUCT_DEFS = [
    ['মিনিকেট চাল', 64, 68, 1200],
    ['নাজিরশাইল চাল', 73, 77, 850],
    ['কাটারিভোগ চাল', 88, 95, 420],
    ['চিনিগুঁড়া চাল', 135, 145, 180, 10, 20, 25],
    ['বাসমতি চাল', 122, 130, 300, 20, 25, 40],
    ['আটাশ চাল', 52, 57, 1500],
    ['ঊনত্রিশ চাল', 55, 60, 1100],
    ['স্বর্ণা চাল', 48, 53, 950],
    ['বিআর-২৮ চাল', 50, 55, 700],
    ['বিআর-২৯ চাল', 54, 59, 640],
    ['পাইজাম চাল', 66, 71, 500],
    ['জিরাশাইল চাল', 78, 84, 380],
    ['কালিজিরা চাল', 148, 160, 120, 10, 20, 25],
    ['গোবিন্দভোগ চাল', 95, 102, 260],
    ['মোটা চাল', 45, 49, 1300],
    ['সিদ্ধ মিনিকেট চাল', 60, 65, 760],
    ['আতপ মিনিকেট চাল', 62, 67, 540],
    ['সিদ্ধ আটাশ চাল', 50, 55, 820],
    ['আতপ চাল', 58, 63, 610],
    ['লাল চাল', 72, 78, 240],
    ['ব্রাউন রাইস', 110, 120, 150],
    ['সুগন্ধি চাল', 98, 106, 290],
    ['দেশি বাসমতি চাল', 105, 113, 330],
    ['প্রিমিয়াম নাজিরশাইল চাল', 85, 92, 410],
    ['চিকন চাল', 68, 73, 690],
];
exports.CUSTOMER_DEFS = [
    ['রহিম স্টোর', '01711-234501', 'মিরপুর, ঢাকা', 15000],
    ['করিম ট্রেডার্স', '01811-345602', 'কারওয়ান বাজার, ঢাকা', 8000],
    ['মেসার্স আল-আমিন স্টোর', '01911-456703', 'মোহাম্মদপুর, ঢাকা', 0],
    ['ভাই ভাই স্টোর', '01611-567804', 'যাত্রাবাড়ী, ঢাকা', 2500],
    ['মা-বাবার দোয়া স্টোর', '01511-678905', 'উত্তরা, ঢাকা', 32500],
    ['বিসমিল্লাহ ট্রেডার্স', '01722-789006', 'টঙ্গী, গাজীপুর', 0],
    ['নিউ জনতা স্টোর', '01822-890107', 'নারায়ণগঞ্জ', 8750],
    ['মদিনা রাইস হাউস', '01922-901208', 'কেরানীগঞ্জ', 48000],
    ['হাজী ট্রেডার্স', '01622-012309', 'সাভার', 12000],
    ['নূর জেনারেল স্টোর', '01522-123410', 'মিরপুর, ঢাকা', 0],
    ['সোনার বাংলা স্টোর', '01733-234511', 'কারওয়ান বাজার, ঢাকা', 5500],
    ['মায়ের দোয়া ট্রেডার্স', '01833-345612', 'মোহাম্মদপুর, ঢাকা', 0],
    ['সততা স্টোর', '01933-456713', 'যাত্রাবাড়ী, ঢাকা', 18000],
    ['রহমান এন্টারপ্রাইজ', '01633-567814', 'উত্তরা, ঢাকা', 27500],
    ['আল্লাহর দান স্টোর', '01533-678915', 'টঙ্গী, গাজীপুর', 0],
    ['বন্ধু ট্রেডার্স', '01744-789016', 'নারায়ণগঞ্জ', 4200],
    ['ঢাকা রাইস কর্নার', '01844-890117', 'কারওয়ান বাজার, ঢাকা', 22000],
    ['পদ্মা জেনারেল স্টোর', '01944-901218', 'কেরানীগঞ্জ', 0],
    ['মেঘনা ট্রেডার্স', '01644-012319', 'সাভার', 9600],
    ['জননী স্টোর', '01544-123420', 'মিরপুর, ঢাকা', 0],
];
exports.VENDOR_DEFS = [
    ['দিনাজপুর অটো রাইস মিল', '01955-100201', 'দিনাজপুর', 40000],
    ['নওগাঁ রাইস মিল', '01755-200302', 'নওগাঁ', 0],
    ['বগুড়া অটো রাইস', '01855-300403', 'বগুড়া', 25000],
    ['কুষ্টিয়া রাইস এজেন্সি', '01655-400504', 'কুষ্টিয়া', 12000],
    ['মেসার্স রহমান রাইস মিল', '01555-500605', 'রাজশাহী', 75000],
    ['আল-মদিনা অটো রাইস মিল', '01966-600706', 'দিনাজপুর', 0],
    ['উত্তরবঙ্গ রাইস সাপ্লাই', '01766-700807', 'রংপুর', 48000],
    ['রাজশাহী রাইস ট্রেডার্স', '01866-800908', 'রাজশাহী', 120000],
    ['মেসার্স হক রাইস মিল', '01666-901009', 'নওগাঁ', 18500],
    ['জামালপুর রাইস এজেন্সি', '01566-012110', 'জামালপুর', 0],
    ['ময়মনসিংহ রাইস সাপ্লাই', '01977-123211', 'ময়মনসিংহ', 25500],
    ['পদ্মা অটো রাইস মিল', '01777-234312', 'পাবনা', 60000],
];
exports.PURCHASE_UNITS = ['large', 'kg', 'medium', 'ton', 'small', 'large', 'kg', 'medium'];
exports.SALE_UNITS = ['kg', 'large', 'medium', 'small', 'kg', 'large', 'ton', 'medium'];
exports.PURCHASE_DATES = [0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 15, 18, 21, 24, 26, 28, 30, 12];
exports.SALE_DATES = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 9, 11, 17, 23];
exports.COLLECT_DATES = [0, 1, 2, 2, 3, 4, 5, 7, 9, 12, 15, 18, 21, 25, 28, 30];
exports.VPAY_DATES = [0, 0, 1, 4, 7, 10, 14, 18, 22, 26, 29];
function buildSeed() {
    let n = 0;
    const nid = (p) => `${p}${++n}`;
    const today = dstr(0);
    const products = exports.PRODUCT_DEFS.map(([name, cost, price, opening, sb, mb, lb], i) => ({
        id: `p${i + 1}`, name, cost, price, opening, qty: opening, uom: 'kg',
        smallBagKg: sb ?? 25, mediumBagKg: mb ?? 40, largeBagKg: lb ?? 50,
    }));
    const customers = exports.CUSTOMER_DEFS.map(([name, mobile, address, opening], i) => ({
        id: `c${i + 1}`, name, mobile, address, opening,
    }));
    const vendors = exports.VENDOR_DEFS.map(([name, mobile, address, opening], i) => ({
        id: `v${i + 1}`, name, mobile, address, opening,
    }));
    const cTx = [];
    const vTx = [];
    const stockTx = products.map(p => ({ id: nid('st'), productId: p.id, type: 'OPENING', qty: p.qty, date: today }));
    const sales = [];
    const avail = {};
    products.forEach(p => { avail[p.id] = p.qty; });
    const custOwed = {}; // opening + sales (ex payments)
    const custPaid = {};
    const vendOwed = {};
    const vendPaid = {};
    customers.forEach(c => { custOwed[c.id] = c.opening; custPaid[c.id] = 0; });
    vendors.forEach(v => { vendOwed[v.id] = v.opening; vendPaid[v.id] = 0; });
    // ---- Purchases (KG + bags + ton via shared conversion) ----
    exports.PURCHASE_DATES.forEach((ago, i) => {
        const v = vendors[i % vendors.length];
        const p = pick(products);
        const unit = exports.PURCHASE_UNITS[i % exports.PURCHASE_UNITS.length];
        const entered = unit === 'ton' ? (rng() < 0.5 ? 1 : 1.5) : unit === 'kg' ? ri(200, 800) : ri(5, 30);
        const qtyKg = Math.round((0, bags_1.toKg)(p, unit, entered));
        if (qtyKg <= 0)
            return;
        const total = Math.round(qtyKg * p.cost);
        const date = dstr(-ago);
        const paid = i % 3 === 0 ? total : i % 3 === 1 ? Math.round(total * (0.4 + rng() * 0.3)) : 0;
        vTx.push({ id: nid('t'), partyId: v.id, kind: 'purchase', amount: total, date, note: `${p.name}` });
        if (paid > 0)
            vTx.push({ id: nid('t'), partyId: v.id, kind: 'payment', amount: paid, date });
        vendOwed[v.id] += total;
        vendPaid[v.id] += paid;
        avail[p.id] += qtyKg;
        stockTx.push({ id: nid('st'), productId: p.id, type: 'PURCHASE', qty: qtyKg, date });
    });
    // ---- Sales (cash, partial, full due; KG + bags + ton) ----
    const saleOrder = [...products, ...products.slice(0, 7)];
    exports.SALE_DATES.forEach((ago, i) => {
        const p = saleOrder[i % saleOrder.length];
        let unit = exports.SALE_UNITS[i % exports.SALE_UNITS.length];
        if (unit === 'ton' && avail[p.id] < 1000)
            unit = 'large';
        const per = unit === 'kg' ? 1 : unit === 'ton' ? 1000
            : unit === 'small' ? p.smallBagKg : unit === 'medium' ? p.mediumBagKg : p.largeBagKg;
        let entered = unit === 'kg' ? ri(20, 120) : unit === 'ton' ? 1 : ri(1, 6);
        let qtyKg = Math.round(entered * per);
        if (qtyKg > avail[p.id]) {
            if (avail[p.id] <= 0)
                return;
            qtyKg = Math.floor(avail[p.id]);
            entered = unit === 'kg' ? qtyKg : Math.max(1, Math.floor(qtyKg / per));
            qtyKg = Math.round(entered * per);
            if (qtyKg > avail[p.id] || qtyKg <= 0)
                return;
        }
        const total = Math.round(qtyKg * p.price);
        const profit = total - Math.round(qtyKg * p.cost);
        const date = dstr(-ago);
        const r = rng();
        const fullCash = r < 0.35;
        const partyId = fullCash ? (rng() < 0.5 ? 'cash' : pick(customers).id) : pick(customers).id;
        const paid = fullCash ? total : r < 0.75 ? Math.round(total * (0.3 + rng() * 0.4)) : 0;
        cTx.push({ id: nid('t'), partyId, kind: 'sale', amount: total, date, note: `${p.name}` });
        if (paid > 0)
            cTx.push({ id: nid('t'), partyId, kind: 'payment', amount: paid, date });
        if (partyId !== 'cash') {
            custOwed[partyId] += total;
            custPaid[partyId] += paid;
        }
        sales.push({ id: nid('s'), date, total, profit });
        avail[p.id] -= qtyKg;
        stockTx.push({ id: nid('st'), productId: p.id, type: 'SALE', qty: -qtyKg, date });
    });
    // ---- Customer collections (capped so dues stay consistent) ----
    exports.COLLECT_DATES.forEach(ago => {
        for (let tries = 0; tries < 12; tries++) {
            const c = pick(customers);
            const remaining = (custOwed[c.id] ?? 0) - (custPaid[c.id] ?? 0);
            if (remaining > 500) {
                const amt = Math.min(remaining, ri(1000, 12000));
                cTx.push({ id: nid('t'), partyId: c.id, kind: 'payment', amount: amt, date: dstr(-ago), note: 'আদায়' });
                custPaid[c.id] += amt;
                break;
            }
        }
    });
    // ---- Vendor payments (capped so payables stay consistent) ----
    exports.VPAY_DATES.forEach(ago => {
        for (let tries = 0; tries < 12; tries++) {
            const v = pick(vendors);
            const remaining = (vendOwed[v.id] ?? 0) - (vendPaid[v.id] ?? 0);
            if (remaining > 1000) {
                const amt = Math.min(remaining, ri(5000, 40000));
                vTx.push({ id: nid('t'), partyId: v.id, kind: 'payment', amount: amt, date: dstr(-ago) });
                vendPaid[v.id] += amt;
                break;
            }
        }
    });
    // ---- Finalize: stock + expected payment dates ----
    products.forEach(p => { p.qty = avail[p.id]; });
    const dueOf = (owed, paid) => owed - paid; // owed already includes opening
    customers.forEach((c, i) => {
        if (dueOf(custOwed[c.id], custPaid[c.id]) > 1000 && i % 3 !== 2)
            c.next = dstr(ri(3, 14));
    });
    vendors.forEach((v, i) => {
        if (dueOf(vendOwed[v.id], vendPaid[v.id]) > 5000 && i % 3 !== 2)
            v.next = dstr(ri(3, 14));
    });
    return { products, customers, vendors, cTx, vTx, stockTx, sales };
}
exports.buildSeed = buildSeed;
