import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Initialize Gemini AI
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('VITE_GEMINI_API_KEY not found. Gemini OCR will not work.');
}

let genAI: GoogleGenerativeAI | null = null;
let model: any = null;

export const initializeGemini = async () => {
  if (model) return model;

  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API Key nicht gefunden. Bitte VITE_GEMINI_API_KEY in .env setzen.');
  }

  try {
    console.log('Initializing Gemini AI...');
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // Use gemini-3.1-flash-lite-preview for optimal performance and vision capabilities
    model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite-preview',
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    console.log('Gemini AI initialized successfully');
    return model;
  } catch (error) {
    console.error('Failed to initialize Gemini AI:', error);
    throw new Error('Gemini AI konnte nicht initialisiert werden. Bitte API Key überprüfen.');
  }
};

// ============================================================================
// NEW: Analyze full frame to detect movie covers with bounding boxes
// ============================================================================
export interface DetectedCover {
  title: string;
  boundingBox: {
    x: number;      // normalized 0-1
    y: number;      // normalized 0-1
    width: number;  // normalized 0-1
    height: number; // normalized 0-1
  };
  confidence: 'high' | 'medium' | 'low';
}

export interface FrameAnalysisResult {
  covers: DetectedCover[];
  rawResponse: string;
}

/**
 * Analyze a full camera frame to detect movie/series covers with their positions
 * Uses Gemini Vision to identify covers and estimate their bounding boxes
 */
export const analyzeFrameForCovers = async (imageBase64: string): Promise<FrameAnalysisResult> => {
  try {
    if (!model) {
      await initializeGemini();
    }

    // Extract base64 data
    let base64Data: string;
    let mimeType: string;

    if (imageBase64.startsWith('data:')) {
      const [mimePart, dataPart] = imageBase64.split(',');
      mimeType = mimePart.split(':')[1].split(';')[0];
      base64Data = dataPart;
    } else {
      mimeType = 'image/jpeg';
      base64Data = imageBase64;
    }

    // Prompt optimized for cover detection with positions
    const prompt = `Analysiere dieses Bild nach Film- oder Serien-Covern (Poster/Thumbnails).

Für JEDEN sichtbaren Film/Serien-Cover, gib folgendes zurück:
- Titel des Films/der Serie
- Position als Prozent vom Bild (0-100): left, top, width, height

Antworte NUR im folgenden JSON-Format, keine anderen Texte:
{
  "covers": [
    {
      "title": "Filmtitel",
      "left": 10,
      "top": 20,
      "width": 15,
      "height": 25,
      "confidence": "high"
    }
  ]
}

Regeln:
- left/top ist die obere linke Ecke in Prozent (0-100)
- width/height ist die Größe in Prozent des Bildes
- confidence: "high" wenn Cover klar erkennbar, "medium" wenn teilweise sichtbar, "low" wenn unsicher
- Wenn KEINE Cover erkennbar sind, gib {"covers": []} zurück
- Behalte deutsche Umlaute im Titel bei`;

    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType: mimeType } }
    ]);
    
    const response = await result.response;
    const text = response.text();
    
    console.log('[OCR] Gemini Cover Analysis Response:', text);

    // Parse JSON response
    const covers = parseCoverResponse(text);
    
    return {
      covers,
      rawResponse: text
    };
  } catch (error) {
    console.error('Error in analyzeFrameForCovers:', error);
    return { covers: [], rawResponse: '' };
  }
};

/**
 * Parse Gemini's JSON response for cover detection
 */
function parseCoverResponse(response: string): DetectedCover[] {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    
    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.covers || !Array.isArray(parsed.covers)) {
      return [];
    }

    return parsed.covers.map((cover: any) => ({
      title: cover.title || 'Unknown',
      boundingBox: {
        x: (cover.left || 0) / 100,
        y: (cover.top || 0) / 100,
        width: (cover.width || 10) / 100,
        height: (cover.height || 15) / 100
      },
      confidence: cover.confidence || 'medium'
    })).filter((c: DetectedCover) => c.title && c.title !== 'Unknown');
  } catch (e) {
    console.warn('Failed to parse cover response:', e);
    return [];
  }
}

/**
 * Validate if a cropped image is a movie/series cover and extract the title
 * More reliable than just OCR - asks Gemini directly
 */
export interface CoverValidationResult {
  isMovieCover: boolean;
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export const validateAndExtractCover = async (imageBase64: string): Promise<CoverValidationResult> => {
  try {
    if (!model) {
      await initializeGemini();
    }

    let base64Data: string;
    let mimeType: string;

    if (imageBase64.startsWith('data:')) {
      const [mimePart, dataPart] = imageBase64.split(',');
      mimeType = mimePart.split(':')[1].split(';')[0];
      base64Data = dataPart;
    } else {
      mimeType = 'image/jpeg';
      base64Data = imageBase64;
    }

    const prompt = `Ist dieses Bild ein Film- oder Serien-Cover/Poster/Thumbnail?

Antworte NUR im JSON-Format:
{
  "isMovieCover": true/false,
  "title": "Filmtitel oder null",
  "confidence": "high/medium/low"
}

Regeln:
- isMovieCover: true wenn es ein erkennbares Film/Serien-Cover ist
- title: Der Film/Serientitel wenn erkennbar, sonst null
- confidence: "high" wenn Cover und Titel klar erkennbar
- Behalte deutsche Umlaute im Titel bei (ä, ö, ü, ß)`;

    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType: mimeType } }
    ]);
    
    const response = await result.response;
    const text = response.text();
    
    console.log('[OCR] Cover Validation Response:', text);

    // Parse response
    try {
      let jsonStr = text.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      return {
        isMovieCover: parsed.isMovieCover || false,
        title: parsed.title || null,
        confidence: parsed.confidence || 'low'
      };
    } catch {
      return { isMovieCover: false, title: null, confidence: 'low' };
    }
  } catch (error) {
    console.error('Error in validateAndExtractCover:', error);
    return { isMovieCover: false, title: null, confidence: 'low' };
  }
};

