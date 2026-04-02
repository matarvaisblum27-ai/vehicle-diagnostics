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

    return res.status(200).json({
      plate: plateClean,
      tozeret_nm: heMake,
      kinuy_mishari: heModel,
      shnat_yitzur: year,
      degem_nm: rec.degem_nm || '',
      ramat_gimur: rec.ramat_gimur || '',
      sug_delek_nm: rec.sug_delek_nm || '',
      tzeva_rechev: rec.tzeva_rechev || '',
      tokef_dt: rec.tokef_dt || '',
      baalut: rec.baalut || '',
      mivchan_acharon_dt: rec.mivchan_acharon_dt || '',
      en_make: enMake,
      en_model: enModel,
    });

  } catch (err) {
    console.error('[data.gov.il] Error:', err.message);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'data.gov.il לא הגיב — נסה שוב בעוד מספר שניות.' });
    }
    return res.status(500).json({ error: `שגיאה: ${err.message}` });
  }
}
