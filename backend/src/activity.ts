import { NextFunction, Request, Response } from 'express';
import { db } from './db';
import { reconcileAutomaticJournalEntries } from './routes/reports';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Classification = { entity: string; action: string };

function classify(method: string, path: string): Classification | null {
  if (method === 'POST' && path === '/api/auth/login') return { entity: 'auth', action: 'login' };
  if (method === 'POST' && path === '/api/auth/setup') return { entity: 'user', action: 'create' };
  if (method === 'PUT' && path === '/api/auth/profile') return { entity: 'profile', action: 'update' };
  if (path === '/api/auth/logout') return null;

  if (path === '/api/users') return method === 'POST' ? { entity: 'user', action: 'create' } : null;
  if (/^\/api\/users\/[^/]+$/.test(path)) return { entity: 'user', action: method === 'DELETE' ? 'delete' : 'update' };

  if (path === '/api/sales' && method === 'POST') return { entity: 'sale', action: 'create' };
  if (/^\/api\/sales\/[^/]+$/.test(path) && method === 'PUT') return { entity: 'sale', action: 'edit' };
  if (/^\/api\/sales\/[^/]+$/.test(path) && method === 'DELETE') return { entity: 'sale', action: 'delete' };
  if (path === '/api/purchases' && method === 'POST') return { entity: 'purchase', action: 'create' };
  if (/^\/api\/purchases\/[^/]+$/.test(path) && method === 'PUT') return { entity: 'purchase', action: 'edit' };
  if (/^\/api\/purchases\/[^/]+$/.test(path) && method === 'DELETE') return { entity: 'purchase', action: 'delete' };
  if (path === '/api/customer-payments' && method === 'POST') return { entity: 'customerPayment', action: 'create' };
  if (path === '/api/vendor-payments' && method === 'POST') return { entity: 'vendorPayment', action: 'create' };
  if (path === '/api/returns' && method === 'POST') return { entity: 'return', action: 'create' };

  if (path === '/api/expenses') return method === 'POST' ? { entity: 'expense', action: 'create' } : null;
  if (/^\/api\/expenses\/[^/]+$/.test(path)) return { entity: 'expense', action: method === 'DELETE' ? 'delete' : 'update' };
  if (path === '/api/expense-categories' && method === 'POST') return { entity: 'expenseCategory', action: 'create' };
  if (path === '/api/labour-accounts/costs' && method === 'POST') return { entity: 'labourCost', action: 'create' };
  if (/^\/api\/labour-accounts\/[^/]+\/payments$/.test(path) && method === 'POST') return { entity: 'labourPayment', action: 'create' };
  if (/^\/api\/labour-accounts\/[^/]+\/advances$/.test(path) && method === 'POST') return { entity: 'labourAdvance', action: 'create' };

  if (path === '/api/products' && method === 'POST') return { entity: 'product', action: 'create' };
  if (path === '/api/products/bulk' && method === 'POST') return { entity: 'product', action: 'bulk' };
  if (path === '/api/products/adjust' && method === 'POST') return { entity: 'stock', action: 'adjust' };
  if (/^\/api\/products\/[^/]+$/.test(path)) return { entity: 'product', action: method === 'DELETE' ? 'delete' : 'update' };

  if (path === '/api/customers' && method === 'POST') return { entity: 'customer', action: 'create' };
  if (path === '/api/customers/bulk' && method === 'POST') return { entity: 'customer', action: 'bulk' };
  if (/^\/api\/customers\/[^/]+$/.test(path)) return { entity: 'customer', action: method === 'DELETE' ? 'delete' : 'update' };

  if (path === '/api/vendors' && method === 'POST') return { entity: 'vendor', action: 'create' };
  if (path === '/api/vendors/bulk' && method === 'POST') return { entity: 'vendor', action: 'bulk' };
  if (/^\/api\/vendors\/[^/]+$/.test(path)) return { entity: 'vendor', action: method === 'DELETE' ? 'delete' : 'update' };

  if (path === '/api/settings' && method === 'PUT') return { entity: 'settings', action: 'update' };

  if (path === '/api/money/entries' && method === 'POST') return { entity: 'moneyEntry', action: 'create' };
  if (/^\/api\/money\/entries\/[^/]+$/.test(path) && method === 'PUT') return { entity: 'moneyEntry', action: 'update' };
  if (path === '/api/money/accounts' && method === 'POST') return { entity: 'moneyAccount', action: 'create' };
  if (/^\/api\/money\/accounts\/[^/]+\/opening$/.test(path) && method === 'PUT') return { entity: 'moneyAccount', action: 'opening' };
  if (/^\/api\/money\/accounts\/[^/]+$/.test(path)) return { entity: 'moneyAccount', action: method === 'DELETE' ? 'delete' : 'update' };
  if (path === '/api/money/transfers' && method === 'POST') return { entity: 'transfer', action: 'create' };

  if (/^\/api\/trash\/[^/]+\/[^/]+\/restore$/.test(path) && method === 'POST') return { entity: 'trash', action: 'restore' };
  if (/^\/api\/trash\/[^/]+\/[^/]+\/purge$/.test(path) && method === 'DELETE') return { entity: 'trash', action: 'purge' };
  if (path === '/api/trash/purge-expired' && method === 'POST') return { entity: 'trash', action: 'purge' };

  return null;
}

