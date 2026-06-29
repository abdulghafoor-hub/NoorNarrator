import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceName, SEOMetadata } from "../types";

const safetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

/**
 * Sanitizes text by removing non-textual decorative elements while preserving
 * the original sacred and linguistic integrity of Arabic/Urdu content.
 */
const sanitizeForTTS = (text: string): string => {
  // STRICT NORMALIZATION RULES:
  // 1. Remove text inside parentheses () and square brackets [] EXCEPT [pause]
  // 2. Expand honorifics like ﷺ
  // 3. Replace ||LB|| or [pause] with SSML break tags
  // 4. Remove decorative emojis.
  // 5. Wrap deeply spiritual reminders in prosody tags (optional heuristic)

  let processed = text
    // Protect [pause] by temporarily replacing it
    .replace(/\[pause\]/gi, "___PAUSE___")
    // Remove other brackets
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    // Restore [pause] as SSML break
    .replace(/___PAUSE___/g, '<break time="1s"/>')
    .replace(/\|\|LB\|\|/g, '<break time="0.5s"/>')

    // Honorifics Expansion
    .replace(/ﷺ/g, "صَلَّى اللّٰهُ عَلَيْهِ وَسَلَّمْ")
    .replace(/صل اللہ علیہ وسلم/g, "صَلَّى اللّٰهُ عَلَيْهِ وَسَلَّمْ")

    // Clean emojis
    .replace(
      /[\u{1F000}-\u{1F9FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu,
      "",
    )
    .replace(/[ \t]+/g, " ") // Collapse spaces but preserve newlines
    .trim();

  // If the text contains SSML tags like <break time="1s"/>, wrap it in <speak>
  if (processed.includes("<break")) {
    // Optionally apply prosody wrapper for soft reminders
    // if (processed.includes("دل کو سکون")) {
    //   processed = `<prosody volume="soft" rate="slow">${processed}</prosody>`;
    // }
    processed = `<speak>${processed}</speak>`;
  }

  return processed;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enhanced prompt for natural, conversational narration.
 */
const getTTSPrompt = (text: string): string => {
  return `Speak the following Urdu text naturally, with an engaging, inspiring, and clear tone. Voice should sound warm, authentic, and emotionally resonant, keeping the listener captivated while maintaining a respectful and uplifting delivery perfect for Islamic wisdom and storytelling: "${text}"`;
};

export const processScript = async (script: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
    Review and format the following Urdu script. 
    1. Ensure all Urdu text uses standard phrasing and is grammatically correct.
    2. Maintain a respectful, solemn, and calm religious tone without altering meaning.
    3. Break long paragraphs into short, focused segments (1–2 lines max per sentence).
    4. HIGHLIGHT LOGICAL STRUCTURE: Identify key points, list items, or core takeaways and prefix them strictly with a standard bullet point character "• ". This enables "Focus Mode" in the video player. (Do not use dashes or asterisks for lists, use the • character).
    5. Ensure proper line breaks between paragraphs and distinct thoughts.
    6. At the very end of the script, append a strong Call to Action (CTA): a "Read and share for Sadqa-e-Jaria" message and a subscription reminder for the 'LifeBeauty' channel in Urdu. IF IT ALREADY EXISTS, DO NOT ADD IT AGAIN.
    7. Return ONLY the final formatted Urdu text. Do not add conversational padding like "Here is the text".
    
    Script:
    ${script}
  `;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { temperature: 0.2 },
    });
    return response.text?.trim() || script;
  } catch (e) {
    console.error("Script processing failed", e);
    return script; // Fallback to original script if AI fails
  }
};

export const generateNarration = async (
  text: string,
  voice: VoiceName,
  retryCount = 0,
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Note: App.tsx may have already normalized the text, but we ensure it here to be safe.
  const cleanText = sanitizeForTTS(text);

  if (!cleanText) {
    throw new Error("Text is empty after cleaning.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [
        {
          parts: [
            {
              text: getTTSPrompt(cleanText),
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response candidates from AI.");
    }

    const candidate = response.candidates[0];

    // Handle Finish Reason
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      if (retryCount < 3) {
        await delay(1500 * (retryCount + 1));
        return generateNarration(text, voice, retryCount + 1);
      }
      throw new Error(
        `Narration failed: ${candidate.finishReason}. The content might be too long or restricted.`,
      );
    }

    const audioPart = candidate.content?.parts?.find((p) => p.inlineData?.data);
    if (audioPart?.inlineData?.data) {
      return audioPart.inlineData.data;
    }

    throw new Error("Audio data not found in response.");
  } catch (error: any) {
    const errorString = (error.message || "").toLowerCase();

    if (retryCount < 3) {
      console.warn(`Retryable error: ${errorString}. Retrying...`);
      await delay(2000 * (retryCount + 1));
      return generateNarration(text, voice, retryCount + 1);
    }
    throw error;
  }
};

export const generateSEOMetadata = async (
  script: string,
): Promise<SEOMetadata> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    You are an expert YouTube SEO Strategist for a highly successful Islamic/Spiritual channel. Analyze the following video script and generate viral SEO metadata in JSON format.

    ### 1. TITLE OPTIONS (CRITICAL FOR CTR)
    Generate 3 highly clickable title options. They must be UNDER 65 characters so they don't get cut off on mobile. Use a bilingual structure (English + Roman Urdu/Urdu script) to capture maximum search traffic.
    - Option 1 (The Curiosity Hook): Focus on a hidden truth or deep question. (e.g., "Why You Feel Lost? | Dil Ka Sukoon 🤍")
    - Option 2 (The Solution/Listicle): Focus on actionable steps or a direct cure. (e.g., "3 Steps to Stop Overthinking | پریشانی کا قرآنی علاج")
    - Option 3 (The Emotional Trigger): Target a specific pain point like anxiety, fear, or sadness. (e.g., "Listen to this when you are Sad | Quranic Cure ✨")

    ### 2. DESCRIPTION (ALGORITHM OPTIMIZED)
    Write a highly optimized YouTube description using this exact structure:
    - First 2 lines: A strong hook addressing the viewer's pain point (in English & Roman Urdu) using targeted keywords.
    - Summary: 2-3 sentences summarizing the spiritual reminder.
    - Chapters/Timestamps: Generate 3 to 4 logical timestamps based on the flow of the script (e.g., "00:00 - Are you overthinking?", "00:15 - The Quranic solution").
    - Call to Action: "Subscribe to LifeBeauty for daily Islamic reminders. Share this as Sadqa-e-Jaria!"

    ### 3. VIRAL KEYWORDS
    Generate an array of exactly 20 highly searched tags. Include a mix of:
    - Broad English search terms (e.g., "Quranic cure for anxiety", "Islamic reminders")
    - Roman Urdu pain-point terms (e.g., "pareshani ka ilaj", "dil ka sukoon", "overthinking in islam")
    Do NOT include the '#' symbol in the array items.

    ### 4. THUMBNAIL TEXT
    Generate a 2 to 5 word punchy hook in bold Urdu script (e.g., "یہ غلطی مت کریں!"). It must create an irresistible urge to click by leaving a curiosity gap.

    Script to analyze:
    """
    ${script}
    """
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titleOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            description: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            thumbnailText: { type: Type.STRING },
          },
          required: [
            "titleOptions",
            "description",
            "keywords",
            "thumbnailText",
          ],
        },
      },
    });
    return JSON.parse(response.text || "{}") as SEOMetadata;
  } catch (e) {
    console.error("SEO generation failed", e);
    return {
      titleOptions: ["Islamic Reminder | LifeBeauty", "Quranic Cure For The Heart", "Beautiful Sunnah to Practice"],
      description: "Subscribe for daily Islamic reminders and beautiful Quran recitations.",
      keywords: ["islamic status", "quran recitation", "lifebeauty"],
    };
  }
};

/**
 * Generates a concise, artistic image prompt based on the provided script.
 */
export const generateVisualPrompt = async (script: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Read the following Urdu/English script and describe a SINGLE, static, cinematic background image that perfectly matches the mood and content.
      
      Script: "${script}"
      
      Rules:
      - Return ONLY the visual description string.
      - Focus on lighting, atmosphere, setting, and color palette.
      - Do NOT include people faces if possible (silhouette is okay).
      - ABSOLUTELY NO women, females, or girls in the image.
      - Style: 8k resolution, photorealistic or digital art masterpiece.
      - Keep it under 40 words.`,
    });

    return (
      response.text?.trim() ||
      "A peaceful, starry night sky over a silhouette of a mosque, cinematic lighting."
    );
  } catch (e) {
    console.error("Visual prompt generation failed", e);
    return "A peaceful, starry night sky over a silhouette of a mosque, cinematic lighting.";
  }
};

