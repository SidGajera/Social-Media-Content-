// server-mysql.js - MySQL / MariaDB Backend Server for Social Media Content
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'social_media_vault';
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;

let mysql = null;
let pool = null;

try {
  mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    port: MYSQL_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log(`[MySQL Database]: Initialized connection pool for database "${MYSQL_DATABASE}" on ${MYSQL_HOST}:${MYSQL_PORT}`);
  initMySQLTables();
} catch (e) {
  console.warn('[MySQL Database Notice]: mysql2 module not installed or database connection pending. Run "npm install mysql2" to enable MySQL backend.');
}

async function initMySQLTables() {
  if (!pool) return;
  try {
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS social_media_posts (
        post_no INT PRIMARY KEY,
        platform VARCHAR(100),
        original_post_link TEXT,
        extra_link TEXT,
        post_type VARCHAR(200),
        takeaway TEXT,
        status VARCHAR(100),
        date_saved VARCHAR(50),
        category TEXT,
        real_thumb TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createTableSql);
    console.log('[MySQL Database]: Table "social_media_posts" verified/created successfully.');
  } catch (err) {
    console.error('[MySQL Table Init Error]:', err.message);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
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

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // GET /api/mysql/status
  if (req.method === 'GET' && pathname === '/api/mysql/status') {
    let count = 0;
    let mysqlConnected = false;
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM social_media_posts');
        count = rows[0].cnt;
        mysqlConnected = true;
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', mysqlConnected, count, host: MYSQL_HOST, database: MYSQL_DATABASE }));
    return;
  }

  // GET /api/mysql/posts - Fetch all posts from MySQL
  if (req.method === 'GET' && pathname === '/api/mysql/posts') {
    if (!pool) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'MySQL pool not initialized' }));
      return;
    }
    try {
      const [rows] = await pool.query('SELECT * FROM social_media_posts ORDER BY post_no DESC');
      const records = rows.map(r => ({
        'No.': r.post_no,
        'Platform': r.platform,
        'Original Post Link': r.original_post_link,
        'Extra Link': r.extra_link,
        'Post Type': r.post_type,
        'Core Idea / 1-Line Takeaway': r.takeaway,
        'Status': r.status,
        'Date Saved': r.date_saved,
        'Category': r.category ? JSON.parse(r.category) : [],
        'realThumb': r.real_thumb
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: records.length, records }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // POST /api/mysql/sync - Save / Upsert posts to MySQL database
  if (req.method === 'POST' && (pathname === '/api/mysql/sync' || pathname === '/api/sync')) {
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

        // Also update local vault.json file as backup
        const vaultPath = path.join(__dirname, 'vault.json');
        try {
          fs.writeFileSync(vaultPath, JSON.stringify(records, null, 2), 'utf8');
        } catch (e) {}

        // If MySQL pool is active, upsert to MySQL database
        if (pool) {
          const insertSql = `
            INSERT INTO social_media_posts 
            (post_no, platform, original_post_link, extra_link, post_type, takeaway, status, date_saved, category, real_thumb)
            VALUES ?
            ON DUPLICATE KEY UPDATE
              platform = VALUES(platform),
              original_post_link = VALUES(original_post_link),
              extra_link = VALUES(extra_link),
              post_type = VALUES(post_type),
              takeaway = VALUES(takeaway),
              status = VALUES(status),
              date_saved = VALUES(date_saved),
              category = VALUES(category),
              real_thumb = VALUES(real_thumb);
          `;
          const values = records.map(r => [
            r['No.'],
            r.Platform || 'Social Media',
            r['Original Post Link'] || '',
            r['Extra Link'] || r['Extra URL'] || '',
            r['Post Type'] || 'Content',
            r['Core Idea / 1-Line Takeaway'] || '',
            r.Status || 'Not Used',
            r['Date Saved'] || '',
            JSON.stringify(Array.isArray(r.Category) ? r.Category : (r.Category ? [r.Category] : [])),
            r.realThumb || ''
          ]);

          if (values.length > 0) {
            await pool.query(insertSql, [values]);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: records.length,
          mysqlSynced: !!pool,
          message: `Saved ${records.length} posts to database & vault.json backup.`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
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
  console.log(`🚀 Social Media Database Server running on port ${PORT}`);
  console.log(`📍 Web Interface: http://localhost:${PORT}`);
  console.log(`🗄️ MySQL Status: http://localhost:${PORT}/api/mysql/status`);
  console.log(`=================================================`);
});
