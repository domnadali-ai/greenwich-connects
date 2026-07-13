export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const BASE = 'appMJkHEuLp9SKTqr';
  const RESOURCES_SHEET = '1Ck1-3WrV5lbNyDcF8txqhBLe812TUeanKS4dfp77OqU';
  const EVENTS_SHEET = '19bvALHMCp6V-mDnNqayqJB3ZxuhMHNVKCJgbYYPoEgo';

  const body = req.body;

  // Fetch Google Sheet as CSV
  async function fetchSheet(sheetId) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const r = await fetch(url);
      const text = await r.text();
      const rows = text.trim().split('\n').map(row =>
        row.split(',').map(cell => cell.replace(/^"|"$/g, '').trim())
      );
      const headers = rows[0];
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i] || '');
        return obj;
      });
    } catch { return []; }
  }

  // Format resources for agent context
  function formatResources(rows) {
    const active = rows.filter(r => r.Active !== 'FALSE');
    const grouped = {};
    active.forEach(r => {
      if (!grouped[r.Category]) grouped[r.Category] = [];
      grouped[r.Category].push(
        `${r.Name}${r.Phone ? ' — ' + r.Phone : ''}${r.Website ? ' — ' + r.Website : ''}${r.Address ? ' — ' + r.Address : ''}${r.Description ? ': ' + r.Description : ''}`
      );
    });
    return Object.entries(grouped).map(([cat, items]) =>
      `${cat}:\n${items.map(i => '- ' + i).join('\n')}`
    ).join('\n\n');
  }

  // Format upcoming events for agent context
  function formatEvents(rows) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = rows.filter(r => {
      if (!r.Date) return false;
      const d = new Date(r.Date);
      return !isNaN(d) && d >= today;
    });
    if (upcoming.length === 0) return 'No upcoming events at this time.';
    return upcoming.map(r =>
      `- ${r.Name} on ${r.Date} at ${r.Time || 'TBD'} at ${r.Location || 'TBD'}${r.Address ? ', ' + r.Address : ''}${r.Description ? '. ' + r.Description : ''}${r.RegisterLink ? ' Register at ' + r.RegisterLink : ''}`
    ).join('\n');
  }

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
    } catch { return res.status(200).json({ saved: false }); }
  }

  // Log conversation to Airtable — create or update by SessionId
  if (body.logConversation) {
    try {
      const { sessionLogged, ...fields } = body.logConversation;
      const sessionId = fields.SessionId;

      if (!sessionLogged) {
        // First message — create new row
        console.log('Creating new session:', sessionId);
        await fetch(`https://api.airtable.com/v0/${BASE}/Conversations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields })
        });
      } else {
        // Subsequent messages — find and update existing row
        console.log('Updating session:', sessionId);
        const search = await fetch(
          `https://api.airtable.com/v0/${BASE}/Conversations?filterByFormula=SessionId%3D%22${encodeURIComponent(sessionId)}%22`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
        );
        const searchData = await search.json();
        console.log('Search result:', JSON.stringify(searchData));
        if (searchData.records && searchData.records.length > 0) {
          const recordId = searchData.records[0].id;
          const { SessionId, ...updateFields } = fields;
          await fetch(`https://api.airtable.com/v0/${BASE}/Conversations/${recordId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: updateFields })
          });
        } else {
          console.log('Session not found, creating new row');
          await fetch(`https://api.airtable.com/v0/${BASE}/Conversations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
          });
        }
      }
      return res.status(200).json({ logged: true });
    } catch (err) {
      console.error('Airtable log error:', err.message);
      return res.status(200).json({ logged: false });
    }
  }

  // Chat with Claude — fetch live resources and events first
  const { messages, system } = body;
  try {
    const [resourceRows, eventRows] = await Promise.all([
      fetchSheet(RESOURCES_SHEET),
      fetchSheet(EVENTS_SHEET)
    ]);

    const resourceContext = formatResources(resourceRows);
    const eventContext = formatEvents(eventRows);

    const fullSystem = `${system}

LIVE RESOURCES FROM DATABASE:
${resourceContext}

UPCOMING EVENTS:
${eventContext}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: fullSystem,
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