export const generateThumbnailData = async (
  script: string,
): Promise<{
  visualPrompt: string;
  overlayText: string;
  styleCategory: string;
  colorPop: string;
}> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following script and generate data for a highly viral, curiosity-inducing YouTube video thumbnail.
      
      Script: "${script}"
      
      Return JSON with:
      1. 'visualPrompt': A visual description for an AI image generator. 
         COMPOSITION: Use a split-screen or dual-lighting layout. Create a visual contrast that illustrates the "before and after" or "dark vs. light" consequence of the topic.
         IMAGERY: For topics like "Gunahe Jaria" (ongoing sin), visualize a person in a dark setting using a phone (source of sin) contrasted with an image of a grave being reached by "dark rays" of ongoing sin. Keep it mysterious, dramatic, and suspenseful.
         KEYWORDS: "Dramatic lighting, cinematic, emotional impact, high contrast, professional Islamic art style".
         CRITICAL: ABSOLUTELY NO women, females, or girls in the image. No text in description. The top 20% of the image MUST be relatively clean/empty to leave room for text. KEEP the main subject dead-center to ensure safe cropping across all 9:16 and 16:9 screen formats.
      2. 'overlayText': Generate overlayText for the thumbnail. It MUST be under 5 words. Use curiosity gaps (e.g., 'Do this every morning!', 'اٹھتے ہی یہ کام کریں'). If there is a list, include the number (e.g., '3 Sunnahs').
      3. 'styleCategory': The style of the video: 'Educational', 'Storytelling', 'Tech', or 'Religious Urdu'.
      4. 'colorPop': A hex color code for the most striking highlight color (e.g., '#fbbf24' for gold, '#ef4444' for red, '#06b6d4' for cyan).
      `,
      config: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            visualPrompt: { type: Type.STRING },
            overlayText: { type: Type.STRING },
            styleCategory: { type: Type.STRING },
            colorPop: { type: Type.STRING },
          },
          required: [
            "visualPrompt",
            "overlayText",
            "styleCategory",
            "colorPop",
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      visualPrompt: parsed.visualPrompt || "Cinematic landscape",
      overlayText: parsed.overlayText || "Must Watch",
      styleCategory: parsed.styleCategory || "Educational",
      colorPop: parsed.colorPop || "#fbbf24",
    };
  } catch (e) {
    console.error("Thumbnail data generation failed", e);
    return {
      visualPrompt: "Cinematic landscape",
      overlayText: "Must Watch",
      styleCategory: "Educational",
      colorPop: "#fbbf24",
    };
  }
};

export interface VideoScene {
  start_time: string;
  end_time: string;
  voiceover_text: string;
  spoken_text?: string;
  onscreen_text: string;
  visual_generation_prompt: string | null;
}

export const generateVideoScenes = async (
  topicOrScript: string,
): Promise<VideoScene[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `You are the core backend engine for an automated AI video generation application. Your job is to take a raw video topic or script concept and return a highly structured, valid JSON array. Each object in the array represents a precise timestamped scene. 

