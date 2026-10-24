const { spawnSync } = require('node:child_process');

const name = 'chalarot-e2e-web';
const origin = 'http://127.0.0.1:3012';

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', stdio: 'inherit' });
}

async function waitForApp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`E2E frontend did not start at ${origin}`);
}

async function main() {
  const start = docker([
    'run', '--detach', '--rm', '--name', name,
    '--network', 'bridge', '--add-host', 'backend:127.0.0.1',
    '--publish', '127.0.0.1:3012:80', 'chalarot-e2e-local',
  ]);
  if (start.status !== 0) process.exit(start.status ?? 1);

  let code = 1;
  try {
    await waitForApp();
    const result = spawnSync(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2),
    ], { stdio: 'inherit' });
    code = result.status ?? 1;
  } catch (error) {
    console.error(error);
  } finally {
    docker(['stop', name]);
  }
  process.exit(code);
}

main();
