// Vercel Serverless Function — Multi-source vehicle details
// Endpoint: /api/vehicle-details?plate=38338901
// Sources: 1) data.gov.il model specs  2) meshumeshet.com scrape
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

  const details = {};
  const errors = [];

  // ── Source 1: data.gov.il — Get full vehicle record (may have extra fields) ──
  try {
    const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
    const BASE_URL = 'https://data.gov.il/api/3/action/datastore_search';
    const plateInt = parseInt(plateClean, 10);
    const url1 = `${BASE_URL}?resource_id=${RESOURCE_ID}&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateInt }))}&limit=1`;

    const resp = await fetch(url1, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      const records = data?.result?.records || [];
      if (records.length) {
        const rec = records[0];
        // Pass through ALL fields from the government record
        for (const [k, v] of Object.entries(rec)) {
          if (v && k !== '_id' && k !== 'rank') {
            details['gov_' + k] = String(v).trim();
          }
        }
        // Also store degem_cd for model specs lookup
        if (rec.degem_cd) details._degem_cd = String(rec.degem_cd);
        if (rec.tozeret_cd) details._tozeret_cd = String(rec.tozeret_cd);
      }
    }
  } catch (e) {
    errors.push('gov-main: ' + e.message);
  }

  // ── Source 2: data.gov.il — Vehicle model specs (degem-rechev) ──
  // This resource has engine displacement, horsepower, weight, etc.
  if (details._degem_cd) {
    try {
      const SPECS_RESOURCE = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';
      const BASE_URL = 'https://data.gov.il/api/3/action/datastore_search';
      const filters = { degem_cd: parseInt(details._degem_cd, 10) };
      if (details._tozeret_cd) filters.tozeret_cd = parseInt(details._tozeret_cd, 10);
      const url2 = `${BASE_URL}?resource_id=${SPECS_RESOURCE}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit=1`;

      const resp = await fetch(url2, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json();
        const records = data?.result?.records || [];
        if (records.length) {
          const rec = records[0];
          for (const [k, v] of Object.entries(rec)) {
            if (v && k !== '_id' && k !== 'rank') {
              details['specs_' + k] = String(v).trim();
            }
          }
        }
      }
    } catch (e) {
      errors.push('gov-specs: ' + e.message);
    }
  }

  // ── Source 3: meshumeshet.com scrape ──
  try {
    const mUrl = `https://meshumeshet.com/c/${plateClean}`;
    const resp = await fetch(mUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://meshumeshet.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });

    if (resp.ok) {
      const html = await resp.text();
      details._meshumeshet_link = mUrl;
      details._meshumeshet_status = 'ok';

      // Hebrew label → field key mapping
      const FIELD_MAP = {
        'מספר שלדה': 'mispar_shlada',
        'מס שלדה': 'mispar_shlada',
        'מספר מנוע': 'mispar_manoa',
        'מס מנוע': 'mispar_manoa',
        'נפח מנוע': 'nefach_manoa',
        'נפח המנוע': 'nefach_manoa',
        'גיר': 'sug_hiluchim',
        'סוג הילוכים': 'sug_hiluchim',
        'תת דגם': 'tat_degem',
        'תוצרת': 'totzeret',
        'ארץ ייצור': 'totzeret',
        'מידות צמיג קדמי': 'tzamig_kidmi',
        'צמיג קדמי': 'tzamig_kidmi',
        'מידות צמיג אחורי': 'tzamig_achori',
        'צמיג אחורי': 'tzamig_achori',
        'כוח סוס': 'koach_sus',
        'אגרת רכב': 'agrat_rechev',
        'משקל כולל': 'mishkal_kolel',
        'משקל עצמי': 'mishkal_atzmi',
        'מספר דלתות': 'mispar_dlatot',
        'מספר מושבים': 'mispar_moshvim',
      };

      for (const [heLabel, fieldKey] of Object.entries(FIELD_MAP)) {
        if (details[fieldKey]) continue; // already have from another source
        const escaped = heLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Pattern: label text, then closing tag, then opening tag, then value
        const p1 = new RegExp(escaped + '\\s*<\\/[^>]+>\\s*<[^>]+>\\s*([^<]+)', 'i');
        const m1 = html.match(p1);
        if (m1 && m1[1].trim().length > 0) {
          details[fieldKey] = m1[1].trim();
          continue;
        }

        // Pattern: label in attribute or text, followed by value after some tags
        const p2 = new RegExp(escaped + '(?:[^<]{0,5})<\\/[^>]*>(?:\\s*<[^>]*>)*\\s*([^<]{1,80})', 'i');
        const m2 = html.match(p2);
        if (m2 && m2[1].trim().length > 0 && m2[1].trim() !== heLabel) {
          details[fieldKey] = m2[1].trim();
          continue;
        }

        // Pattern: inside a table cell or div pair
        const p3 = new RegExp('<[^>]*>\\s*' + escaped + '\\s*<\\/[^>]*>[\\s\\S]{0,200}?<[^>]*>\\s*([^<]{2,80})\\s*<\\/[^>]*>', 'i');
        const m3 = html.match(p3);
        if (m3 && m3[1].trim().length > 0) {
          details[fieldKey] = m3[1].trim();
        }
      }

      // Try JSON-LD
      const jsonLd = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLd) {
        try {
          const ld = JSON.parse(jsonLd[1]);
          if (ld.vehicleIdentificationNumber && !details.mispar_shlada) details.mispar_shlada = ld.vehicleIdentificationNumber;
          if (ld.vehicleEngine?.engineDisplacement && !details.nefach_manoa) details.nefach_manoa = ld.vehicleEngine.engineDisplacement;
        } catch (e) { /* ignore */ }
      }
    } else {
      details._meshumeshet_status = 'blocked_' + resp.status;
      errors.push('meshumeshet: HTTP ' + resp.status);
    }
  } catch (e) {
    details._meshumeshet_status = 'error';
    errors.push('meshumeshet: ' + e.message);
  }

  // ── Normalize output ──
  // Map government fields to our standard keys
  const output = {
    plate: plateClean,
    source: 'multi',
    found: false,
    link: details._meshumeshet_link || `https://meshumeshet.com/c/${plateClean}`,
  };

  // Chassis number
  if (details.mispar_shlada) output.mispar_shlada = details.mispar_shlada;
  // Engine number
  if (details.mispar_manoa) output.mispar_manoa = details.mispar_manoa;
  // Engine displacement - from specs or meshumeshet
  if (details.nefach_manoa) {
    output.nefach_manoa = details.nefach_manoa;
  } else if (details.specs_nefach_manoa) {
    output.nefach_manoa = details.specs_nefach_manoa + ' סמ"ק';
  }
  // Horsepower
  if (details.koach_sus) {
    output.koach_sus = details.koach_sus;
  } else if (details.specs_koah_sus) {
    output.koach_sus = details.specs_koah_sus + ' כ"ס';
  }
  // Gear type
  if (details.sug_hiluchim) output.sug_hiluchim = details.sug_hiluchim;
  // Sub-model
  if (details.tat_degem) output.tat_degem = details.tat_degem;
  // Country of origin
  if (details.totzeret) output.totzeret = details.totzeret;
  // Tires
  if (details.tzamig_kidmi) output.tzamig_kidmi = details.tzamig_kidmi;
  if (details.tzamig_achori) output.tzamig_achori = details.tzamig_achori;
  // Weight
  if (details.mishkal_kolel) {
    output.mishkal_kolel = details.mishkal_kolel;
  } else if (details.specs_mishkal_kolel) {
    output.mishkal_kolel = details.specs_mishkal_kolel + ' ק"ג';
  }
  if (details.mishkal_atzmi) output.mishkal_atzmi = details.mishkal_atzmi;
  // Doors/seats
  if (details.mispar_dlatot) output.mispar_dlatot = details.mispar_dlatot;
  if (details.mispar_moshvim) output.mispar_moshvim = details.mispar_moshvim;
  // Vehicle fee
  if (details.agrat_rechev) output.agrat_rechev = details.agrat_rechev;

  // Check if we got any useful fields
  const usefulKeys = ['mispar_shlada', 'mispar_manoa', 'nefach_manoa', 'koach_sus', 'sug_hiluchim',
    'totzeret', 'tzamig_kidmi', 'tzamig_achori', 'mishkal_kolel', 'mishkal_atzmi',
    'mispar_dlatot', 'mispar_moshvim', 'agrat_rechev', 'tat_degem'];
  output.found = usefulKeys.some(k => output[k]);

  if (errors.length) output._errors = errors;
  if (details._meshumeshet_status) output._meshumeshet_status = details._meshumeshet_status;

  // Also pass through raw gov specs fields that might be useful
  const specFields = Object.entries(details).filter(([k]) => k.startsWith('specs_'));
  if (specFields.length) {
    output._raw_specs = {};
    specFields.forEach(([k, v]) => { output._raw_specs[k.replace('specs_', '')] = v; });
  }

  return res.status(200).json(output);
}
