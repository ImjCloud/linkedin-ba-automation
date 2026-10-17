export async function alertFailure(title: string, detail: string) {
  const endpoint = process.env.ALERT_WEBHOOK_URL;
  if (!endpoint) return;
  try {
    await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `LinkedIn BA Automation: ${title}\n${detail.slice(0, 3000)}` }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.error('Alert webhook failed', error instanceof Error ? error.message : 'unknown error');
  }
}
