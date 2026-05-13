const LOCATION_ID = 'fCEAxly6nz1viXs6qdHm';

const TAG_MAP = {
  brand:     'brand-partnership',
  community: 'community-co-host',
  creator:   'creator-program',
  press:     'press-media',
  general:   'general-inquiry'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, interest, message } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const API_KEY     = process.env.GHL_API_KEY;
  const PIPELINE_ID = process.env.GHL_PIPELINE_ID;
  const STAGE_ID    = process.env.GHL_STAGE_ID;

  if (!API_KEY) {
    console.error('GHL_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28'
  };

  const interestTag = TAG_MAP[interest] || 'general-inquiry';
  const tags        = ['mmc-website', interestTag];

  const parts     = String(name).trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.slice(1).join(' ') || '';

  try {
    // 1. Upsert contact
    const contactRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method:  'POST',
      headers: ghlHeaders,
      body:    JSON.stringify({
        firstName,
        lastName,
        email:      String(email).trim().toLowerCase(),
        tags,
        source:     'website',
        locationId: LOCATION_ID
      })
    });

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error('GHL contact upsert failed:', contactRes.status, errText);
      return res.status(502).json({ error: 'Failed to create contact' });
    }

    const contactData = await contactRes.json();
    const contactId   = contactData.contact?.id;

    // 2. Note
    if (contactId && message) {
      const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method:  'POST',
        headers: ghlHeaders,
        body:    JSON.stringify({
          body:      `Interest: ${interestTag}\n\nMessage:\n${String(message).trim()}`,
          contactId
        })
      });
      if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text());
    }

    // 3. Opportunity
    if (contactId && PIPELINE_ID && STAGE_ID) {
      const oppName = `${firstName}${lastName ? ' ' + lastName : ''} — ${interestTag}`;
      const oppRes  = await fetch('https://services.leadconnectorhq.com/opportunities/', {
        method:  'POST',
        headers: ghlHeaders,
        body:    JSON.stringify({
          name:            oppName,
          pipelineId:      PIPELINE_ID,
          locationId:      LOCATION_ID,
          status:          'open',
          pipelineStageId: STAGE_ID,
          contactId
        })
      });
      if (!oppRes.ok) console.error('GHL opportunity failed:', oppRes.status, await oppRes.text());
    }

    return res.status(200).json({
      success:    true,
      _debug:     { hasPipeline: !!PIPELINE_ID, hasStage: !!STAGE_ID, contactId: contactId || null }
    });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
};
