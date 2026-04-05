// Vercel Serverless Function — Vehicle technical specs from data.gov.il
// Endpoint: /api/vehicle-details?plate=38338901&degem_cd=15&tozeret_cd=683
// Uses government model specs database for engine, weight, features etc.
// Chassis/engine numbers only available on meshumeshet.com (linked)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { plate, degem_cd, tozeret_cd } = req.query;
  if (!plate) {
    return res.status(400).json({ error: 'חסר מספר רישוי' });
  }

  const plateClean = plate.replace(/[^0-9]/g, '');
  const BASE_URL = 'https://data.gov.il/api/3/action/datastore_search';

  // We need degem_cd and tozeret_cd to look up model specs
  // If not provided as params, get them from the main vehicle record first
  let dCode = degem_cd;
  let tCode = tozeret_cd;

  if (!dCode || !tCode) {
    try {
      const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
      const plateInt = parseInt(plateClean, 10);
      const url = `${BASE_URL}?resource_id=${RESOURCE_ID}&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateInt }))}&limit=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json();
        const rec = data?.result?.records?.[0];
        if (rec) {
          dCode = dCode || String(rec.degem_cd || '');
          tCode = tCode || String(rec.tozeret_cd || '');
        }
      }
    } catch (e) { /* continue with what we have */ }
  }

  if (!dCode) {
    return res.status(200).json({
      plate: plateClean,
      found: false,
      link: `https://meshumeshet.com/c/${plateClean}`,
    });
  }

  // Look up model specs from degem-rechev database
  try {
    const SPECS_RESOURCE = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';
    const filters = { degem_cd: parseInt(dCode, 10) };
    if (tCode) filters.tozeret_cd = parseInt(tCode, 10);
    const url = `${BASE_URL}?resource_id=${SPECS_RESOURCE}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit=1`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      return res.status(200).json({ plate: plateClean, found: false, link: `https://meshumeshet.com/c/${plateClean}` });
    }

    const data = await resp.json();
    const rec = data?.result?.records?.[0];
    if (!rec) {
      return res.status(200).json({ plate: plateClean, found: false, link: `https://meshumeshet.com/c/${plateClean}` });
    }

    // Map specs to clean output
    const output = {
      plate: plateClean,
      found: true,
      link: `https://meshumeshet.com/c/${plateClean}`,
    };

    // Engine displacement (field name in API: nefah_manoa — no 'c')
    if (rec.nefah_manoa) output.nefach_manoa = rec.nefah_manoa + ' סמ"ק';
    // Horsepower (field name: koah_sus — no 'c')
    if (rec.koah_sus) output.koach_sus = rec.koah_sus + ' כ"ס';
    // Total weight
    if (rec.mishkal_kolel) output.mishkal_kolel = rec.mishkal_kolel + ' ק"ג';
    // Doors
    if (rec.mispar_dlatot) output.mispar_dlatot = String(rec.mispar_dlatot);
    // Seats
    if (rec.mispar_moshavim) output.mispar_moshvim = String(rec.mispar_moshavim);
    // Drivetrain
    if (rec.hanaa_nm) output.hanaa = rec.hanaa_nm;
    // Transmission technology
    if (rec.technologiat_hanaa_nm) output.technologia = rec.technologiat_hanaa_nm;
    // Country of origin
    if (rec.tozeret_eretz_nm) output.totzeret = rec.tozeret_eretz_nm;
    // Body type
    if (rec.merkav) output.merkav = rec.merkav;
    // Fuel type from specs
    if (rec.delek_nm) output.sug_delek = rec.delek_nm;
    // Trim level
    if (rec.ramat_gimur) output.ramat_gimur = rec.ramat_gimur;
    // Green index
    if (rec.madad_yarok) output.madad_yarok = String(rec.madad_yarok);
    // Pollution group
    if (rec.kvutzat_zihum) output.kvutzat_zihum = String(rec.kvutzat_zihum);
    // Safety features
    const safety = [];
    if (rec.abs_ind === '1' || rec.abs_ind === 1) safety.push('ABS');
    if (rec.bakarat_yatzivut_ind === '1' || rec.bakarat_yatzivut_ind === 1) safety.push('בקרת יציבות');
    if (rec.mispar_kariot_avir) safety.push(rec.mispar_kariot_avir + ' כריות אוויר');
    if (rec.nitur_merhak_milfanim_ind === '1' || rec.nitur_merhak_milfanim_ind === 1) safety.push('חיישן מרחק');
    if (rec.teura_automatit_benesiya_kadima_ind === '1' || rec.teura_automatit_benesiya_kadima_ind === 1) safety.push('בלימת חירום');
    if (safety.length) output.safety = safety.join(', ');
    // Towing capacity
    if (rec.kosher_grira_im_blamim) output.grira = rec.kosher_grira_im_blamim + ' ק"ג';

    return res.status(200).json(output);

  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'data.gov.il לא הגיב — נסה שוב.' });
    }
    return res.status(500).json({ error: `שגיאה: ${err.message}` });
  }
}
