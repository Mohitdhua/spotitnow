export interface DetectedDifference {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export async function detectDifferences(imageA: string, imageB: string): Promise<DetectedDifference[]> {
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const url = `${base}/api/detect-differences`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({imageA, imageB}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `AI request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {differences?: DetectedDifference[]};
  return Array.isArray(data?.differences) ? data.differences : [];
}
