// Vehicle DB API — serves slices of the DB instead of exposing the full file.
// Actions: makes, models, years, issues

const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = 60;
const rlMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter(t => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) { rlMap.set(ip, arr); return false; }
  arr.push(now); rlMap.set(ip, arr);
  if (rlMap.size > 5000) { for (const k of rlMap.keys()) { rlMap.delete(k); if (rlMap.size < 2500) break; } }
  return true;
}

let DB = null;
function loadDB() {
  if (DB) return DB;
  try { DB = require('../data/vehicle_db.json'); } catch (e) { DB = {}; }
  return DB;
}

const SAFE = /^[A-Za-z0-9 \-_'./()]{1,60}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'יותר מדי בקשות' });
  }

  const db = loadDB();
  const { action, make, model, year } = req.query || {};

  if (!action) return res.status(400).json({ error: 'חסר action' });

  // Validate inputs
  for (const [k, v] of Object.entries({ make, model, year })) {
    if (v != null && (typeof v !== 'string' || !SAFE.test(v))) {
      return res.status(400).json({ error: 'פרמטר לא תקין: ' + k });
    }
  }

  try {
    if (action === 'makes') {
      return res.status(200).json({ makes: Object.keys(db).sort() });
    }
    if (action === 'models') {
      if (!make || !db[make]) return res.status(404).json({ error: 'יצרן לא נמצא' });
      return res.status(200).json({ models: Object.keys(db[make]).sort() });
    }
    if (action === 'years') {
      if (!make || !model || !db[make] || !db[make][model]) return res.status(404).json({ error: 'דגם לא נמצא' });
      return res.status(200).json({ years: Object.keys(db[make][model]).sort((a, b) => b - a) });
    }
    if (action === 'issues') {
      if (!make || !model || !year) return res.status(400).json({ error: 'חסרים פרמטרים' });
      const issues = db[make] && db[make][model] && db[make][model][year];
      if (!issues) return res.status(200).json({ issues: null });
      return res.status(200).json({ issues });
    }
    return res.status(400).json({ error: 'action לא תקין' });
  } catch (e) {
    return res.status(500).json({ error: 'שגיאה פנימית' });
  }
};
