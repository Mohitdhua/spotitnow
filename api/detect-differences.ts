import {GoogleGenAI, Type} from '@google/genai';

interface Difference {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface DetectRequest {
  imageA?: string;
  imageB?: string;
}

const prompt = `
You are an expert at spotting differences between two images.
Compare the two images provided. The first image is the original, and the second image has been modified.

Task: Identify the visual differences between them.
Constraint: There are typically between 1 and 3 differences. Do not hallucinate differences if they do not exist.
Reasoning: Look closely at objects, colors, positions, and missing items.

For each difference, provide a bounding box using normalized coordinates (0 to 1).
Return the result as a JSON object with a "differences" key containing an array of bounding boxes.
Each bounding box should have ymin, xmin, ymax, xmax.
`;

const normalize = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
};

const parseDataUrl = (dataUrl: string) => {
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
  const dataMatch = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!mimeMatch || !dataMatch) {
    throw new Error('Invalid image data format');
  }

  return {
    mimeType: mimeMatch[1],
    data: dataMatch[1],
  };
};

const parseBody = (body: unknown): DetectRequest => {
  if (typeof body === 'string') {
    return JSON.parse(body) as DetectRequest;
  }
  return (body ?? {}) as DetectRequest;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({error: 'Missing GEMINI_API_KEY'});
  }

  try {
    const {imageA, imageB} = parseBody(req.body);
    if (!imageA || !imageB) {
      return res.status(400).json({error: 'imageA and imageB are required'});
    }

    const imgA = parseDataUrl(imageA);
    const imgB = parseDataUrl(imageB);
    const ai = new GoogleGenAI({apiKey});

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: {
        role: 'user',
        parts: [
          {text: prompt},
          {
            inlineData: {
              mimeType: imgA.mimeType,
              data: imgA.data,
            },
          },
          {
            inlineData: {
              mimeType: imgB.mimeType,
              data: imgB.data,
            },
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            differences: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  ymin: {type: Type.NUMBER},
                  xmin: {type: Type.NUMBER},
                  ymax: {type: Type.NUMBER},
                  xmax: {type: Type.NUMBER},
                },
                required: ['ymin', 'xmin', 'ymax', 'xmax'],
              },
            },
          },
        },
      },
    });

    const text = response.text;
    if (!text) {
      return res.status(200).json({differences: []});
    }

    const parsed = JSON.parse(text) as {differences?: Difference[]};
    const differences = Array.isArray(parsed?.differences) ? parsed.differences : [];

    const sanitized = differences.map((diff) => ({
      ymin: normalize(diff.ymin),
      xmin: normalize(diff.xmin),
      ymax: normalize(diff.ymax),
      xmax: normalize(diff.xmax),
    }));

    return res.status(200).json({differences: sanitized});
  } catch (error) {
    console.error('Difference detection API failed:', error);
    return res.status(500).json({error: 'Failed to detect differences'});
  }
}