export const extractTextFromImage = async (imageUrl: string): Promise<string[]> => {
  try {
    if (!model) {
      console.log('Initializing Gemini AI...');
      await initializeGemini();
    }

    console.log('Starting text extraction from image...');

    // Extract base64 data from data URL
    let base64Data: string;
    let mimeType: string;

    if (imageUrl.startsWith('data:')) {
      const [mimePart, dataPart] = imageUrl.split(',');
      mimeType = mimePart.split(':')[1].split(';')[0];
      base64Data = dataPart;
    } else {
      throw new Error('Unsupported image format. Expected data URL.');
    }

    // Create the prompt for movie title extraction
    const prompt = `Analysiere dieses Bild und extrahiere alle sichtbaren Film- oder Serientitel.
    Gib jeden Titel zurück, einen pro Zeile.
    Wenn eine Jahreszahl direkt beim Titel sichtbar ist, füge sie in Klammern hinzu (z.B. "Der Herr der Ringe (2001)").
    Wenn KEINE Jahreszahl sichtbar ist, gib NUR den Titel ohne Klammern zurück.
    Behalte deutsche Umlaute und Sonderzeichen bei (ä, ö, ü, ß, etc.).
    Achte besonders auf korrekte Erkennung von Umlauten und deutschen Buchstaben.
    Ignoriere alle anderen Texte wie Schauspielernamen, Regisseure, Genres, etc.
    Wenn mehrere Titel auf dem Bild sind, liste jeden separat auf.
    Antworte nur mit den Titeln, keine zusätzlichen Erklärungen.`;

    // Generate content
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType: mimeType } }
    ]);
    const response = await result.response;
    const text = response.text();

    console.log('Gemini Response:', text);

    if (!text || text.trim().length === 0) {
      console.log('No text extracted from image');
      return [];
    }

    // Parse the response and extract titles
    const extractedTitles = parseGeminiResponse(text);
    const cleanedTitles = extractedTitles
      .map(cleanMovieTitle)
      .filter(title => title.length >= 2 && title.length <= 100)
      .filter(title => !/^\d+(\.\d+)?$/.test(title)) // Filter out numbers only
      .filter(title => title.trim().length > 0);

    // Remove duplicates
    const uniqueTitles = [...new Set(cleanedTitles)];

    console.log('Final extracted titles:', uniqueTitles);

    if (uniqueTitles.length === 0) {
      console.log('No valid titles found in Gemini response');
      return [];
    }

    return uniqueTitles;
  } catch (error) {
    console.error('Error in extractTextFromImage:', error);

    // Handle specific Gemini errors
    if (error instanceof Error) {
      if (error.message.includes('API_KEY')) {
        throw new Error('Gemini API Key ist ungültig oder fehlt.');
      }
      if (error.message.includes('quota') || error.message.includes('rate limit')) {
        throw new Error('Gemini API Quota überschritten. Bitte später versuchen.');
      }
      if (error.message.includes('blocked')) {
        throw new Error('Inhalt wurde von Gemini blockiert.');
      }
    }

    return [];
  }
};

// Parse Gemini response to extract movie titles
function parseGeminiResponse(response: string): string[] {
  // Split by newlines and clean up
  const lines = response.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const titles: string[] = [];

  for (const line of lines) {
    // Skip lines that are clearly not movie titles
    if (line.toLowerCase().includes('keine filme gefunden') ||
        line.toLowerCase().includes('no movies found') ||
        line.toLowerCase().includes('error') ||
        line.startsWith('- ') && line.length < 5) {
      continue;
    }

    // Remove common prefixes that Gemini might add
    let cleanLine = line
      .replace(/^[-•*]\s*/, '') // Remove bullet points
      .replace(/^\d+\.\s*/, '') // Remove numbered lists
      .replace(/^["']|["']$/g, '') // Remove quotes
      .trim();

    if (cleanLine.length >= 2) {
      titles.push(cleanLine);
    }
  }

  return titles;
}

// Extract year from movie title
export const extractYearFromTitle = (title: string): { title: string; year?: number } => {
  // Match (YYYY) at end
  const parenMatch = title.match(/\((\d{4})\)\s*$/);
  if (parenMatch) {
    const year = parseInt(parenMatch[1]);
    if (year >= 1900 && year <= 2030) {
      const titleWithoutYear = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      return { title: titleWithoutYear, year };
    }
  }

  // Match YYYY at end (without parens)
  const plainMatch = title.match(/\s(\d{4})\s*$/);
  if (plainMatch) {
    const year = parseInt(plainMatch[1]);
    if (year >= 1900 && year <= 2030) {
      const titleWithoutYear = title.replace(/\s\d{4}\s*$/, '').trim();
      return { title: titleWithoutYear, year };
    }
  }

  return { title: title.trim() };
};

export const cleanMovieTitle = (title: string): string => {
  // Clean up movie title text - BEHALT Jahreszahlen in Klammern!
  return title
    // Remove unwanted characters but keep letters (including Umlaute), numbers, spaces, hyphens, colons, and parentheses
    // \p{L} matches any Unicode letter, \p{N} matches any Unicode number
    .replace(/[^\p{L}\p{N}\s\-:\(\)]/gu, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
};
