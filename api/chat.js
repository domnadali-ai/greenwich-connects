export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system, code, saveProfile } = req.body;
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE = 'appMJkHEuLp9SKTqr';

  // Fetch profile from Airtable
  if (code && !saveProfile) {
    try {
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE}/Profiles?filterByFormula={Code}="${code}"`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const d = await r.json();
      if (d.records && d.records.length > 0) {
        return res.status(200).json({ profile: d.records[0].fields });
      } else {
        return res.status(200).json({ profile: null });
      }
    } catch (err) {
      return res.status(200).json({ profile: null });
    }
  }

  // Save profile to Airtable
  if (saveProfile) {
    try {
      const existing = await fetch(
        `https://api.airtable.com/v0/${BASE}/Profiles?filterByFormula={Code}="${saveProfile.Code}"`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const existingData = await existing.json();
      if (existingData.records && existingData.records.length > 0) {
        const recordId = existingData.records[0].id;
        await fetch(`https://api.airtable.com/v0/${BASE}/Profiles/${recordId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: saveProfile })
        });
      } else {
        await fetch(`https://api.airtable.com/v0/${BASE}/Profiles`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: saveProfile })
        });
      }
      return res.status(200).json({ saved: true });
    } catch (err) {
      return res.status(200).json({ saved: false });
    }
  }

  // Chat with Claude
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system,
        messages
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
