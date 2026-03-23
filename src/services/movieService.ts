import { getImdbIdForTitle } from '@/services/tmdbService';
import { getImdbRatingByImdbId } from '@/services/omdbService';
import { extractYearFromTitle } from '@/services/ocrService';

// Define a consistent return type for our service function
export interface MovieDataResponse {
  ocrTitle: string;
  title: string | null;
  imdbId: string | null;
  tmdbId: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  rating: number | null;
  votes: string | null;
}

// In-memory cache for movie data
const movieDataCache = new Map<string, MovieDataResponse>();

export const fetchMovieData = async (title: string): Promise<MovieDataResponse> => {
  const cacheKey = title.toLowerCase().trim();
  
  // Check cache first
  if (movieDataCache.has(cacheKey)) {
    return movieDataCache.get(cacheKey)!;
  }

  const { title: cleanTitle, year } = extractYearFromTitle(title);
  const options = { language: 'de-DE', region: 'DE' };

  // Base object for consistent returns
  const baseResponse: MovieDataResponse = {
    ocrTitle: title,
    title: null,
    imdbId: null,
    tmdbId: null,
    confidence: null,
    rating: null,
    votes: null,
  };

  // 1. Fetch TMDB data
  let movieData = null;
  try {
    if (year) {
      movieData = await getImdbIdForTitle(cleanTitle, { ...options, year });
    }
    if (!movieData) {
      movieData = await getImdbIdForTitle(cleanTitle, options);
    }
  } catch (error) {
    console.error(`Failed to fetch TMDB data for "${title}":`, error);
    return baseResponse;
  }

  if (!movieData) {
    movieDataCache.set(cacheKey, baseResponse);
    return baseResponse;
  }

  // We have TMDB data, populate the response
  const tmdbResponse: MovieDataResponse = {
      ...baseResponse,
      title: movieData.title,
      imdbId: movieData.imdbId,
      tmdbId: movieData.tmdbId,
      confidence: movieData.confidence,
  };

  if (!movieData.imdbId) {
    movieDataCache.set(cacheKey, tmdbResponse);
    return tmdbResponse;
  }

  // 2. Fetch OMDb data
  try {
    const ratingData = await getImdbRatingByImdbId(movieData.imdbId);
    if (ratingData) {
        tmdbResponse.rating = ratingData.rating;
        tmdbResponse.votes = ratingData.votes;
    }
  } catch (error) {
    console.error(`Failed to fetch OMDb rating for "${title}" (IMDb ID: ${movieData.imdbId}):`, error);
  }

  // Cache the result
  movieDataCache.set(cacheKey, tmdbResponse);
  return tmdbResponse;
};

/**
 * Fetch movie data for multiple titles in parallel
 * Much faster than sequential fetching
 */
export const fetchMovieDataBatch = async (titles: string[]): Promise<Map<string, MovieDataResponse>> => {
  const results = new Map<string, MovieDataResponse>();
  
  // Filter out already cached titles
  const uncachedTitles = titles.filter(title => {
    const cacheKey = title.toLowerCase().trim();
    if (movieDataCache.has(cacheKey)) {
      results.set(title, movieDataCache.get(cacheKey)!);
      return false;
    }
    return true;
  });

  // Fetch uncached titles in parallel
  if (uncachedTitles.length > 0) {
    const promises = uncachedTitles.map(async (title) => {
      const data = await fetchMovieData(title);
      return { title, data };
    });

    const fetchedResults = await Promise.allSettled(promises);
    
    for (const result of fetchedResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.title, result.value.data);
      }
    }
  }

  return results;
};

/**
 * Clear the movie data cache
 */
export const clearMovieCache = () => {
  movieDataCache.clear();
};
