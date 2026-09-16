const http = require('http');
﻿const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'social_media_vault';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);

const ROOT_DIR = __dirname;
const VAULT_PATH = path.join(ROOT_DIR, 'vault.json');
const SQLITE_DB_PATH = path.join(ROOT_DIR, 'social_media_vault.db');

// Initialize local SQLite engine
const sqliteDb = new DatabaseSync(SQLITE_DB_PATH);
try { sqliteDb.exec("ALTER TABLE social_media_posts ADD COLUMN caption TEXT;"); } catch(e) {}
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS social_media_posts (
    post_no INTEGER PRIMARY KEY,
    platform TEXT,
    original_post_link TEXT,
    extra_link TEXT,
    post_type TEXT,
    takeaway TEXT,
    status TEXT,
    date_saved TEXT,
    category TEXT,
    real_thumb TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS social_media_meta (
    meta_key TEXT PRIMARY KEY,
    meta_value TEXT
  );
`);

function normalizePostUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.trim();
  if (u.includes('?')) {
    u = u.split('?')[0];
  }
  return u.replace(/\/+$/, '').toLowerCase();
}

function detectPlatformFromUrl(url) {
  if (!url || typeof url !== 'string') return 'Social Media';
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'Instagram';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'X (Twitter)';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'Facebook';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('linkedin.com')) return 'LinkedIn';
  if (u.includes('pinterest.com')) return 'Pinterest';
  if (u.includes('threads.net') || u.includes('threads.com')) return 'Threads';
  if (u.includes('github.com')) return 'GitHub Repos';
  return 'Website / Other';
}

function upsertToSQLite(records, customCategories, deletedCategories, deletedPostNos, realThumbs) {
  if (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) {
    const delStmt = sqliteDb.prepare('DELETE FROM social_media_posts WHERE post_no = ?');
    deletedPostNos.forEach(no => {
      if (no) delStmt.run(parseInt(no, 10));
    });
  }

  if (Array.isArray(records) && records.length > 0) {
    const delSet = (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) ? new Set(deletedPostNos.map(n => parseInt(n, 10))) : new Set();
    const maxStmt = sqliteDb.prepare('SELECT MAX(post_no) as max_no FROM social_media_posts');
    let maxPostNo = maxStmt.get() ? (maxStmt.get().max_no || 0) : 0;

    const stmt = sqliteDb.prepare(`
      INSERT INTO social_media_posts (post_no, platform, original_post_link, extra_link, post_type, takeaway, caption, status, date_saved, category, real_thumb)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_no) DO UPDATE SET
        platform = excluded.platform,
        original_post_link = excluded.original_post_link,
        extra_link = excluded.extra_link,
        post_type = excluded.post_type,
        takeaway = excluded.takeaway, caption = excluded.caption,
        status = excluded.status,
        date_saved = excluded.date_saved,
        category = excluded.category,
        real_thumb = excluded.real_thumb;
    `);

    records.forEach(r => {
      if (!r || typeof r !== 'object') return;
      let postNo = r['No.'] ? parseInt(r['No.'], 10) : NaN;
      if (delSet.has(postNo)) return; // Skip deleted post
      if (isNaN(postNo) || postNo <= 0) {
        maxPostNo++;
        postNo = maxPostNo;
        r['No.'] = postNo;
      } else if (postNo > maxPostNo) {
        maxPostNo = postNo;
      }

      stmt.run(
        postNo,
        r.Platform || detectPlatformFromUrl(r['Original Post Link']),
        r['Original Post Link'] || '',
        r['Extra Link'] || r['Extra URL'] || r.extraUrl || '',
        r['Post Type'] || 'Content',
        r['Core Idea / 1-Line Takeaway'] || '',
        r['Caption'] || r['Post Caption'] || '',
        r.Status || 'Not Used',
        r['Date Saved'] || '',
        JSON.stringify(Array.isArray(r.Category) ? r.Category : (r.Category ? [r.Category] : [])),
        (realThumbs && realThumbs[postNo]) || r.realThumb || ''
      );
    });
  }

  const metaStmt = sqliteDb.prepare(`
    INSERT INTO social_media_meta (meta_key, meta_value) VALUES (?, ?)
    ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value;
  `);
  if (customCategories) metaStmt.run('customCategories', JSON.stringify(customCategories));
  if (Array.isArray(deletedCategories) && deletedCategories.length > 0) metaStmt.run('deletedCategories', JSON.stringify(deletedCategories));
  if (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) metaStmt.run('deletedPostNos', JSON.stringify(deletedPostNos));
  if (realThumbs) metaStmt.run('realThumbs', JSON.stringify(realThumbs));
}

// Auto-seed SQLite from vault.json if sqlite table is empty
const countStmt = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM social_media_posts');
const existingCount = countStmt.get().cnt;
if (existingCount === 0 && fs.existsSync(VAULT_PATH)) {
  try {
    const raw = fs.readFileSync(VAULT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
    if (records.length > 0) {
      upsertToSQLite(records, parsed.customCategories, parsed.deletedCategories, parsed.deletedPostNos, parsed.realThumbs);
      console.log(`[SQLite Engine]: Auto-seeded ${records.length} records into local SQL database!`);
    }
  } catch(e) {
    console.error('[SQLite Seeding Error]:', e.message);
  }
}

async function getFromDatabase() {
  if (pool && mysqlConnected) {
    try {
      const [rows] = await pool.query('SELECT * FROM social_media_posts ORDER BY post_no DESC');
      const [metaRows] = await pool.query('SELECT * FROM social_media_meta');
      
      let customCategories = null, deletedCategories = null, deletedPostNos = null, realThumbs = {};
      metaRows.forEach(m => {
        try {
          const val = typeof m.meta_value === 'string' ? JSON.parse(m.meta_value) : m.meta_value;
          if (m.meta_key === 'customCategories') customCategories = val;
          if (m.meta_key === 'deletedCategories') deletedCategories = val;
          if (m.meta_key === 'deletedPostNos') deletedPostNos = val;
          if (m.meta_key === 'realThumbs') realThumbs = val;
        } catch(e) {}
      });

      if (!realThumbs) realThumbs = {};
      let records = rows.map(r => {
        let catArr = [];
        try {
          catArr = typeof r.category === 'string' ? JSON.parse(r.category) : r.category;
        } catch(e) {
          catArr = [r.category];
        }
        const thumb = (realThumbs && (realThumbs[r.post_no] || realThumbs[r.post_no.toString()])) || r.real_thumb || '';
        if (thumb && r.post_no) {
          realThumbs[r.post_no] = thumb;
        }
        return {
          'No.': r.post_no,
          'Platform': r.platform,
          'Original Post Link': r.original_post_link,
          'Extra Link': r.extra_link,
          'Post Type': r.post_type,
          'Core Idea / 1-Line Takeaway': r.takeaway,
          'Caption': r.caption || '',
          'Status': r.status,
          'Date Saved': r.date_saved,
          'Category': Array.isArray(catArr) ? catArr : [catArr],
          'realThumb': thumb
        };
      });

      if (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) {
        const delSet = new Set(deletedPostNos.map(n => parseInt(n, 10)));
        records = records.filter(r => r && r['No.'] && !delSet.has(parseInt(r['No.'], 10)));
      }

      if (Array.isArray(deletedCategories) && deletedCategories.length > 0) {
        const delCatsLower = deletedCategories.map(c => typeof c === 'string' ? c.toLowerCase() : '');
        records = records.map(r => {
          if (!r || !r.Category) return r;
          let cats = Array.isArray(r.Category) ? r.Category : [r.Category];
          return Object.assign({}, r, { Category: cats.filter(c => typeof c === 'string' && !delCatsLower.includes(c.toLowerCase())) });
        });
      }

      return {
        records,
        customCategories,
        deletedCategories,
        deletedPostNos,
        realThumbs,
        storage: 'mysql'
      };
    } catch (err) {
      console.error('[MySQL Read Error]:', err.message);
    }
  }
  const sqliteData = getFromSQLite();
  sqliteData.storage = 'sql_database';
  return sqliteData;
}

function getFromSQLite() {
  const rows = sqliteDb.prepare('SELECT * FROM social_media_posts ORDER BY post_no DESC').all();
  const metaRows = sqliteDb.prepare('SELECT * FROM social_media_meta').all();
  let customCategories = null, deletedCategories = null, deletedPostNos = null, realThumbs = {};
  metaRows.forEach(m => {
    try {
      if (m.meta_key === 'customCategories') customCategories = JSON.parse(m.meta_value);
      if (m.meta_key === 'deletedCategories') deletedCategories = JSON.parse(m.meta_value);
      if (m.meta_key === 'deletedPostNos') deletedPostNos = JSON.parse(m.meta_value);
      if (m.meta_key === 'realThumbs') realThumbs = JSON.parse(m.meta_value);
    } catch(e) {}
  });

  if (!realThumbs) realThumbs = {};
  const records = rows.map(r => {
    let catArr = [];
    try { catArr = r.category ? JSON.parse(r.category) : []; } catch(e) {}
    const thumb = (realThumbs && (realThumbs[r.post_no] || realThumbs[r.post_no.toString()])) || r.real_thumb || '';
    if (thumb && r.post_no) {
      realThumbs[r.post_no] = thumb;
    }
    return {
      'No.': r.post_no,
      'Platform': r.platform,
      'Original Post Link': r.original_post_link,
      'Extra Link': r.extra_link,
      'Post Type': r.post_type,
      'Core Idea / 1-Line Takeaway': r.takeaway,
          'Caption': r.caption || '',
      'Status': r.status,
      'Date Saved': r.date_saved,
      'Category': Array.isArray(catArr) ? catArr : [catArr],
      'realThumb': thumb
    };
  });

  return { records, customCategories, deletedCategories, deletedPostNos, realThumbs };
}

// Background MySQL Connection Management (Non-blocking!)
let mysql = null;
let pool = null;
let mysqlConnected = false;
let lastConnectCheck = 0;

try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.warn('[MySQL Warning]: mysql2 module not found.');
}

async function tryConnectMySQLBackground() {
  if (!mysql) return;
  const now = Date.now();
  if (now - lastConnectCheck < 5000) return;
  lastConnectCheck = now;

  try {
    const tempConn = await mysql.createConnection({
      host: MYSQL_HOST,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      port: MYSQL_PORT
    });
    await tempConn.query('CREATE DATABASE IF NOT EXISTS ' + MYSQL_DATABASE + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
    await tempConn.end();

    if (!pool) {
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
      await pool.query('CREATE TABLE IF NOT EXISTS social_media_posts (post_no INT PRIMARY KEY, platform VARCHAR(100), original_post_link TEXT, extra_link TEXT, post_type VARCHAR(200), takeaway LONGTEXT, caption LONGTEXT, status VARCHAR(100), date_saved VARCHAR(50), category TEXT, real_thumb TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
      try { await pool.query('ALTER TABLE social_media_posts ADD COLUMN caption LONGTEXT;'); } catch(e) {}
      await pool.query('CREATE TABLE IF NOT EXISTS social_media_meta (meta_key VARCHAR(100) PRIMARY KEY, meta_value LONGTEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
      console.log(`[MySQL Database Engine]: Connected to ${MYSQL_DATABASE} at ${MYSQL_HOST}:${MYSQL_PORT}`);
    }

    mysqlConnected = true;

    // Auto-seed MySQL if table is empty
    const [cntRows] = await pool.query('SELECT COUNT(*) as cnt FROM social_media_posts');
    const mysqlCount = cntRows && cntRows[0] ? cntRows[0].cnt : 0;
    if (mysqlCount === 0 && fs.existsSync(VAULT_PATH)) {
      try {
        const raw = fs.readFileSync(VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
        if (records.length > 0) {
          await upsertPostsToMySQL(records, parsed.customCategories, parsed.deletedCategories, parsed.deletedPostNos, parsed.realThumbs);
          console.log(`[MySQL Database Engine]: Auto-seeded ${records.length} records into MySQL database '${MYSQL_DATABASE}'`);
        }
      } catch(e) {
        console.error('[MySQL Auto-Seed Error]:', e.message);
      }
    }
  } catch(err) {
    mysqlConnected = false;
  }
}

async function upsertPostsToMySQL(records, customCategories, deletedCategories, deletedPostNos, realThumbs) {
  if (!pool) return 0;
  const delSet = (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) ? new Set(deletedPostNos.map(n => parseInt(n, 10))) : new Set();

  if (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) {
    const validNos = deletedPostNos.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
    if (validNos.length > 0) {
      try {
        await pool.query('DELETE FROM social_media_posts WHERE post_no IN (?)', [validNos]);
      } catch(e) {}
    }
  }

  const activeRecords = (Array.isArray(records) ? records : []).filter(r => r && r['No.'] && !delSet.has(parseInt(r['No.'], 10)));

  if (activeRecords.length > 0) {
    const insertSql = 'INSERT INTO social_media_posts (post_no, platform, original_post_link, extra_link, post_type, takeaway, caption, status, date_saved, category, real_thumb) VALUES ? ON DUPLICATE KEY UPDATE platform = VALUES(platform), original_post_link = VALUES(original_post_link), extra_link = VALUES(extra_link), post_type = VALUES(post_type), takeaway = VALUES(takeaway), status = VALUES(status), date_saved = VALUES(date_saved), category = VALUES(category), real_thumb = VALUES(real_thumb);';
    const values = activeRecords.map(r => [
      r['No.'],
      r.Platform || detectPlatformFromUrl(r['Original Post Link']),
      r['Original Post Link'] || '',
      r['Extra Link'] || r['Extra URL'] || r.extraUrl || '',
      r['Post Type'] || 'Content',
      r['Core Idea / 1-Line Takeaway'] || '',
      r['Caption'] || r['Post Caption'] || '',
      r.Status || 'Not Used',
      r['Date Saved'] || '',
      JSON.stringify(Array.isArray(r.Category) ? r.Category : (r.Category ? [r.Category] : [])),
      (realThumbs && realThumbs[r['No.'].toString()]) || (realThumbs && realThumbs[r['No.']]) || r.realThumb || ''
    ]);
    await pool.query(insertSql, [values]);
  }

  if (customCategories) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'customCategories\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(customCategories)]);
  if (Array.isArray(deletedCategories) && deletedCategories.length > 0) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'deletedCategories\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(deletedCategories)]);
  if (Array.isArray(deletedPostNos) && deletedPostNos.length > 0) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'deletedPostNos\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(deletedPostNos)]);
  if (realThumbs) await pool.query('INSERT INTO social_media_meta (meta_key, meta_value) VALUES (\'realThumbs\', ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)', [JSON.stringify(realThumbs)]);

  return activeRecords.length;
}

// Initial background check
tryConnectMySQLBackground();
setInterval(tryConnectMySQLBackground, 10000);

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

  // GET /api/mysql/status or /api/status
  if (req.method === 'GET' && (pathname === '/api/mysql/status' || pathname === '/api/status')) {
    const data = await getFromDatabase();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      mysqlConnected,
      sqliteConnected: true,
      count: data.records.length,
      host: MYSQL_HOST,
      database: MYSQL_DATABASE
    }));
    return;
  }

  // GET /api/mysql/posts or GET /api/sync - ALWAYS INSTANT!
  if (req.method === 'GET' && (pathname === '/api/mysql/posts' || pathname === '/api/sync' || pathname === '/get-vault')) {
    const data = await getFromDatabase();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      storage: mysqlConnected ? 'mysql' : 'sql_database',
      mysqlConnected,
      count: data.records.length,
      records: data.records,
      customCategories: data.customCategories,
      deletedCategories: data.deletedCategories,
      deletedPostNos: data.deletedPostNos,
      realThumbs: data.realThumbs
    }));
    return;
  }

  
function formatCarouselTextServer(text, postType) {
  if (!text || typeof text !== 'string') return text || '';
  let str = text.trim();
  if (!str) return str;
  str = str.replace(/\?\?\s*/g, '');
  if (str.includes('Carousel Image') || str.includes('Slide')) return str;
  const isCarousel = (postType || '').toLowerCase().includes('carousel') || str.toLowerCase().includes('carousel') || str.toLowerCase().includes('slide');
  const lines = str.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const explicitMatches = str.split(/(?=(?:Slide|Image|Page|Card)\s*#?\d+)/i).filter(b => b.trim());
  if (explicitMatches.length > 1) {
    return explicitMatches.map((m, idx) => {
      let cleanBody = m.replace(/^(?:Slide|Image|Page|Card)\s*#?\d+[:\-\s]*/i, '').trim();
      let bulletBody = cleanBody.split(/\r?\n/).map(l => {
        let cl = l.replace(/^[?\-*•📍✨▶\u2022\uFFFD\u25CF\s]+/, '').trim();
        return cl ? '• ' + cl : '';
      }).filter(Boolean).join('\n');
      return 'Carousel Image ' + (idx + 1) + ' / Slide ' + (idx + 1) + ':\n' + (bulletBody || ('• ' + cleanBody));
    }).join('\n\n');
  }
  if (isCarousel || lines.length > 1) {
    const slideItems = lines.length >= 2 ? lines : str.split(/(?<=\.)\s+/).filter(s => s.trim().length > 5);
    if (slideItems.length >= 2) {
      return slideItems.map((item, idx) => {
        let cl = item.replace(/^[?\-*•📍✨▶\u2022\uFFFD\u25CF\s]+/, '').trim();
        let label = idx === 0 ? 'Carousel Image 1 / Slide 1 (Cover & Overview)' : 'Carousel Image ' + (idx + 1) + ' / Slide ' + (idx + 1);
        return label + ':\n• ' + cl;
      }).join('\n\n');
    }
  }
  return 'Carousel Image 1 / Slide 1 (Cover & Overview):\n• ' + str.replace(/^[?\-*•📍✨▶\u2022\uFFFD\u25CF\s]+/, '').trim();
}

// POST /api/add-post - Direct Server-Authoritative Add/Update Post Endpoint!
  if (req.method === 'POST' && pathname === '/api/add-post') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const item = JSON.parse(body);
        if (!item || !item.link) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Post link is required' }));
          return;
        }

        const data = await getFromDatabase();
        let records = data.records || [];
        let realThumbs = data.realThumbs || {};

        const normLink = normalizePostUrl(item.link);
        let existingRec = records.find(r => r && r['Original Post Link'] && normalizePostUrl(r['Original Post Link']) === normLink);

        let targetNo;
        const cats = Array.isArray(item.categories) ? item.categories : (item.categories ? [item.categories] : ['Content Creation']);

        if (existingRec) {
          targetNo = existingRec['No.'];
          existingRec['Category'] = Array.from(new Set([...(existingRec['Category'] || []), ...cats]));
          if (item.takeaway) { item.takeaway = formatCarouselTextServer(item.takeaway, item.postType || existingRec['Post Type']); existingRec['Core Idea / 1-Line Takeaway'] = item.takeaway; }
          if (item.platform) existingRec['Platform'] = item.platform;
          if (item.postType) existingRec['Post Type'] = item.postType;
          if (item.extraUrl !== undefined) existingRec['Extra Link'] = item.extraUrl;
          if (item.thumbUrl) {
            realThumbs[targetNo] = item.thumbUrl;
            existingRec.realThumb = item.thumbUrl;
          }
        } else {
          const maxStmt = sqliteDb.prepare('SELECT MAX(post_no) as max_no FROM social_media_posts');
          let maxVal = maxStmt.get() ? (maxStmt.get().max_no || 0) : 0;
          const delNos = data.deletedPostNos || [];
          if (delNos.length > 0) {
            const maxDel = Math.max(...delNos.map(n => parseInt(n, 10) || 0));
            if (maxDel > maxVal) maxVal = maxDel;
          }
          if (records.length > 0) {
            const maxRec = Math.max(...records.map(r => parseInt(r['No.'], 10) || 0));
            if (maxRec > maxVal) maxVal = maxRec;
          }
          targetNo = maxVal + 1;

          const newRec = {
            'No.': targetNo,
            'Platform': item.platform || detectPlatformFromUrl(item.link),
            'Original Post Link': item.link,
            'Extra Link': item.extraUrl || '',
            'Post Type': item.postType || cats[0] || 'Content',
            'Core Idea / 1-Line Takeaway': item.takeaway || 'Added via direct server add',
            'Status': 'Not Used',
            'Date Saved': item.dateSaved || new Date().toISOString().slice(0, 10),
            'Category': cats
          };

          if (item.thumbUrl) {
            realThumbs[targetNo] = item.thumbUrl;
            newRec.realThumb = item.thumbUrl;
          }

          records.unshift(newRec);
        }

        // Save to SQLite
        upsertToSQLite(records, data.customCategories, data.deletedCategories, data.deletedPostNos, realThumbs);

        // Save to vault.json backup
        const vaultObj = {
          records,
          customCategories: data.customCategories || [],
          deletedCategories: data.deletedCategories || [],
          deletedPostNos: data.deletedPostNos || [],
          realThumbs
        };
        fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

        // Sync to MySQL if connected
        if (pool && mysqlConnected) {
          try {
            await upsertPostsToMySQL(records, data.customCategories, data.deletedCategories, data.deletedPostNos, realThumbs);
          } catch(e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Post saved directly to server database!',
          postNo: targetNo,
          count: records.length,
          records,
          customCategories: data.customCategories,
          realThumbs
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }


  // POST /api/delete-post - Direct Server Delete Post Endpoint!
  if (req.method === 'POST' && pathname === '/api/delete-post') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const postNo = parseInt(payload.postNo || payload.no, 10);
        if (postNo) {
          sqliteDb.prepare('DELETE FROM social_media_posts WHERE post_no = ?').run(postNo);

          if (pool && mysqlConnected) {
            try {
              await pool.query('DELETE FROM social_media_posts WHERE post_no = ?', [postNo]);
            } catch(e) {
              console.error('[MySQL Delete Post Error]:', e.message);
            }
          }

          const data = await getFromDatabase();
          let records = (data.records || []).filter(r => r && parseInt(r['No.'], 10) !== postNo);
          let deletedPostNos = data.deletedPostNos || [];
          if (!deletedPostNos.includes(postNo)) deletedPostNos.push(postNo);

          const vaultObj = {
            records,
            customCategories: data.customCategories || [],
            deletedCategories: data.deletedCategories || [],
            deletedPostNos,
            realThumbs: data.realThumbs || {}
          };
          fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

          upsertToSQLite(records, data.customCategories, data.deletedCategories, deletedPostNos, data.realThumbs);
          if (pool && mysqlConnected) {
            try {
              await upsertPostsToMySQL(records, data.customCategories, data.deletedCategories, deletedPostNos, data.realThumbs);
            } catch(e) {}
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Post deleted from server' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // POST /api/delete-category - Direct Server Delete Category Endpoint!
  if (req.method === 'POST' && pathname === '/api/delete-category') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const catName = (payload.name || payload.categoryName || payload.catName || '').trim();
        if (catName) {
          const data = await getFromDatabase();
          let customCategories = (data.customCategories || []).filter(c => c && c.name && c.name.toLowerCase() !== catName.toLowerCase());
          let deletedCategories = data.deletedCategories || [];
          if (!deletedCategories.some(d => d.toLowerCase() === catName.toLowerCase())) {
            deletedCategories.push(catName);
          }

          // Strip deleted category from records
          let records = (data.records || []).map(r => {
            if (!r || !r.Category) return r;
            let cats = Array.isArray(r.Category) ? r.Category : [r.Category];
            cats = cats.filter(c => typeof c === 'string' && c.toLowerCase() !== catName.toLowerCase());
            return Object.assign({}, r, { Category: cats });
          });

          upsertToSQLite(records, customCategories, deletedCategories, data.deletedPostNos, data.realThumbs);

          const vaultObj = {
            records,
            customCategories,
            deletedCategories,
            deletedPostNos: data.deletedPostNos || [],
            realThumbs: data.realThumbs || {}
          };
          fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

          if (pool && mysqlConnected) {
            try {
              await upsertPostsToMySQL(records, customCategories, deletedCategories, data.deletedPostNos, data.realThumbs);
            } catch(e) {}
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Category deleted from server', customCategories, deletedCategories, records }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Category name is required' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // POST /api/add-category - Direct Server-Authoritative Add Category Endpoint!
  if (req.method === 'POST' && pathname === '/api/add-category') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const cat = JSON.parse(body);
        if (!cat || !cat.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Category name is required' }));
          return;
        }

        const data = await getFromDatabase();
        let customCategories = data.customCategories || [];

        if (!customCategories.some(c => c.name.toLowerCase() === cat.name.toLowerCase())) {
          customCategories.push({
            name: cat.name,
            color: cat.color || '#FFD700',
            desc: cat.desc || ''
          });
        }

        upsertToSQLite(data.records, customCategories, data.deletedCategories, data.deletedPostNos, data.realThumbs);

        const vaultObj = {
          records: data.records,
          customCategories,
          deletedCategories: data.deletedCategories || [],
          deletedPostNos: data.deletedPostNos || [],
          realThumbs: data.realThumbs || {}
        };
        fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

        if (pool && mysqlConnected) {
          try {
            await upsertPostsToMySQL(data.records, customCategories, data.deletedCategories, data.deletedPostNos, data.realThumbs);
          } catch(e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Category saved directly to server database!',
          customCategories,
          records: data.records
        }));
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // POST /api/mysql/sync or POST /api/sync - Full Batch Sync
  if (req.method === 'POST' && (pathname === '/api/mysql/sync' || pathname === '/api/sync' || pathname === '/save-vault')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        let records = Array.isArray(payload) ? payload : (payload.records || payload.data || []);
        const dbData = await getFromDatabase();

        const mergedDelNos = Array.from(new Set([
          ...(dbData.deletedPostNos || []),
          ...(payload.deletedPostNos || [])
        ]));
        const mergedDelCats = Array.from(new Set([
          ...(dbData.deletedCategories || []),
          ...(payload.deletedCategories || [])
        ]));

        if (mergedDelNos.length > 0 && Array.isArray(records)) {
          records = records.filter(r => r && r['No.'] && !mergedDelNos.includes(parseInt(r['No.'], 10)));
        }

        const customCats = payload.customCategories || dbData.customCategories || [];
        const thumbs = payload.realThumbs || dbData.realThumbs || {};

        // 1. Instantly save to local SQL database
        upsertToSQLite(records, customCats, mergedDelCats, mergedDelNos, thumbs);

        // 2. Save backup vault.json
        const vaultObj = {
          records,
          customCategories: customCats,
          deletedCategories: mergedDelCats,
          deletedPostNos: mergedDelNos,
          realThumbs: thumbs
        };
        fs.writeFileSync(VAULT_PATH, JSON.stringify(vaultObj, null, 2), 'utf8');

        // 3. Sync to MySQL if connected
        if (pool && mysqlConnected) {
          try {
            await upsertPostsToMySQL(records, customCats, mergedDelCats, mergedDelNos, thumbs);
          } catch(e) {
            console.error('[MySQL Save Error]:', e.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: Array.isArray(records) ? records.length : 0,
          mysqlSynced: mysqlConnected,
          storage: 'sql_permanent_db'
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

server.listen(PORT, () => {
  console.log('=================================================');
  console.log('🚀 Social Media Direct SQL Server running on port ' + PORT);
  console.log('📍 Web Interface: http://localhost:' + PORT);
  console.log('🗄️ SQL Direct API: http://localhost:' + PORT + '/api/add-post');
  console.log('=================================================');
});
