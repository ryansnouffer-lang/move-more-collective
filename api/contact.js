const ALLOWED_ORIGIN = 'https://www.movemorecollective.com';

const LOCATION_ID = process.env.GHL_LOCATION_ID?.trim();
const ASSIGNED_TO = process.env.GHL_ASSIGNED_TO?.trim();

const TAG_MAP = {
  brand:     'brand-partnership',
  community: 'community-co-host',
  creator:   'creator-program',
  press:     'press-media',
  general:   'general-inquiry'
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ct = req.headers['content-type']?.split(';')[0].trim();
  if (ct !== 'application/json') {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  const { name, email, interest, message } = req.body || {};

  if (!name  || !email)                          return res.status(400).json({ error: 'Name and email are required' });
  if (String(name).trim().length > 100)          return res.status(400).json({ error: 'Name too long' });
  if (String(email).trim().length > 254)         return res.status(400).json({ error: 'Email too long' });
  if (!EMAIL_RE.test(String(email).trim()))      return res.status(400).json({ error: 'Invalid email address' });
  if (message && String(message).trim().length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });

  const API_KEY     = process.env.GHL_API_KEY?.trim();
  const PIPELINE_ID = process.env.GHL_PIPELINE_ID?.trim();
  const STAGE_ID    = process.env.GHL_STAGE_ID?.trim();

  if (!API_KEY || !LOCATION_ID || !ASSIGNED_TO) {
    console.error('Missing required GHL environment variables');
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
    const contactPayload = {
      firstName,
      lastName,
      email:        String(email).trim().toLowerCase(),
      tags,
      source:       'website',
      locationId:   LOCATION_ID,
      assignedTo:   ASSIGNED_TO,
      customFields: message
        ? [{ id: 'Qffaeplsvx7F0x46xdYR', value: String(message).trim() }]
        : []
    };

    const contactRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method:  'POST',
      headers: ghlHeaders,
      body:    JSON.stringify(contactPayload)
    });

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error('GHL contact upsert failed:', contactRes.status, errText);
      return res.status(500).json({ error: 'Failed to create contact' });
    }

    const contactData = await contactRes.json();
    const contactId   = contactData.contact?.id;

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
          contactId,
          assignedTo:      ASSIGNED_TO
        })
      });
      if (!oppRes.ok) console.error('GHL opportunity failed:', oppRes.status, await oppRes.text());
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
};
