const DEFAULT_MODEL = 'openai/whisper-large-v3-turbo';

export async function transcribeAudio(
  blob: Blob,
  hfToken: string,
  model: string = DEFAULT_MODEL
): Promise<string> {
  if (!hfToken) {
    throw new Error('VITE_HF_API_TOKEN is missing in your .env file!');
  }

  // URL ko clean rakhein (query parameters hata dein taaki sanitize error na aaye)
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;
  const arrayBuffer = await blob.arrayBuffer();

  // Agar aapko language enforce karni hai, toh kuch models JSON payload ya headers accept karte hain,
  // lekin Whisper ke liye raw audio binary body best hai. 
  // Agar router query param par fail ho raha hai, toh use body ke sath bhejna padta hai 
  // ya fir transformers pipeline options ke taur par.
  const call = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ` + hfToken,
        'Content-Type': blob.type || 'audio/webm',
        // Optional: kuch routers ke liye parameters header
        'x-use-cache': 'false',
      },
      body: arrayBuffer,
    });

  let response = await call();

  if (response.status === 503) {
    const waitInfo = await response.json().catch(() => ({} as any));
    const waitSeconds = Math.min(Math.ceil(waitInfo.estimated_time || 15), 30);
    await new Promise((res) => setTimeout(res, waitSeconds * 1000));
    response = await call();
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({} as any));
    throw new Error(
      errData.error || `Hugging Face API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.text || 'No transcription returned from audio.';
}