You must strictly adhere to the following output schema and logic rules:

### OUTPUT SCHEMA RULES:
For every scene, you must generate a JSON object containing exactly these keys:
1. "start_time": (String) The exact starting timestamp (e.g., "00:00:00").
2. "end_time": (String) The exact ending timestamp (e.g., "00:00:04").
3. "voiceover_text": (String) The precise Urdu text to be read aloud by the Text-to-Speech (TTS) engine.
4. "spoken_text": (String) Phonetically normalized duplicate of voiceover_text with Arabic Diacritics (Zabar, Zer, Pesh) on critical Islamic words (e.g. changing الحمدللہ to اَلْحَمْدُ لِلّٰہ) so pronunciation is flawless. You must also include [pause] where appropriate.
5. "onscreen_text": (String) The short, high-impact text phrase (Urdu or English) to display visually as a dynamic overlay during this specific time window.
6. "visual_generation_prompt": (String or Null) IF background B-roll or video footage is missing for this scene, write a highly descriptive, cinematic image generation prompt. If video footage is already available, set this key to null.

### CRITICAL SYNCHRONIZATION LOGIC:
- Pacing Match: Limit the "voiceover_text" to what can be naturally spoken within the scene's time window at a calm, deliberate pace (roughly 2 to 2.5 words per second).
- Text Overlay Alignment: The "onscreen_text" must contain no more than 3 to 5 words. It must align perfectly with the core message being spoken in the "voiceover_text" at that exact second.
- Image Prompt Specification: When creating the "visual_generation_prompt", use descriptive keyword strings (e.g., "Cinematic macro shot, golden morning sunlight filtering through a window, soft focus, serene atmosphere, 4k, realistic"). Avoid conversational language.
- Formatting: Do not wrap the JSON output in markdown blocks like \`\`\`json. Return only raw, valid JSON text.

Input Topic/Script:
${topicOrScript}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        temperature: 0.7,
        responseMimeType: "application/json",
      },
    });

    return JSON.parse(response.text || "[]") as VideoScene[];
  } catch (e) {
    console.error("Scene generation failed", e);
    return [];
  }
};

export const generateAtmosphereImage = async (
  prompt: string,
  aspectRatio: string = "16:9",
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            text: `Atmosphere: ${prompt}. Cinematic masterpiece, dramatic lighting, 8k resolution, no text, artistic silhouette. Keep main subject perfectly centered for safe horizontal/vertical cropping. ABSOLUTELY NO women, females, or girls in the image.`,
          },
        ],
      },
      config: { imageConfig: { aspectRatio: aspectRatio } },
    });
    const part = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    );
    return part ? `data:image/png;base64,${part.inlineData.data}` : null;
  } catch {
    return null;
  }
};
