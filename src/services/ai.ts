import { GoogleGenAI, Type } from "@google/genai";

// Initialize the client
// Note: In a real production app, you might want to proxy this through a backend 
// to avoid exposing the key if it wasn't already handled by the environment/platform.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface DetectedDifference {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export async function detectDifferences(imageA: string, imageB: string): Promise<DetectedDifference[]> {
  try {
    // Helper to extract base64 data
    const getBase64 = (dataUrl: string) => dataUrl.split(',')[1];
    const getMimeType = (dataUrl: string) => dataUrl.split(';')[0].split(':')[1];

    // Using Pro model for better reasoning capabilities on vision tasks
    const model = "gemini-3.1-pro-preview"; 

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

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: getMimeType(imageA),
              data: getBase64(imageA)
            }
          },
          {
            inlineData: {
              mimeType: getMimeType(imageB),
              data: getBase64(imageB)
            }
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            differences: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  ymin: { type: Type.NUMBER },
                  xmin: { type: Type.NUMBER },
                  ymax: { type: Type.NUMBER },
                  xmax: { type: Type.NUMBER }
                },
                required: ["ymin", "xmin", "ymax", "xmax"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const result = JSON.parse(text);
    return result?.differences || [];

  } catch (error) {
    console.error("Error detecting differences:", error);
    throw error;
  }
}
