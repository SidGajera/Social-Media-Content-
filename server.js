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
  '.ico': 'image/x-icon'
};

function commitAndPushToGit(recordCount) {
  const commitMsg = 'Auto-sync live server vault data: ' + recordCount + ' posts [' + new Date().toISOString() + ']';
  exec('git add vault.json && git commit -m   + commitMsg +  ', (err, stdout) => {
    if (!err) {
      console.log('[Git Auto-Commit Success]:', stdout.trim());
      exec('git push origin main', (pushErr, pushStdout) => {
        if (!pushErr) console.log('[Git Auto-Push Success]:', pushStdout.trim());
      });
    }
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = urlObj.pathname;

  if (req.method === 'GET' && (pathname === '/api/status' || pathname === '/api/mysql/status')) {
    let count = 0;
    try {
      if (fs.existsSync(VAULT_PATH)) {
        const raw = fs.readFileSync(VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        count = Array.isArray(parsed) ? parsed.length : (parsed.records ? parsed.records.length : 0);
      }
    } catch(e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', storage: 'server_disk', count, time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/sync' || pathname === '/api/mysql/posts' || pathname === '/get-vault')) {
    let records = [];
    let customCategories = null;
    let deletedCategories = null;
    let deletedPostNos = null;
    let realThumbs = {};
    try {
      if (fs.existsSync(VAULT_PATH)) {
        const raw = fs.readFileSync(VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          records = parsed;
        } else if (parsed && typeof parsed === 'object') {
          records = Array.isArray(parsed.records) ? parsed.records : [];
          if (Array.isArray(parsed.customCategories)) customCategories = parsed.customCategories;
          if (Array.isArray(parsed.deletedCategories)) deletedCategories = parsed.deletedCategories;
          if (Array.isArray(parsed.deletedPostNos)) deletedPostNos = parsed.deletedPostNos;
          if (parsed.realThumbs && typeof parsed.realThumbs === 'object') realThumbs = parsed.realThumbs;
        }
      }
    } catch(e) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      storage: 'server_disk',
      count: records.length,
      records,
      customCategories,
      deletedCategories,
      deletedPostNos,
      realThumbs
    }));
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/sync' || pathname === '/api/mysql/sync' || pathname === '/save-vault')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const records = Array.isArray(payload) ? payload : (payload.records || payload.data);
        if (!Array.isArray(records)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'records array required' }));
          return;
        }

        const vaultObj = {
          records,
          customCategories: payload.customCategories || [],
          deletedCategories: payload.deletedCategories || [],
          deletedPostNos: payload.deletedPostNos || [],
          realThumbs: payload.realThumbs || {}
        };

        fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');
        console.log('[Server Disk Storage]: Saved ' + records.length + ' records to vault.json on server.');

        commitAndPushToGit(records.length);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: records.length,
          message: 'Successfully stored ' + records.length + ' records on server disk (vault.json).'
        }));
      } catch (err) {
        console.error('[Server Storage Sync Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
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
  console.log('=================================================');
  console.log('🚀 Social Media Server Vault running on port ' + PORT);
  console.log('📍 Web Interface: http://localhost:' + PORT);
  console.log('💾 Live Server API: http://localhost:' + PORT + '/api/sync');
  console.log('=================================================');
});
