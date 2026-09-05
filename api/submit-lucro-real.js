const PIPELINE_ID = 14272563; // Funil de isca: mesmo funil do Diagnóstico Simples ou Híbrido

const FIELD_MARGEM = null; // preencher com o ID do campo "Lucro Real: Margem" depois de criá-lo no Kommo
const FIELD_FATURAMENTO = null; // preencher com o ID do campo "Lucro Real: Faturamento" depois de criá-lo no Kommo

async function addNote(subdomain, token, leadId, text) {
  try {
    await fetch(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          note_type: 'common',
          params: { text },
        },
      ]),
    });
  } catch (err) {
    console.error('Falha ao adicionar nota:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { name, phone, segment, leadId, margin, faturamento } = req.body || {};

    if (!name || !phone) {
      res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
      return;
    }

    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const token = process.env.KOMMO_TOKEN;

    if (!subdomain || !token) {
      console.error('KOMMO_SUBDOMAIN ou KOMMO_TOKEN não configurados no Vercel');
      res.status(500).json({ error: 'Integração não configurada' });
      return;
    }

    const hasResult = typeof margin !== 'undefined' && typeof faturamento !== 'undefined';

    // Caso 1: já existe um lead (a pessoa já passou pela qualificação) — só atualiza com o resultado
    if (leadId) {
      if (hasResult) {
        const noteLines = [
          `Margem de lucro real calculada: ${margin}%.`,
          `Faturamento informado no mês: R$ ${faturamento}.`,
        ];

        if (FIELD_MARGEM || FIELD_FATURAMENTO) {
          const customFields = [];
          if (FIELD_MARGEM) customFields.push({ field_id: FIELD_MARGEM, values: [{ value: `${margin}%` }] });
          if (FIELD_FATURAMENTO) customFields.push({ field_id: FIELD_FATURAMENTO, values: [{ value: String(faturamento) }] });

          await fetch(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ custom_fields_values: customFields }),
          }).catch((err) => console.error('Falha ao atualizar campos do lead:', err));
        }

        await addNote(subdomain, token, leadId, noteLines.join('\n'));
      }

      res.status(200).json({ ok: true, leadId });
      return;
    }

    // Caso 2: lead novo — cria na hora da qualificação (ou, se algo falhar antes, na conclusão)
    const leadName = `Lucro Real: ${name}`;

    const customFields = [];
    if (hasResult) {
      if (FIELD_MARGEM) customFields.push({ field_id: FIELD_MARGEM, values: [{ value: `${margin}%` }] });
      if (FIELD_FATURAMENTO) customFields.push({ field_id: FIELD_FATURAMENTO, values: [{ value: String(faturamento) }] });
    }

    const tags = [];
    if (segment) tags.push({ name: segment });

    const leadPayload = {
      name: leadName,
      pipeline_id: PIPELINE_ID,
      ...(customFields.length > 0 ? { custom_fields_values: customFields } : {}),
      _embedded: {
        contacts: [
          {
            name: name,
            custom_fields_values: [
              {
                field_code: 'PHONE',
                values: [{ value: phone, enum_code: 'WORK' }],
              },
            ],
          },
        ],
        ...(tags.length > 0 ? { tags } : {}),
      },
    };

    const kommoRes = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/complex`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([leadPayload]),
    });

    if (!kommoRes.ok) {
      const errText = await kommoRes.text();
      console.error('Erro do Kommo:', errText);
      res.status(502).json({ error: 'Falha ao enviar para o Kommo' });
      return;
    }

    const kommoData = await kommoRes.json();
    const createdLead = kommoData?._embedded?.leads?.[0];
    const newLeadId = createdLead?.id || null;

    const noteLines = [];
    if (segment) noteLines.push(`Perfil: ${segment}`);
    if (hasResult) {
      noteLines.push(`Margem de lucro real calculada: ${margin}%.`);
      noteLines.push(`Faturamento informado no mês: R$ ${faturamento}.`);
    } else {
      noteLines.push('Lead capturado na tela de qualificação, ainda não concluiu o cálculo.');
    }

    if (newLeadId) {
      await addNote(subdomain, token, newLeadId, noteLines.join('\n'));
    }

    res.status(200).json({ ok: true, leadId: newLeadId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
}
