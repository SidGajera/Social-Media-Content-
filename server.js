const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const VAULT_PATH = path.join(ROOT_DIR, 'vault.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv'
};

function commitAndPushToGit(recordCount) {
  const commitMsg = `Auto-sync live vault data: ${recordCount} posts [${new Date().toISOString()}]`;
  exec(`git add vault.json && git commit -m "${commitMsg}"`, (err, stdout, stderr) => {
    if (err) {
      console.warn('[Git Auto-Commit Notice]:', err.message);
      return;
    }
    console.log('[Git Auto-Commit Success]:', stdout.trim());
    exec('git push origin main', (pushErr, pushStdout) => {
      if (pushErr) {
        console.warn('[Git Auto-Push Notice]:', pushErr.message);
      } else {
        console.log('[Git Auto-Push Success]:', pushStdout.trim());
      }
    });
  });
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Endpoint: GET /api/status
  if (req.method === 'GET' && pathname === '/api/status') {
    let count = 0;
    try {
      if (fs.existsSync(VAULT_PATH)) {
        const raw = fs.readFileSync(VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) count = parsed.length;
      }
    } catch(e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', count, time: new Date().toISOString() }));
    return;
  }

  // Endpoint: POST /api/sync or /save-vault
  if (req.method === 'POST' && (pathname === '/api/sync' || pathname === '/save-vault')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const records = Array.isArray(payload) ? payload : (payload.records || payload.data);
        if (!Array.isArray(records)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid payload: records array required' }));
          return;
        }

        // Format and save vault.json to server disk
        const jsonStr = JSON.stringify(records, null, 2);
        fs.writeFileSync(VAULT_PATH, jsonStr, 'utf8');
        console.log(`[Vault Server Sync]: Saved ${records.length} records to vault.json on disk.`);

        // Trigger background git commit & push
        commitAndPushToGit(records.length);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: records.length,
          message: `Successfully stored ${records.length} records on server disk (vault.json) & triggered Git sync.`
        }));
      } catch (err) {
        console.error('[Vault Server Sync Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Security check for directory traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Social Media Vault Server running on port ${PORT}`);
  console.log(`📍 Web Interface: http://localhost:${PORT}`);
  console.log(`💾 Live Server Sync API: http://localhost:${PORT}/api/sync`);
  console.log(`=================================================`);
});