function number(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pathId(method: string, path: string): string | undefined {
  if (method !== 'PUT' && method !== 'DELETE' && !/restore|purge/.test(path)) return undefined;
  const p = path.split('/').filter(Boolean);
  if (p[0] !== 'api') return undefined;
  if (['expenses', 'products', 'customers', 'vendors', 'users', 'sales', 'purchases'].includes(p[1]) && p.length >= 3) return p[2];
  if (p[1] === 'money' && p[2] === 'entries' && p.length >= 4) return p[3];
  if (p[1] === 'money' && p[2] === 'accounts' && p.length >= 4) return p[3];
  if (p[1] === 'trash' && p.length >= 4) return p[3];
  return undefined;
}

async function customerName(id: unknown) {
  const value = text(id);
  if (!value) return undefined;
  const row = await db.customer.findUnique({ where: { id: value }, select: { name: true } }).catch(() => null);
  return row?.name;
}

async function vendorName(id: unknown) {
  const value = text(id);
  if (!value) return undefined;
  const row = await db.vendor.findUnique({ where: { id: value }, select: { name: true } }).catch(() => null);
  return row?.name;
}

async function accountName(id: unknown) {
  const value = text(id);
  if (!value) return undefined;
  const row = await db.moneyAccount.findUnique({ where: { id: value }, select: { name: true } }).catch(() => null);
  return row?.name;
}

async function returnParty(kind: unknown, id: unknown) {
  const value = text(id);
  if (!value) return {} as { partyName?: string; partyKind?: string };
  if (kind === 'sale') {
    const row = await db.sale.findUnique({ where: { id: value }, select: { customer: { select: { name: true } } } }).catch(() => null);
    return { partyName: row?.customer?.name, partyKind: 'customer' };
  }
  if (kind === 'purchase') {
    const row = await db.purchase.findUnique({ where: { id: value }, select: { vendor: { select: { name: true } } } }).catch(() => null);
    return { partyName: row?.vendor?.name, partyKind: 'vendor' };
  }
  return {};
}

async function build(req: Request, responseBody: any, actor: any) {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  const classified = classify(req.method, path);
  if (!classified) return null;

  const body: any = req.body ?? {};
  const b = responseBody && typeof responseBody === 'object' ? responseBody : {};
  const { entity, action } = classified;

  const productOpeningAmount = entity === 'product' && action === 'bulk' && Array.isArray(b.created)
    ? b.created.reduce((sum: number, product: any) => sum + (Number.isFinite(Number(product?.openingValue)) ? Number(product.openingValue) : 0), 0)
    : entity === 'product' && action === 'create'
      ? Number(b.product?.openingValue ?? b.openingValue ?? 0)
      : undefined;
  const amount = (entity === 'product' && (action === 'bulk' || action === 'create')
    ? number(productOpeningAmount)
    : undefined) ?? number(b.totalAmount) ?? number(b.amount)
    ?? number(b.total) ?? number(body.amount) ?? number(body.paid) ?? number(body.openingBalance);
  const reference = text(
    b.paymentNo ?? b.invoiceNo ?? b.transferNo ?? b.returnNo ?? b.voucherNo ?? b.sourceId ?? b.code ?? b.email ?? b.name
    ?? body.invoiceNo ?? body.code ?? body.email ?? body.name,
  );
  const entityId = text(b.id ?? b.account?.id ?? pathId(req.method, path));

  const detail: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') detail[key] = value;
  };

  put('date', body.date ?? b.date);
  put('note', action === 'edit' && (entity === 'sale' || entity === 'purchase')
    ? 'Confirmed invoice edit reposted stock and payments under the original transaction number.'
    : action === 'delete' && (entity === 'sale' || entity === 'purchase')
    ? b.note ?? 'Invoice deleted; inventory reversed and related payment entries deactivated.'
    : body.paymentNote ?? body.note ?? b.note);
  put('method', body.method ?? b.method);
  put('direction', body.direction ?? b.direction);
  put('role', b.role ?? body.role);
  put('active', typeof b.active === 'boolean' ? b.active : body.active);
  put('items', Array.isArray(body.lines) ? body.lines.length : Array.isArray(body.items) ? body.items.length : undefined);
  put('paid', number(body.paid));
  put('advanceApplied', number(b.advanceApplied) ?? number(body.advanceToApply));
  put('paymentNo', b.paymentNo);
  if (entity === 'moneyEntry' && action === 'update') {
    put('previousAmount', number(b.previousAmount));
    put('note', b.note);
    put('accountName', await accountName(b.moneyAccountId));
  }
  if (action === 'edit' && (entity === 'sale' || entity === 'purchase')) {
    put('stage', 'posted');
    put('inventory', 'reversed and reposted from confirmed invoice changes');
    put('changedItems', Array.isArray(body.lines) ? body.lines.length : undefined);
    put('editNote', 'Existing invoice and transaction number updated; stock and payment entries reposted on confirmation.');
  }
  if (action === 'delete' && (entity === 'sale' || entity === 'purchase')) {
    put('stage', 'deleted');
    put('inventory', 'reversed in stock ledger');
    put('reversedItems', b.reversedItems);
    put('cancelledPayments', b.cancelledPayments);
    put('deletedExpenses', b.deletedExpenses);
  }

  if (entity === 'sale' || entity === 'purchase') {
    const name = entity === 'sale' ? (await customerName(body.customerId) ?? text(b.partyName)) : (await vendorName(body.vendorId) ?? text(b.partyName));
    put('partyName', name);
    put('partyKind', entity === 'sale' ? 'customer' : 'vendor');
  } else if (entity === 'customerPayment') {
    put('partyName', await customerName(body.customerId));
    put('partyKind', 'customer');
  } else if (entity === 'vendorPayment') {
    put('partyName', await vendorName(body.vendorId));
    put('partyKind', 'vendor');
  } else if (entity === 'labourCost' || entity === 'labourPayment' || entity === 'labourAdvance') {
    const labourerId = entity === 'labourCost' ? text(b.labourerId) : path.split('/')[3];
    const worker = labourerId ? await db.labourer.findUnique({ where: { id: labourerId }, select: { name: true } }).catch(() => null) : null;
    put('labourerName', body.name ?? worker?.name);
    if (entity === 'labourCost') {
      put('quantity', body.quantity);
      put('pricePerBag', body.pricePerBag);
      put('direction', body.direction);
    } else if (entity === 'labourPayment') {
      put('accountName', await accountName(body.accountId));
    } else {
      put('accountName', await accountName(body.accountId));
      put('note', body.note);
    }
  } else if (entity === 'return') {
    put('kind', body.kind);
    const party = await returnParty(body.kind, body.kind === 'sale' ? body.saleId : body.purchaseId);
    put('partyName', party.partyName);
    put('partyKind', party.partyKind);
    put('settlement', body.settlement);
  } else if (entity === 'transfer') {
    put('from', b.from);
    put('to', b.to);
    put('fromId', body.fromId ?? body.from);
    put('toId', body.toId ?? body.to);
  } else if (entity === 'moneyEntry') {
    put('accountName', await accountName(b.moneyAccountId ?? body.accountId));
  } else if (entity === 'moneyAccount') {
    put('accountName', text(body.name ?? b.account?.name));
    put('accountType', body.type);
    put('bankName', body.bankName);
  } else if (entity === 'expense') {
    put('category', body.category ?? b.category);
    put('customName', body.customName ?? b.customName);
    if (action === 'delete') {
      put('stage', 'deleted');
      put('voucherNo', b.voucherNo);
      put('transactionNo', b.transactionNo);
      put('accountName', b.accountName);
      put('accountingImpact', b.accountingImpact);
      put('journalPosting', 'Expense debit and cash/bank credit removed from active accounting balances; original transaction retained in the activity log.');
    }
  } else if (entity === 'expenseCategory') {
    put('name', text(body.name ?? b.name));
    put('kind', text(body.kind ?? b.kind));
  } else if (entity === 'product') {
    put('name', text(body.name ?? b.product?.name));
    put('code', text(body.code ?? b.product?.code));
    if (action === 'bulk' || action === 'create') {
      put('openingStockValue', Number.isFinite(productOpeningAmount) ? productOpeningAmount : undefined);
      put('journalPosting', 'Debit Inventory; credit Owner equity');
      if (action === 'bulk' && Array.isArray(b.created)) {
        put('products', b.created.slice(0, 100).map((product: any) => ({
          code: text(product?.code),
          name: text(product?.name),
          openingQtyKg: Number.isFinite(Number(product?.opening)) ? Number(product.opening) : 0,
          openingValue: Number.isFinite(Number(product?.openingValue)) ? Number(product.openingValue) : 0,
        })));
      } else {
        const product = b.product ?? b;
        put('openingQtyKg', Number.isFinite(Number(product.opening)) ? Number(product.opening) : undefined);
        put('openingStockValue', Number.isFinite(Number(product.openingValue)) ? Number(product.openingValue) : undefined);
      }
    }
  } else if (entity === 'customer' || entity === 'vendor') {
    put('name', text(body.name));
    put('code', text(body.code));
    put('mobile', text(body.mobile));
  } else if (entity === 'user') {
    put('name', text(b.name ?? body.name));
    put('email', text(b.email ?? body.email));
    put('role', b.role ?? body.role);
    put('active', typeof b.active === 'boolean' ? b.active : body.active);
  } else if (entity === 'profile') {
    put('name', text(b.name));
    put('email', text(b.email));
  } else if (entity === 'settings') {
    put('name', text(body.name));
    put('phone', text(body.phone));
    put('currency', text(body.currency));
    put('language', text(body.language));
  } else if (entity === 'stock') {
    put('count', typeof b.count === 'number' ? b.count : Array.isArray(body.items) ? body.items.length : undefined);
    put('names', Array.isArray(b.adjusted) ? b.adjusted.map((x: any) => x.name).filter(Boolean).slice(0, 5) : undefined);
    put('adjustments', Array.isArray(b.adjusted) ? b.adjusted.slice(0, 100).map((x: any) => ({
      product: text(x.name), deltaKg: x.deltaKg, value: x.value, reason: text(x.reason),
    })) : undefined);
  } else if (entity === 'trash') {
    const parts = path.split('/').filter(Boolean);
    put('kind', parts[2]);
    put('entityId', entityId);
  }

  if (action === 'bulk') {
    put('count', typeof b.successCount === 'number' ? b.successCount : Array.isArray(body.items) ? body.items.length : undefined);
    put('total', typeof b.total === 'number' ? b.total : undefined);
    put('failedCount', Array.isArray(b.errors) ? b.errors.length : undefined);
  }

  const summary = [action, entity, reference, text(detail.partyName), text(detail.accountName), text(detail.note), amount != null ? String(amount) : ''].filter(Boolean).join(' · ');

  return {
    userId: text(actor?.id),
    userName: text(actor?.name) ?? 'System',
    userRole: text(actor?.role),
    action,
    entity,
    entityId,
    reference,
    amount,
    summary,
    detail: Object.keys(detail).length ? detail : undefined,
    ip: req.ip,
  };
}

