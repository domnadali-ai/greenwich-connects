export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE = 'appMJkHEuLp9SKTqr';
  const body = req.body;

  // Save profile to Airtable
  if (body.saveProfile) {
    try {
      await fetch(`https://api.airtable.com/v0/${BASE}/Profiles`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: body.saveProfile })
      });
      return res.status(200).json({ saved: true });
    } catch (err) {
      return res.status(200).json({ saved: false });
    }
  }

  // Chat with Claude
  const { messages, system } = body;
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
      return res.status(200).json({ error: data });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(200).json({ error: err.message });
  }
}
