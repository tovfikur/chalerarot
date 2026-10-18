// Blocks until PostgreSQL accepts TCP connections, then exits.
// Used by `prestart` so Prisma migrate/client only run against a live DB.
import net from 'net';

function target() {
  const url = process.env.DATABASE_URL ?? '';
  const m = url.match(/:\/\/[^@]+@([^/:]+)(?::(\d+))?/);
  return { host: m?.[1] ?? 'localhost', port: parseInt(m?.[2] ?? '5432', 10) || 5432 };
}

async function ping(host: string, port: number, ms = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.connect(port, host);
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(ms, () => done(false));
  });
}

async function main() {
  const { host, port } = target();
  const tries = parseInt(process.env.DB_WAIT_TRIES ?? '30', 10) || 30;
  for (let i = 1; i <= tries; i++) {
    if (await ping(host, port)) {
      console.log(`postgres ready at ${host}:${port}`);
      return;
    }
    console.log(`waiting for postgres at ${host}:${port} (${i}/${tries})...`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error(`postgres not reachable at ${host}:${port} after ${tries}s`);
  process.exit(1);
}

main();