export function activityLogger(req: Request, res: Response, next: NextFunction) {
  if (!WRITE_METHODS.has(req.method)) return next();
  const original = res.json.bind(res);
  let responseBody: any;
  res.json = (payload: any) => {
    responseBody = payload;
    return original(payload);
  };
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
    const postingSource = /^\/api\/(sales(?:\/[^/]+)?|purchases(?:\/[^/]+)?|customer-payments|vendor-payments|returns|expenses(?:\/[^/]+)?|labour-accounts\/(?:costs|[^/]+\/(?:payments|advances))|products(?:\/(?:bulk|adjust|[^/]+))?|customers(?:\/(?:bulk|[^/]+))?|vendors(?:\/(?:bulk|[^/]+))?|money\/(?:entries(?:\/[^/]+)?|accounts(?:\/[^/]+(?:\/opening)?)?|transfers)|trash\/[^/]+\/[^/]+\/(?:restore|purge)|trash\/purge-expired|chart-of-accounts(?:\/[^/]+)?)$/;
    if (res.locals.user && postingSource.test(path)) {
      void reconcileAutomaticJournalEntries().catch(error => console.error('Automatic journal reconciliation failed:', error));
    }
    if (/^\/api\/reminders\/[^/]+\/read$/.test(path)) return;
    const actor = res.locals.user
      ?? ((path === '/api/auth/login' || path === '/api/auth/setup') ? responseBody : null);
    if (!actor) return;
    void build(req, responseBody, actor)
      .then(entry => entry ? db.activityLog.create({ data: entry as any }) : null)
      .catch(() => undefined);
  });
  next();
}
