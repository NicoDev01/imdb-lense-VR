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

export const fetchMovieData = async (title: string): Promise<MovieDataResponse> => {
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
    return baseResponse; // Return consistent base shape on error
  }

  // If no movie is found at all, return the base shape
  if (!movieData) {
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

  // If no IMDb ID, we can't get a rating, so return what we have
  if (!movieData.imdbId) {
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
    // On OMDb error, we still return the TMDB data, which is already populated.
  }

  return tmdbResponse;
};
