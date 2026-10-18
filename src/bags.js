"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineTotal = exports.toKg = exports.kgPerUnit = exports.bagKgOf = exports.DEFAULT_BAGS = exports.KG_PER_TON = void 0;
exports.KG_PER_TON = 1000;
exports.DEFAULT_BAGS = { small: 25, medium: 40, large: 50 };
const bagKgOf = (p, unit) => {
    const v = !p ? 0 : unit === 'small' ? p.smallBagKg : unit === 'medium' ? p.mediumBagKg : p.largeBagKg;
    return v > 0 ? v : exports.DEFAULT_BAGS[unit];
};
exports.bagKgOf = bagKgOf;
// KG represented by ONE unit of the given type for this product.
const kgPerUnit = (p, unit) => {
    if (unit === 'kg')
        return 1;
    if (unit === 'ton')
        return exports.KG_PER_TON;
    return (0, exports.bagKgOf)(p, unit);
};
exports.kgPerUnit = kgPerUnit;
// Convert an entered quantity into KG (the only unit that ever touches stock).
const toKg = (p, unit, qty) => qty * (0, exports.kgPerUnit)(p, unit);
exports.toKg = toKg;
const lineTotal = (l) => l.qtyKg * l.rate;
exports.lineTotal = lineTotal;
