import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { products } from './routes/products';
import { customers, vendors } from './routes/parties';
import { tx } from './routes/transactions';
import { reports } from './routes/reports';
import { trash } from './routes/trash';
import { expenses } from './routes/expenses';
import { reminders } from './routes/reminders';
import { search } from './routes/search';
import { returns } from './routes/returns';
import { money } from './routes/money';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/products', products);
app.use('/api/customers', customers);
app.use('/api/vendors', vendors);
app.use('/api', tx);
app.use('/api', reports);
app.use('/api/trash', trash);
app.use('/api/expenses', expenses);
app.use('/api/reminders', reminders);
app.use('/api/search', search);
app.use('/api/returns', returns);
app.use('/api/money', money);

const port = parseInt(process.env.API_PORT ?? '4000', 10) || 4000;
app.listen(port, () => {
  console.log(`chalarot-api listening on :${port}`);
});
