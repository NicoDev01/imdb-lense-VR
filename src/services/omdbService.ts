import type { OmdbMovieResponse, OmdbError, MovieRating } from '@/types/omdb';

// OMDb API Configuration
const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY;

if (!OMDB_API_KEY) {
  console.warn('VITE_OMDB_API_KEY not found. OMDb integration will not work.');
}

// Generic OMDb API fetch function with error handling
async function omdbFetch<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(OMDB_BASE_URL);

  // Add API key
  url.searchParams.set('apikey', OMDB_API_KEY);

  // Add additional params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  // Add endpoint if provided
  if (endpoint) {
    url.searchParams.set('i', endpoint); // For IMDb ID queries
  }

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      // Handle specific HTTP status codes
      if (response.status === 503) {
        throw new Error('OMDb Service Unavailable (503). Die API ist vorübergehend nicht erreichbar.');
      }
      if (response.status === 429) {
        throw new Error('OMDb Rate Limit erreicht (429). Zu viele Anfragen.');
      }
      if (response.status >= 500) {
        throw new Error(`OMDb Server Error (${response.status}). Bitte später versuchen.`);
      }
      throw new Error(`OMDb API Error: ${response.status}`);
    }

    const data = await response.json();

    // Check for OMDb-specific error response
    if (data.Response === 'False') {
      const errorData = data as OmdbError;
      throw new Error(`OMDb API Error: ${errorData.Error}`);
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Network error while fetching from OMDb');
  }
}

// Get movie details by IMDb ID
export async function getMovieByImdbId(imdbId: string): Promise<OmdbMovieResponse> {
  return omdbFetch<OmdbMovieResponse>(imdbId);
}

// Extract IMDb rating from movie data
export function extractImdbRating(movieData: OmdbMovieResponse): number | null {
  if (!movieData.imdbRating || movieData.imdbRating === 'N/A') {
    return null;
  }

  const rating = parseFloat(movieData.imdbRating);
  return Number.isFinite(rating) ? rating : null;
}

// Extract IMDb votes from movie data
export function extractImdbVotes(movieData: OmdbMovieResponse): string | null {
  if (!movieData.imdbVotes || movieData.imdbVotes === 'N/A') {
    return null;
  }

  return movieData.imdbVotes;
}

// In-memory cache to deduplicate requests for the same IMDb ID
// This is useful when different OCR titles resolve to the same movie
const ratingCache = new Map<string, Promise<MovieRating | null>>();

// Main function: Get IMDb rating for a movie by IMDb ID
export async function getImdbRatingByImdbId(imdbId: string): Promise<MovieRating | null> {
  if (!imdbId) return null;

  // Check cache first
  if (ratingCache.has(imdbId)) {
    return ratingCache.get(imdbId)!;
  }

  // Create promise for the request
  const requestPromise = (async () => {
    try {
      // console.log('🔍 OMDB: Requesting rating for IMDb ID:', imdbId);
      const movieData = await getMovieByImdbId(imdbId);
      
      const rating = extractImdbRating(movieData);
      const votes = extractImdbVotes(movieData);

      const result: MovieRating = {
        imdbId,
        rating,
        votes,
        source: 'omdb' as const
      };

      return result;
    } catch (error) {
      console.error('❌ OMDB Error for ID:', imdbId, error);
      return null;
    }
  })();

  // Store promise in cache
  ratingCache.set(imdbId, requestPromise);

  return requestPromise;
}

// REMOVED: getImdbRatingsForIds (unused)
// REMOVED: searchMoviesByTitle (unused)
// REMOVED: getMovieByTitle (unused)
