// Vercel Serverless Function — DTC (Diagnostic Trouble Code) Database Lookup
// Endpoints:
//   /api/dtc-lookup?code=P0300  → Returns full code info
//   /api/dtc-lookup?search=term → Searches Hebrew descriptions

// Simple in-memory rate limiter (per-IP)
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

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'יותר מדי בקשות — נסה שוב בעוד דקה' });
  }

  let { code, search } = req.query;

  // Input validation
  if (code) {
    if (typeof code !== 'string' || code.length > 8 || !/^[PBCUpbcu][0-9A-Fa-f]{4}$/.test(code.trim())) {
      return res.status(400).json({ error: 'קוד תקלה לא תקין — פורמט: P/B/C/U + 4 תווים' });
    }
  }
  if (search) {
    if (typeof search !== 'string' || search.length > 50) {
      return res.status(400).json({ error: 'חיפוש ארוך מדי' });
    }
  }

  // Load DTC database from public directory
  let dtcDb = {};
  try {
    // In Vercel, we can require JSON directly
    dtcDb = require('../public/dtc_db.json');
  } catch (err) {
    console.error('[dtc-lookup] Failed to load DTC database:', err.message);
    return res.status(500).json({ error: 'לא ניתן לטעון את מסד נתוני הקודים' });
  }

  // Search mode: find codes matching Hebrew text
  if (search) {
    const searchTerm = search.toLowerCase().trim();
    if (searchTerm.length < 2) {
      return res.status(400).json({ error: 'חיפוש: הזן לפחות 2 תווים' });
    }

    const results = [];
    for (const [codeKey, codeData] of Object.entries(dtcDb)) {
      const he = (codeData.he || '').toLowerCase();
      const desc = (codeData.mechanic || '').toLowerCase();
      const system = (codeData.system || '').toLowerCase();

      if (he.includes(searchTerm) || desc.includes(searchTerm) || system.includes(searchTerm)) {
        results.push({
          code: codeKey,
          en: codeData.en,
          he: codeData.he,
          system: codeData.system,
          urgency: codeData.urgency,
        });
      }
    }

    if (results.length === 0) {
      return res.status(404).json({
        error: `לא נמצאו קודים עבור: "${search}"`,
        count: 0,
        results: []
      });
    }

    return res.status(200).json({
      count: results.length,
      results: results.slice(0, 20), // Limit to 20 results
      query: search
    });
  }

  // Code mode: lookup specific code or code prefix
  if (!code) {
    return res.status(400).json({ error: 'הזן קוד (code=P0300) או חיפוש (search=...)' });
  }

  const codeUpper = code.toUpperCase().trim();

  // Exact match
  if (dtcDb[codeUpper]) {
    const data = dtcDb[codeUpper];
    return res.status(200).json({
      code: codeUpper,
      en: data.en,
      he: data.he,
      system: data.system,
      urgency: data.urgency,
      mechanic: data.mechanic,
      fix: data.fix || [],
      parts: data.parts || [],
      match_type: 'exact'
    });
  }

  // Prefix match: e.g., P03 matches P0300-P0399
  const codePrefix = codeUpper.substring(0, 3);
  let prefixMatches = [];
  for (const [key, data] of Object.entries(dtcDb)) {
    if (key.startsWith(codePrefix)) {
      prefixMatches.push({
        code: key,
        en: data.en,
        he: data.he,
        system: data.system,
        urgency: data.urgency
      });
    }
  }

  if (prefixMatches.length > 0) {
    return res.status(200).json({
      error: `קוד מדויק "${codeUpper}" לא נמצא. נמצאו קודים דומים:`,
      count: prefixMatches.length,
      results: prefixMatches.slice(0, 10),
      match_type: 'prefix',
      hint: 'בחר קוד מהרשימה ליותר פרטים'
    });
  }

  // Smart fallback: generate explanation from code structure
  const fallback = generateFallback(codeUpper);
  if (fallback) {
    return res.status(200).json({
      code: codeUpper,
      ...fallback,
      match_type: 'generic',
      hint: 'הסבר כללי לפי משפחת הקוד. ייתכן שהקוד יצרן-ספציפי — בדוק במדריך הרכב.'
    });
  }

  return res.status(404).json({
    error: `קוד "${codeUpper}" לא תקין`,
    hint: 'פורמט חוקי: P/B/C/U + 4 ספרות (למשל P0300)',
    code: codeUpper
  });
};

// Generate generic Hebrew explanation for unknown codes based on OBD2 structure
function generateFallback(code) {
  const m = code.match(/^([PBCU])([0-3])([0-9A-F])([0-9A-F]{2})$/i);
  if (!m) return null;
  const [, family, second, group, sub] = m;

  const families = {
    'P': { name: 'מערכת הנעה (Powertrain)', system: 'engine' },
    'B': { name: 'מערכת גוף (Body)', system: 'body' },
    'C': { name: 'מערכת שלדה (Chassis)', system: 'brakes' },
    'U': { name: 'מערכת תקשורת (Network)', system: 'network' }
  };

  const isManufacturer = second === '1' || second === '3';
  const groupNames = {
    'P': {
      '0': 'מערכת דלק ואוויר',
      '1': 'מערכת דלק ואוויר',
      '2': 'מערכת הזרקת דלק',
      '3': 'מערכת הצתה / פספוסי הצתה',
      '4': 'מערכת בקרת פליטות',
      '5': 'בקרת מהירות / סרק / קלט-פלט',
      '6': 'מחשב מנוע ופלט',
      '7': 'תיבת הילוכים',
      '8': 'תיבת הילוכים',
      '9': 'תיבת הילוכים / מערכות SCR',
      'A': 'מערכת היברידית / מתח גבוה',
      'B': 'מערכת היברידית',
      'C': 'מערכת היברידית',
      'D': 'רכב חשמלי',
    }
  };

  const fam = families[family.toUpperCase()];
  const groupName = (groupNames[family.toUpperCase()] || {})[group.toUpperCase()] || 'תת-מערכת';
  const mfgNote = isManufacturer ? ' (קוד יצרן-ספציפי)' : ' (קוד גנרי OBD2)';

  return {
    he: `קוד ${code} — ${fam.name} — ${groupName}${mfgNote}`,
    system: fam.system,
    urgency: 'medium',
    mechanic: `קוד זה שייך ל${fam.name}, תת-קבוצה: ${groupName}. ${isManufacturer ? 'זהו קוד יצרן-ספציפי — בדוק במדריך השירות של היצרן לפרטים מדויקים.' : 'זהו קוד גנרי OBD2.'} מומלץ לסרוק עם סורק יצרן-ספציפי לפרטים נוספים.`,
    fix: [
      'סרוק עם סורק יצרן-ספציפי לקבלת קוד מלא',
      'בדוק חיווט ומחברים בתת-המערכת הרלוונטית',
      'בדוק קודים נוספים שעלולים להיות קשורים',
      'התייעץ עם מדריך השירות של היצרן',
      'נקה קודים ובדוק אם הקוד חוזר'
    ],
    parts: []
  };
}
