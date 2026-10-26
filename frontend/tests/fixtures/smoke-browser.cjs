// Simula raíz, hijo y nieto; cada proceso expira aun si la prueba se interrumpe.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const dir = process.argv.find(a => a.startsWith('--pids-dir=')).slice(11);
const role = process.argv.find(a => a.startsWith('--role='))?.slice(7) || 'root';
fs.writeFileSync(path.join(dir, role + '.json'), JSON.stringify({ pid: process.pid }));
if (role !== 'grandchild') {
  const args = [__filename, '--pids-dir=' + dir, '--role=' + (role === 'root' ? 'child' : 'grandchild')];
  if (role === 'root' && process.argv.includes('--mark-child')) args.push('--user-data-dir=' + dir);
  const child = spawn(process.execPath, args, { detached: process.platform === 'win32', windowsHide: true, stdio: 'ignore' });
  // Independientes del Job Object de Node, como los secundarios nativos de Edge.
  child.unref();
}
setInterval(() => { if (fs.existsSync(path.join(dir, 'stop-fixture'))) process.exit(0); }, 25);
setTimeout(() => process.exit(0), 45000);
