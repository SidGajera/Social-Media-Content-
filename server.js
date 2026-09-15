// server.js - MySQL Permanent Database Backend for Social Media Content
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'social_media_vault';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);

const ROOT_DIR = __dirname;
const VAULT_PATH = path.join(ROOT_DIR, 'vault.json');

let mysql = null;
let pool = null;
let mysqlConnected = false;

try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.warn('[MySQL Warning]: mysql2 module not found. Run npm install mysql2');
}

async function initMySQLPool() {
  if (!mysql) return;
  try {
    const tempConn = await mysql.createConnection({
      host: MYSQL_HOST,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      port: MYSQL_PORT
    });
    await tempConn.query('CREATE DATABASE IF NOT EXISTS ' + MYSQL_DATABASE + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
    await tempConn.end();

    pool = mysql.createPool({
      host: MYSQL_HOST,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      port: MYSQL_PORT,
      waitForConnections: true,
      connectionLimit: 15,
      queueLimit: 0
    });

    console.log('[MySQL Database]: Connected successfully to database   + MYSQL_DATABASE +   on ' + MYSQL_HOST + ':' + MYSQL_PORT);
    mysqlConnected = true;
    await initMySQLTables();
  } catch (err) {
    mysqlConnected = false;
    console.warn('[MySQL Connection Notice]: Could not connect to MySQL (' + err.message + '). Ensure MySQL/XAMPP service is running on ' + MYSQL_HOST + ':' + MYSQL_PORT + '.');
  }
}

async function initMySQLTables() {
  if (!pool) return;
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS social_media_posts (post_no INT PRIMARY KEY, platform VARCHAR(100), original_post_link TEXT, extra_link TEXT, post_type VARCHAR(200), takeaway TEXT, status VARCHAR(100), date_saved VARCHAR(50), category TEXT, real_thumb TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
    await pool.query('CREATE TABLE IF NOT EXISTS social_media_meta (meta_key VARCHAR(100) PRIMARY KEY, meta_value LONGTEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
    console.log('[MySQL Schema]: Verified tables  social_media_posts & social_media_meta.');

    const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM social_media_posts');
    if (rows[0].cnt === 0 && fs.existsSync(VAULT_PATH)) {
      console.log('[MySQL Seeding]: Table is empty. Auto-seeding 489 records from vault.json...');
      const raw = fs.readFileSync(VAULT_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
      if (records.length > 0) {
        await upsertPostsToMySQL(records, parsed.customCategories, parsed.deletedCategories, parsed.deletedPostNos, parsed.realThumbs);
        console.log('[MySQL Seeding]: Successfully seeded ' + records.length + ' posts into MySQL database!');
      }
    }
  } catch (err) {
    console.error('[MySQL Init Error]:', err.message);
  }
}

async function upsertPostsToMySQL(records, customCategories, deletedCategories, deletedPostNos, realThumbs) {
  if (!pool || !Array.isArray(records) || records.length === 0) return 0;
  const insertSql = 'INSERT INTO social_media_posts (post_no, platform, original_post_link, extra_link, post_type, takeaway, status, date_saved, category, real_thumb) VALUES ? ON DUPLICATE KEY UPDATE platform = VALUES(platform), original_post_link = VALUES(original_post_link), extra_link = VALUES(extra_link), post_type = VALUES(post_type), takeaway = VALUES(takeaway), status = VALUES(status), date_saved = VALUES(date_saved), category = VALUES(category), real_thumb = VALUES(real_thumb);';
  const values = records.map(r => [
    r['No.'],
    r.Platform || 'Social Media',
    r['Original Post Link'] || '',
    r['Extra Link'] || r['Extra URL'] || r.extraUrl || '',
    r['Post Type'] || 'Content',
    r['Core Idea / 1-Line Takeaway'] || '',
    r.Status || 'Not Used',
    r['Date Saved'] || '',
    JSON.stringify(Array.isArray(r.Category) ? r.Category : (r.Category ? [r.Category] : [])),
    (realThumbs && realThumbs[r['No.']]) || r.realThumb || ''
  ]);
  await pool.query(insertSql, [values]);

  if (customCategories) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'customCategories\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(customCategories)]);
  if (deletedCategories) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'deletedCategories\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(deletedCategories)]);
  if (deletedPostNos) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'deletedPostNos\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(deletedPostNos)]);
  if (realThumbs) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'realThumbs\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(realThumbs)]);

  return records.length;
}

function commitAndPushToGit(recordCount) {
  const commitMsg = 'Auto-sync MySQL server data: ' + recordCount + ' posts [' + new Date().toISOString() + ']';
  exec('git add vault.json && git commit -m  + commitMsg + ', (err, stdout) => {
    if (!err) {
      console.log('[Git Auto-Commit Success]:', stdout.trim());
      exec('git push origin main', (pushErr, pushStdout) => {
        if (!pushErr) console.log('[Git Auto-Push Success]:', pushStdout.trim());
      });
    }
  });
}

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = urlObj.pathname;

  if (pool === null && mysql) {
    await initMySQLPool();
  }

  // GET /api/mysql/status or /api/status
  if (req.method === 'GET' && (pathname === '/api/mysql/status' || pathname === '/api/status')) {
    let count = 0;
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM social_media_posts');
        count = rows[0].cnt;
        mysqlConnected = true;
      } catch (e) {
        mysqlConnected = false;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', mysqlConnected, count, host: MYSQL_HOST, database: MYSQL_DATABASE }));
    return;
  }

  // GET /api/mysql/posts or GET /api/sync - Always read directly from MySQL!
  if (req.method === 'GET' && (pathname === '/api/mysql/posts' || pathname === '/api/sync' || pathname === '/get-vault')) {
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT * FROM social_media_posts ORDER BY post_no DESC');
        const [metaRows] = await pool.query('SELECT * FROM social_media_meta');
        let customCategories = null, deletedCategories = null, deletedPostNos = null, realThumbs = {};
        metaRows.forEach(m => {
          try {
            if (m.meta_key === 'customCategories') customCategories = JSON.parse(m.meta_value);
            if (m.meta_key === 'deletedCategories') deletedCategories = JSON.parse(m.meta_value);
            if (m.meta_key === 'deletedPostNos') deletedPostNos = JSON.parse(m.meta_value);
            if (m.meta_key === 'realThumbs') realThumbs = JSON.parse(m.meta_value);
          } catch(e) {}
        });

        const records = rows.map(r => ({
          'No.': r.post_no,
          'Platform': r.platform,
          'Original Post Link': r.original_post_link,
          'Extra Link': r.extra_link,
          'Post Type': r.post_type,
          'Core Idea / 1-Line Takeaway': r.takeaway,
          'Status': r.status,
          'Date Saved': r.date_saved,
          'Category': r.category ? JSON.parse(r.category) : []
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          storage: 'mysql',
          count: records.length,
          records,
          customCategories,
          deletedCategories,
          deletedPostNos,
          realThumbs
        }));
        return;
      } catch (err) {
        console.warn('[MySQL Read Error, falling back to disk vault]:', err.message);
      }
    }

    // Fallback to vault.json if MySQL is offline
    let records = [], customCategories = null, deletedCategories = null, deletedPostNos = null, realThumbs = {};
    try {
      if (fs.existsSync(VAULT_PATH)) {
        const raw = fs.readFileSync(VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) records = parsed;
        else if (parsed && typeof parsed === 'object') {
          records = Array.isArray(parsed.records) ? parsed.records : [];
          if (Array.isArray(parsed.customCategories)) customCategories = parsed.customCategories;
          if (Array.isArray(parsed.deletedCategories)) deletedCategories = parsed.deletedCategories;
          if (Array.isArray(parsed.deletedPostNos)) deletedPostNos = parsed.deletedPostNos;
          if (parsed.realThumbs) realThumbs = parsed.realThumbs;
        }
      }
    } catch(e) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, storage: 'disk_fallback', count: records.length, records, customCategories, deletedCategories, deletedPostNos, realThumbs }));
    return;
  }

  // POST /api/mysql/sync or POST /api/sync - Always store directly into MySQL!
  if (req.method === 'POST' && (pathname === '/api/mysql/sync' || pathname === '/api/sync' || pathname === '/save-vault')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const records = Array.isArray(payload) ? payload : (payload.records || payload.data);
        if (!Array.isArray(records)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'records array required' }));
          return;
        }

        // Save backup to vault.json
        const vaultObj = {
          records,
          customCategories: payload.customCategories || [],
          deletedCategories: payload.deletedCategories || [],
          deletedPostNos: payload.deletedPostNos || [],
          realThumbs: payload.realThumbs || {}
        };
        fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

        let mysqlSaved = false;
        if (pool) {
          try {
            await upsertPostsToMySQL(records, payload.customCategories, payload.deletedCategories, payload.deletedPostNos, payload.realThumbs);
            mysqlSaved = true;
            console.log('[MySQL Storage]: Saved ' + records.length + ' records into MySQL database.');
          } catch(e) {
            console.error('[MySQL Save Error]:', e.message);
          }
        }

        commitAndPushToGit(records.length);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: records.length,
          mysqlSynced: mysqlSaved,
          message: mysqlSaved ? 'Permanently stored ' + records.length + ' records in MySQL.' : 'Stored in vault.json backup.'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
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

initMySQLPool().then(() => {
  server.listen(PORT, () => {
    console.log('=================================================');
    console.log('🚀 Social Media MySQL Server running on port ' + PORT);
    console.log('📍 Web Interface: http://localhost:' + PORT);
    console.log('🗄️ MySQL Direct API: http://localhost:' + PORT + '/api/mysql/posts');
    console.log('=================================================');
  });
});
