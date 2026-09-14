// Vercel Serverless Function: /api/sync
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const records = Array.isArray(body) ? body : (body && (body.records || body.data));
    if (!Array.isArray(records)) {
      return res.status(400).json({ success: false, error: 'records array required' });
    }

    const pat = (body && body.pat) || process.env.GITHUB_PAT || process.env.GH_TOKEN;

    // Check if running on local Node server vs Vercel serverless
    const vaultPath = path.join(process.cwd(), 'vault.json');
    let localDiskSaved = false;
    try {
      if (fs.existsSync(vaultPath)) {
        fs.writeFileSync(vaultPath, JSON.stringify(records, null, 2), 'utf8');
        localDiskSaved = true;
      }
    } catch (e) {
      // Vercel read-only filesystem notice
    }

    // Try GitHub API commit if PAT token is present
    if (pat) {
      const repoUrl = 'https://api.github.com/repos/SidGajera/Social-Media-Content-/contents/vault.json';
      const getRes = await fetch(repoUrl, {
        headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      let sha = null;
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
      }

      const contentB64 = Buffer.from(JSON.stringify(records, null, 2), 'utf8').toString('base64');
      const payload = {
        message: `Auto-sync vault data: ${records.length} posts [${new Date().toISOString()}]`,
        content: contentB64,
        branch: 'main'
      };
      if (sha) payload.sha = sha;

      const putRes = await fetch(repoUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${pat}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(payload)
      });

      if (putRes.ok) {
        return res.status(200).json({
          success: true,
          count: records.length,
          githubSynced: true,
          message: `Successfully auto-committed ${records.length} posts directly to GitHub repository!`
        });
      } else {
        const errData = await putRes.json();
        return res.status(500).json({ success: false, error: errData.message || 'GitHub API rejected commit' });
      }
    }

    // If local disk was updated or Vercel response without PAT
    return res.status(200).json({
      success: true,
      count: records.length,
      localDiskSaved,
      message: localDiskSaved
        ? `Saved ${records.length} posts to local server vault.json.`
        : `Vault active with ${records.length} posts in browser. Enter GitHub Token in Section 3 to push direct git commits on Vercel.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
