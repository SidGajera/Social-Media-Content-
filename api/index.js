const fs = require('fs');
const path = require('path');

const VAULT_PATH = path.join('/tmp', 'vault.json');
const ROOT_VAULT_PATH = path.join(__dirname, '..', 'vault.json');

function loadVault() {
  if (fs.existsSync(VAULT_PATH)) {
    try { return JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(ROOT_VAULT_PATH)) {
    try { return JSON.parse(fs.readFileSync(ROOT_VAULT_PATH, 'utf8')); } catch (e) {}
  }
  return { records: [], customCategories: [], deletedCategories: [], deletedPostNos: [], realThumbs: {} };
}

function saveVault(data) {
  try { fs.writeFileSync(VAULT_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;
  let vault = loadVault();

  if (req.method === 'GET' && (pathname.includes('/posts') || pathname.includes('/sync') || pathname.includes('get-vault'))) {
    res.status(200).json({
      success: true,
      storage: 'vercel_server_vault',
      count: vault.records ? vault.records.length : 0,
      records: vault.records || [],
      customCategories: vault.customCategories || [],
      deletedCategories: vault.deletedCategories || [],
      deletedPostNos: vault.deletedPostNos || [],
      realThumbs: vault.realThumbs || {}
    });
    return;
  }

  if (req.method === 'GET' && pathname.includes('/status')) {
    res.status(200).json({ status: 'online', storage: 'vercel_server', count: vault.records ? vault.records.length : 0 });
    return;
  }

  if (req.method === 'POST' && pathname.includes('/add-post')) {
    const item = req.body || {};
    if (!item || !item.link) { res.status(400).json({ success: false, error: 'Post link is required' }); return; }

    let records = vault.records || [];
    let realThumbs = vault.realThumbs || {};
    let existingRec = records.find(r => r && r['Original Post Link'] === item.link);
    let targetNo;
    const cats = Array.isArray(item.categories) ? item.categories : (item.categories ? [item.categories] : ['Content Creation']);

    if (existingRec) {
      targetNo = existingRec['No.'];
      existingRec['Category'] = Array.from(new Set([...(existingRec['Category'] || []), ...cats]));
      if (item.takeaway) existingRec['Core Idea / 1-Line Takeaway'] = item.takeaway;
      if (item.platform) existingRec['Platform'] = item.platform;
      if (item.postType) existingRec['Post Type'] = item.postType;
      if (item.extraUrl !== undefined) existingRec['Extra Link'] = item.extraUrl;
      if (item.thumbUrl) { realThumbs[targetNo] = item.thumbUrl; existingRec.realThumb = item.thumbUrl; }
    } else {
      const maxNo = records.reduce((max, r) => Math.max(max, r['No.'] || 0), 0);
      targetNo = maxNo + 1;
      const newRec = {
        'No.': targetNo,
        'Platform': item.platform || 'Social Media',
        'Original Post Link': item.link,
        'Extra Link': item.extraUrl || '',
        'Post Type': item.postType || cats[0] || 'Content',
        'Core Idea / 1-Line Takeaway': item.takeaway || 'Added via server API',
        'Status': 'Not Used',
        'Date Saved': item.dateSaved || new Date().toISOString().slice(0, 10),
        'Category': cats,
        'realThumb': item.thumbUrl || ''
      };
      if (item.thumbUrl) realThumbs[targetNo] = item.thumbUrl;
      records.unshift(newRec);
    }
    vault.records = records;
    vault.realThumbs = realThumbs;
    saveVault(vault);
    res.status(200).json({ success: true, message: 'Post saved directly to Vercel server vault!', postNo: targetNo, count: records.length, records, realThumbs });
    return;
  }

  if (req.method === 'POST' && pathname.includes('/add-category')) {
    const cat = req.body || {};
    if (!cat || !cat.name) { res.status(400).json({ success: false, error: 'Category name required' }); return; }
    let customCategories = vault.customCategories || [];
    if (!customCategories.some(c => c.name.toLowerCase() === cat.name.toLowerCase())) {
      customCategories.push({ name: cat.name, color: cat.color || '#FFD700', desc: cat.desc || '' });
    }
    vault.customCategories = customCategories;
    saveVault(vault);
    res.status(200).json({ success: true, customCategories, records: vault.records });
    return;
  }

  if (req.method === 'POST') {
    const payload = req.body || {};
    const records = Array.isArray(payload) ? payload : (payload.records || payload.data || vault.records);
    if (Array.isArray(records) && records.length > 0) {
      vault.records = records;
      if (payload.customCategories) vault.customCategories = payload.customCategories;
      if (payload.deletedCategories) vault.deletedCategories = payload.deletedCategories;
      if (payload.deletedPostNos) vault.deletedPostNos = payload.deletedPostNos;
      if (payload.realThumbs) vault.realThumbs = payload.realThumbs;
      saveVault(vault);
    }
    res.status(200).json({ success: true, count: vault.records ? vault.records.length : 0, storage: 'vercel_server' });
    return;
  }
  res.status(404).json({ error: 'Endpoint not found' });
};