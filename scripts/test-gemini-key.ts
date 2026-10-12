// Built-in environment


async function testGeminiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  console.log('Testing GEMINI_API_KEY from .env...');
  console.log(`Key length: ${key?.length}, starts with: ${key?.slice(0, 8)}...`);

  if (!key) {
    console.error('No GEMINI_API_KEY found in .env');
    return;
  }

  // Use the models list endpoint first
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  const listRes = await fetch(listUrl);
  console.log(`Model List HTTP Status: ${listRes.status}`);

  if (listRes.status !== 200) {
    const listErr = await listRes.json();
    console.error('Model List Error:', JSON.stringify(listErr, null, 2));
    return;
  }

  const listData = await listRes.json();
  const geminiModels = listData.models
    ?.map((m: any) => m.name.replace('models/', ''))
    .filter((name: string) => name.includes('flash') || name.includes('gemini'));
  console.log('Available Models:', geminiModels?.slice(0, 5));

  // Choose the best flash model
  const chosenModel = geminiModels?.includes('gemini-1.5-flash')
    ? 'gemini-1.5-flash'
    : geminiModels?.includes('gemini-2.0-flash')
    ? 'gemini-2.0-flash'
    : geminiModels?.[0] || 'gemini-1.5-flash';

  console.log(`Testing generateContent with model: ${chosenModel}...`);

  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${key}`;
  const genRes = await fetch(genUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Respond with exactly: {"status": "ok"}' }] }],
      generationConfig: {
        response_mime_type: 'application/json',
      },
    }),
  });

  console.log(`GenerateContent HTTP Status: ${genRes.status}`);
  if (genRes.status === 200) {
    const genData = await genRes.json();
    const text = genData?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Gemini Response:', text);
    console.log('🎉 SUCCESS: Google Gemini API is live and verified working with your key!');
  } else {
    const genErr = await genRes.json();
    console.error('GenerateContent Error:', JSON.stringify(genErr, null, 2));
  }
}

testGeminiKey().catch(console.error);
