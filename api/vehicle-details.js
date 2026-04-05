// Vercel Serverless Function — Scrape meshumeshet.com for detailed vehicle info
// Endpoint: /api/vehicle-details?plate=38338901
// Returns: chassis number, engine number, displacement, gear type, tire dimensions, etc.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { plate } = req.query;
  if (!plate) {
    return res.status(400).json({ error: 'חסר מספר רישוי' });
  }

  const plateClean = plate.replace(/[^0-9]/g, '');
  if (plateClean.length < 5 || plateClean.length > 8) {
    return res.status(400).json({ error: 'מספר רישוי לא תקין' });
  }

  try {
    // Fetch the meshumeshet.com vehicle page
    const url = `https://meshumeshet.com/c/${plateClean}`;
    console.log('[meshumeshet] Fetching:', url);

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.log('[meshumeshet] HTTP status:', resp.status);
      return res.status(resp.status === 404 ? 404 : 502).json({
        error: resp.status === 404
          ? 'הרכב לא נמצא במאגר משומשת'
          : `שגיאה בגישה למשומשת (${resp.status})`,
      });
    }

    const html = await resp.text();

    // Parse the HTML to extract vehicle details
    // meshumeshet.com uses a table/grid layout with label-value pairs
    const details = {};

    // Field mapping: Hebrew label → our field key
    const FIELD_MAP = {
      'מספר שלדה': 'mispar_shlada',
      'מס שלדה': 'mispar_shlada',
      'מספר מנוע': 'mispar_manoa',
      'מס מנוע': 'mispar_manoa',
      'נפח מנוע': 'nefach_manoa',
      'נפח המנוע': 'nefach_manoa',
      'סוג הילוכים': 'sug_hiluchim',
      'גיר': 'sug_hiluchim',
      'תת דגם': 'tat_degem',
      'תת-דגם': 'tat_degem',
      'תוצרת': 'totzeret',
      'ארץ ייצור': 'totzeret',
      'מידות צמיג קדמי': 'tzamig_kidmi',
      'צמיג קדמי': 'tzamig_kidmi',
      'מידות צמיג אחורי': 'tzamig_achori',
      'צמיג אחורי': 'tzamig_achori',
      'כוח סוס': 'koach_sus',
      'כ"ס': 'koach_sus',
      'הוראת רישום': 'horaat_rishum',
      'תאריך טסט אחרון': 'test_acharon',
      'תוקף רישיון': 'tokef_rishion',
      'צבע': 'tzeva',
      'אגרת רכב': 'agrat_rechev',
      'משקל כולל': 'mishkal_kolel',
      'משקל עצמי': 'mishkal_atzmi',
      'מספר דלתות': 'mispar_dlatot',
      'מספר מושבים': 'mispar_moshvim',
      'קבוצת זיהום': 'kvutzat_zihum',
      'רמת גימור': 'ramat_gimur',
      'סוג דלק': 'sug_delek',
      'דגם': 'degem',
      'יצרן': 'yatzran',
      'שנת עלייה לכביש': 'shnat_aliya',
      'שנת ייצור': 'shnat_yitzur',
      'מספר רכב': 'mispar_rechev',
    };

    // Strategy 1: Look for patterns like <label>field_name</label> ... <value>
    // Strategy 2: Look for table rows with label-value patterns
    // Strategy 3: Generic regex for Hebrew label followed by value

    // Try to extract data using multiple regex patterns
    for (const [heLabel, fieldKey] of Object.entries(FIELD_MAP)) {
      // Pattern 1: Label in any tag followed by value in next tag
      // e.g., <span class="label">מספר שלדה</span><span class="value">ABC123</span>
      const p1 = new RegExp(
        heLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[\\s]*<\\/[^>]+>[\\s]*<[^>]+>([^<]+)',
        'i'
      );
      const m1 = html.match(p1);
      if (m1 && m1[1].trim()) {
        details[fieldKey] = m1[1].trim();
        continue;
      }

      // Pattern 2: Label and value in same parent, separated by tags
      const p2 = new RegExp(
        heLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[^<]*(?:<[^>]*>\\s*)*([^<]{2,80})',
        'i'
      );
      const m2 = html.match(p2);
      if (m2 && m2[1].trim() && m2[1].trim() !== heLabel) {
        const val = m2[1].trim();
        // Skip if it looks like another label or HTML
        if (!val.includes('<') && val.length < 80) {
          details[fieldKey] = val;
        }
      }
    }

    // Also try to extract structured data from JSON-LD if present
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld.vehicleIdentificationNumber) details.mispar_shlada = ld.vehicleIdentificationNumber;
        if (ld.vehicleEngine?.engineDisplacement) details.nefach_manoa = ld.vehicleEngine.engineDisplacement;
      } catch (e) { /* ignore JSON parse errors */ }
    }

    // Clean up values - remove HTML entities and extra whitespace
    for (const [k, v] of Object.entries(details)) {
      if (typeof v === 'string') {
        details[k] = v
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    const foundFields = Object.keys(details).length;
    console.log(`[meshumeshet] Found ${foundFields} fields for plate ${plateClean}`);

    if (foundFields === 0) {
      // If we got HTML but couldn't parse fields, the page structure may have changed
      // Return a partial result indicating the page was found but parsing failed
      return res.status(200).json({
        plate: plateClean,
        source: 'meshumeshet',
        found: false,
        error: 'הדף נמצא אך לא ניתן לחלץ פרטים — ייתכן שמבנה האתר השתנה',
        link: url,
      });
    }

    return res.status(200).json({
      plate: plateClean,
      source: 'meshumeshet',
      found: true,
      link: url,
      ...details,
    });

  } catch (err) {
    console.error('[meshumeshet] Error:', err.message);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'meshumeshet.com לא הגיב — נסה שוב.' });
    }
    return res.status(500).json({ error: `שגיאה: ${err.message}` });
  }
}
