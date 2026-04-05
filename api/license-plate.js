// Vercel Serverless Function — Proxy for data.gov.il license plate lookup
// Endpoint: /api/license-plate?plate=1234567

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { plate } = req.query;
  if (!plate) {
    return res.status(400).json({ error: 'חסר מספר רישוי' });
  }

  const plateClean = plate.replace(/[^0-9]/g, '');
  if (plateClean.length < 5 || plateClean.length > 8) {
    return res.status(400).json({ error: 'מספר רישוי לא תקין — הזן 5-8 ספרות' });
  }

  const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
  const BASE_URL = 'https://data.gov.il/api/3/action/datastore_search';

  // Hebrew → English manufacturer mapping
  const HE_TO_EN_MAKE = {
    "טויוטה": "TOYOTA", "יונדאי": "HYUNDAI", "קיה": "KIA", "מאזדה": "MAZDA",
    "הונדה": "HONDA", "ניסאן": "NISSAN", "מיצובישי": "MITSUBISHI", "סוזוקי": "SUZUKI",
    "פולקסווגן": "VOLKSWAGEN", "פולקסוואגן": "VOLKSWAGEN",
    "ב.מ.וו": "BMW", "ב מ וו": "BMW", "BMW": "BMW",
    "מרצדס": "MERCEDES-BENZ", "מרצדס בנץ": "MERCEDES-BENZ",
    "אאודי": "AUDI", "סובארו": "SUBARU", "שברולט": "CHEVROLET", "פורד": "FORD",
    "פיג'ו": "PEUGEOT", "פג'ו": "PEUGEOT", "דייהטסו": "DAIHATSU",
    "פיאט": "FIAT", "אופל": "OPEL", "וולוו": "VOLVO",
    "לקסוס": "LEXUS", "אינפיניטי": "INFINITI", "מיני": "MINI",
    "ג'יפ": "JEEP", "קרייזלר": "CHRYSLER", "דודג'": "DODGE", "טסלה": "TESLA",
    "פורשה": "PORSCHE", "לנד רובר": "LAND ROVER", "יגואר": "JAGUAR",
    "סמארט": "SMART", "סיאט": "SEAT", "סקודה": "SKODA",
    "סיטרואן": "CITROEN", "רנו": "RENAULT", "אלפא רומיאו": "ALFA ROMEO",
    "ג'נסיס": "GENESIS", "קופרה": "CUPRA", "אם ג'י": "MG", "אם.ג'י": "MG",
    "בי.ווי.די": "BYD", "BYD": "BYD", "צ'רי": "CHERY", "ג'ילי": "GEELY",
    "סאנגיונג": "SSANGYONG", "איסוזו": "ISUZU", "דאצ'יה": "DACIA", "סאאב": "SAAB",
  };

  const HE_TO_EN_MODEL = {
    "קורולה": "Corolla", "קאמרי": "Camry", "יאריס": "Yaris", "ראב 4": "RAV4",
    "לנד קרוזר": "Land Cruiser", "היילקס": "Hilux", "פריוס": "Prius",
    "אוריס": "Auris", "אייגו": "Aygo", "סי-אייצ'אר": "C-HR",
    "i10": "i10", "i20": "i20", "i25": "Accent", "i30": "i30", "i35": "Elantra",
    "טוסון": "Tucson", "סנטה פה": "Santa Fe", "קונה": "Kona", "איוניק": "IONIQ",
    "אלנטרה": "Elantra", "סונטה": "Sonata",
    "פיקנטו": "Picanto", "ריו": "Rio", "סיד": "Ceed", "ספורטז'": "Sportage",
    "סורנטו": "Sorento", "נירו": "Niro", "סטוניק": "Stonic",
    "גולף": "Golf", "פולו": "Polo", "טיגואן": "Tiguan", "פאסט": "Passat",
    "סיוויק": "Civic", "ג'אז": "Fit", "CR-V": "CR-V",
    "סוויפט": "Swift", "באלנו": "Baleno", "ויטרה": "Vitara", "ג'ימני": "Jimny",
    "לנסר": "Lancer", "אאוטלנדר": "Outlander",
    "מיקרה": "Micra", "ג'וק": "Juke", "קשקאי": "Qashqai", "אקס-טרייל": "X-Trail",
    "אוקטביה": "Octavia", "פאביה": "Fabia", "סופרב": "Superb", "קארוק": "Karoq",
    "קודיאק": "Kodiaq", "סקאלה": "Scala",
    "איביזה": "Ibiza", "לאון": "Leon", "ארונה": "Arona",
    "208": "208", "308": "308", "2008": "2008", "3008": "3008",
    "קליאו": "Clio", "מגאן": "Megane", "קפצ'ור": "Captur",
    "איגניס": "Ignis", "סלריו": "Celerio", "אלטו": "Alto", "SX4": "SX4",
    "אס.איקס.4": "SX4 S-Cross", "ספלאש": "Splash",
    "יאריס קרוס": "Yaris Cross", "סי-אייצ'אר": "C-HR",
    "קאמיק": "Kamiq", "אנייאק": "Enyaq", "ייטי": "Yeti", "רפיד": "Rapid", "רומסטר": "Roomster",
    "אטקה": "Ateca", "טאראקו": "Tarraco", "טולדו": "Toledo", "אלהמברה": "Alhambra",
    "C3": "C3", "C4": "C4", "C5": "C5", "C1": "C1", "ברלינגו": "Berlingo",
    "C3 איירקרוס": "C3 Aircross", "C4 קקטוס": "C4 Cactus", "C5 איירקרוס": "C5 Aircross",
    "DS3": "DS3", "DS4": "DS4", "DS7": "DS7",
    "קדז'אר": "Kadjar", "קוליאוס": "Koleos", "סניק": "Scenic", "פלואנס": "Fluence",
    "קנגו": "Kangoo", "אוסטרל": "Austral", "ארקנה": "Arkana", "זואי": "ZOE", "דאסטר": "Duster",
    "סנדרו": "Sandero", "לוגאן": "Logan", "ג'וגר": "Jogger", "ספרינג": "Spring",
    "5008": "5008", "508": "508", "206": "206", "207": "207", "301": "301",
    "פרטנר": "Partner", "ריפטר": "Rifter",
    "בייון": "Bayon", "קרטה": "Creta", "איוניק 5": "Ioniq 5", "איוניק 6": "Ioniq 6",
    "אקסיד": "XCeed", "EV6": "EV6", "EV9": "EV9",
    "T-קרוס": "T-Cross", "T-רוק": "T-Roc", "ID.3": "ID.3", "ID.4": "ID.4",
    "קאדי": "Caddy", "טוראן": "Touran", "אפ": "Up",
    "CX-30": "CX-30", "CX-60": "CX-60", "MX-30": "MX-30", "מאזדה 2": "Mazda2",
  };

  try {
    // Try 3 methods: filters (int), filters (string), q (full-text)
    let records = [];
    const plateInt = parseInt(plateClean, 10);

    // Method 1: filters with integer
    const url1 = `${BASE_URL}?resource_id=${RESOURCE_ID}&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateInt }))}&limit=1`;
    console.log('[data.gov.il] Trying:', url1);

    let resp = await fetch(url1, { signal: AbortSignal.timeout(12000) });
    if (resp.ok) {
      const data = await resp.json();
      records = data?.result?.records || [];
    }

    // Method 2: filters with string
    if (!records.length) {
      const url2 = `${BASE_URL}?resource_id=${RESOURCE_ID}&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateClean }))}&limit=1`;
      console.log('[data.gov.il] Fallback string:', url2);
      resp = await fetch(url2, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) {
        const data = await resp.json();
        records = data?.result?.records || [];
      }
    }

    // Method 3: q full-text search
    if (!records.length) {
      const url3 = `${BASE_URL}?resource_id=${RESOURCE_ID}&q=${plateClean}&limit=5`;
      console.log('[data.gov.il] Fallback q:', url3);
      resp = await fetch(url3, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) {
        const data = await resp.json();
        const allRecords = data?.result?.records || [];
        records = allRecords.filter(r => String(r.mispar_rechev) === plateClean);
      }
    }

    if (!records.length) {
      return res.status(404).json({
        error: `לא נמצא רכב עם מספר רישוי ${plateClean}. ודא שהמספר נכון (7-8 ספרות ללא מקפים).`,
        debug: { url: resp?.url, status: resp?.status }
      });
    }

    const rec = records[0];
    const heMake = (rec.tozeret_nm || '').trim();
    const heModel = (rec.kinuy_mishari || '').trim();
    const year = rec.shnat_yitzur || '';

    // Map Hebrew → English
    let enMake = HE_TO_EN_MAKE[heMake] || '';
    if (!enMake) {
      for (const [he, en] of Object.entries(HE_TO_EN_MAKE)) {
        if (heMake.includes(he) || he.includes(heMake)) { enMake = en; break; }
      }
    }
    let enModel = HE_TO_EN_MODEL[heModel] || '';

    // Build response — pass through ALL fields from government record
    const result = {
      plate: plateClean,
      tozeret_nm: heMake,
      kinuy_mishari: heModel,
      shnat_yitzur: year,
      en_make: enMake,
      en_model: enModel,
    };
    // Add all other fields from the record
    const knownFields = ['mispar_rechev', 'tozeret_nm', 'kinuy_mishari', 'shnat_yitzur'];
    for (const [k, v] of Object.entries(rec)) {
      if (k === '_id' || k === 'rank' || knownFields.includes(k)) continue;
      if (v !== null && v !== undefined && v !== '') result[k] = v;
    }

    // Also fetch model specs for gear type (automatic_ind) and engine displacement
    if (rec.degem_cd && rec.tozeret_cd) {
      try {
        const SPECS_RESOURCE = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';
        const sFilters = { degem_cd: rec.degem_cd, tozeret_cd: rec.tozeret_cd };
        const sUrl = `${BASE_URL}?resource_id=${SPECS_RESOURCE}&filters=${encodeURIComponent(JSON.stringify(sFilters))}&limit=1`;
        const sResp = await fetch(sUrl, { signal: AbortSignal.timeout(8000) });
        if (sResp.ok) {
          const sData = await sResp.json();
          const spec = sData?.result?.records?.[0];
          if (spec) {
            // Gear type
            if (spec.automatic_ind !== null && spec.automatic_ind !== undefined) {
              const gearVal = Number(spec.automatic_ind);
              result.sug_gear = gearVal === 1 ? 'אוטומט' : gearVal === 2 ? 'רובוטי' : 'ידני';
            }
            // Engine displacement (nefah_manoa — no 'c')
            if (spec.nefah_manoa) result.nefach_manoa = spec.nefah_manoa + ' סמ"ק';
            // Horsepower
            if (spec.koah_sus) result.koach_sus = spec.koah_sus + ' כ"ס';
          }
        }
      } catch (e) {
        console.log('[specs] Error:', e.message);
        // Non-critical — continue without specs
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('[data.gov.il] Error:', err.message);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'data.gov.il לא הגיב — נסה שוב בעוד מספר שניות.' });
    }
    return res.status(500).json({ error: `שגיאה: ${err.message}` });
  }
}
