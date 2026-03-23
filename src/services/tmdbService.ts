import type {
  TMDBMovieSearchResult,
  TMDBSearchResponse,
  TMDBMovieDetails,
  TMDBExternalIds,
  TMDBError,
  MovieWithImdbId,
  TMDBSearchOptions,
  TMDBCandidate
} from '@/types/tmdb';

// TMDB API Configuration
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.warn('VITE_TMDB_API_KEY not found. TMDB integration will not work.');
}

// Generic TMDB API fetch function with error handling
async function tmdbFetch<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);

  // Add API key as query parameter (fallback for v3 auth)
  url.searchParams.set('api_key', TMDB_API_KEY);

  // Add additional params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limit exceeded - wait and retry
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return tmdbFetch<T>(endpoint, params);
      }

      const errorData: TMDBError = await response.json().catch(() => ({
        status_message: `HTTP ${response.status}`,
        status_code: response.status,
        success: false
      }));

      throw new Error(`TMDB API Error: ${errorData.status_message}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Network error while fetching from TMDB');
  }
}

// Enhanced text normalization for better matching (preserves Umlaute)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD') // Unicode normalization (decomposed)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Remove punctuation but keep letters and numbers
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Create search variations while preserving Umlaute
function createSearchVariations(query: string): string[] {
  const variations = [query];

  // Add version without common prefixes/suffixes
  const withoutPrefix = query.replace(/^(the|a|an|der|die|das)\s+/i, '');
  if (withoutPrefix !== query) {
    variations.push(withoutPrefix);
  }

  // Add normalized version for broader matching
  const normalized = normalizeText(query);
  if (normalized !== query.toLowerCase()) {
    variations.push(normalized);
  }

  return [...new Set(variations)]; // Remove duplicates
}

// Generate query variations for better matching
function generateQueryVariations(query: string): string[] {
  const normalized = normalizeText(query);
  const variations = [normalized];

  // Add version with different punctuation patterns
  variations.push(normalized.replace(/\s+/g, ', ')); // "title, subtitle"
  variations.push(normalized.replace(/\s+/g, ' - ')); // "title - subtitle"
  variations.push(normalized.replace(/\s+/g, ': ')); // "title: subtitle"

  // Add version without common prefixes/suffixes
  const withoutPrefix = normalized.replace(/^(the|a|an)\s+/i, '');
  if (withoutPrefix !== normalized) {
    variations.push(withoutPrefix);
  }

  return [...new Set(variations)]; // Remove duplicates
}

// Unified candidate structure for all media types
// Moved to types/tmdb.ts as TMDBCandidate

// Convert TMDB search results to unified candidates
function convertToCandidates(results: any[], mediaType: 'movie' | 'tv'): TMDBCandidate[] {
  return results.map(result => ({
    id: result.id,
    media_type: mediaType,
    title: mediaType === 'movie'
      ? (result.title || result.original_title || '')
      : (result.name || result.original_name || ''),
    date: mediaType === 'movie' ? result.release_date : result.first_air_date,
    popularity: result.popularity,
    vote_count: result.vote_count
  }));
}

// Convert multi-search results to candidates (filtering only movie/tv)
function convertMultiToCandidates(results: any[]): TMDBCandidate[] {
  return results
    .filter(result => result.media_type === 'movie' || result.media_type === 'tv')
    .map(result => ({
      id: result.id,
      media_type: result.media_type,
      title: result.media_type === 'movie'
        ? (result.title || result.original_title || '')
        : (result.name || result.original_name || ''),
      date: result.media_type === 'movie' ? result.release_date : result.first_air_date,
      popularity: result.popularity,
      vote_count: result.vote_count
    }));
}

// Search across all media types (movie, tv, person)
export async function searchMulti(
  query: string,
  language: string = 'de-DE'
): Promise<TMDBCandidate[]> {
  const params: Record<string, string> = {
    query: query.trim(),
    language,
    page: '1'
  };

  const response: TMDBSearchResponse = await tmdbFetch('/search/multi', params);
  return convertMultiToCandidates(response.results || []);
}
function calculateMatchScore(
  movie: TMDBMovieSearchResult,
  queryTitle: string
): number {
  const query = normalizeText(queryTitle);
  const title = normalizeText(movie.title || '');
  const originalTitle = normalizeText(movie.original_title || '');

  let score = 0;

  // Exact matches get highest score
  if (title === query || originalTitle === query) {
    score += 100;
  }
  // Starts with query
  else if (title.startsWith(query) || originalTitle.startsWith(query)) {
    score += 60;
  }
  // Contains query
  else if (title.includes(query) || originalTitle.includes(query)) {
    score += 40;
  }

  // Popularity and vote count as tie-breakers
  const popularityScore = Math.min(20, Math.log10((movie.popularity || 0) + 1) * 5);
  const voteScore = Math.min(30, Math.log10((movie.vote_count || 0) + 1) * 10);

  return score + popularityScore + voteScore;
}

// Select best matching movie from search results
function selectBestMatch(
  results: TMDBMovieSearchResult[],
  queryTitle: string
): TMDBMovieSearchResult | null {
  if (results.length === 0) return null;

  const scored = results.map(movie => ({
    movie,
    score: calculateMatchScore(movie, queryTitle)
  }));

  scored.sort((a, b) => b.score - a.score);

  // Return best match if score is above threshold
  return scored[0].score > 20 ? scored[0].movie : null;
}

// Search for movies by title
export async function searchMovies(
  query: string,
  options: TMDBSearchOptions = {}
): Promise<TMDBMovieSearchResult[]> {
  const {
    language = 'de-DE',
    region = 'DE',
    year,
    includeAdult = false
  } = options;

  const params: Record<string, string> = {
    query: query.trim(),
    language,
    region,
    include_adult: includeAdult.toString(),
    page: '1'
  };

  if (year) {
    params.primary_release_year = year.toString();
  }

  const response: TMDBSearchResponse = await tmdbFetch('/search/movie', params);
  return response.results || [];
}

// Get details with IMDb ID based on media type
// REMOVED: getDetailsWithImdbId - using getMovieExternalIds instead for lighter payload

// Get movie details including IMDb ID
export async function getMovieDetails(
  movieId: number,
  language = 'de-DE'
): Promise<TMDBMovieDetails> {
  return tmdbFetch<TMDBMovieDetails>(`/movie/${movieId}`, {
    language,
    append_to_response: 'external_ids'
  });
}

// Get external IDs for a movie or TV show
export async function getExternalIds(id: number, type: 'movie' | 'tv'): Promise<TMDBExternalIds> {
  return tmdbFetch<TMDBExternalIds>(`/${type}/${id}/external_ids`);
}

// Get external IDs for a movie
export async function getMovieExternalIds(movieId: number): Promise<TMDBExternalIds> {
  return getExternalIds(movieId, 'movie');
}

// Enhanced scoring for unified candidates with better disambiguation
function calculateCandidateScore(candidate: TMDBCandidate, queryTitle: string): number {
  const query = normalizeText(queryTitle);
  const title = normalizeText(candidate.title);

  let score = 0;

  // Exact matches get highest score
  if (title === query) {
    score += 100;
  }
  // Starts with query
  else if (title.startsWith(query)) {
    score += 60;
  }
  // Contains query
  else if (title.includes(query)) {
    score += 40;
  }

  // Word-level matching for better precision
  const queryWords = query.split(/\s+/).filter(word => word.length > 2);
  const titleWords = title.split(/\s+/).filter(word => word.length > 2);
  const matchingWords = queryWords.filter(qWord =>
    titleWords.some(tWord => tWord.includes(qWord) || qWord.includes(tWord))
  );

  // Bonus for high word match ratio
  const wordMatchRatio = matchingWords.length / Math.max(queryWords.length, 1);
  score += wordMatchRatio * 30;

  // Penalty for extra words in title (to prefer more specific matches)
  const extraWords = titleWords.length - matchingWords.length;
  score -= Math.min(20, extraWords * 2);

  // Stronger weighting for popularity and vote count (better disambiguation)
  const popularityScore = Math.min(25, Math.log10((candidate.popularity || 0) + 1) * 8);
  const voteScore = Math.min(35, Math.log10((candidate.vote_count || 0) + 1) * 12);

  // Recency bonus (prefer newer films for ambiguous titles)
  let recencyBonus = 0;
  if (candidate.date) {
    const releaseYear = new Date(candidate.date).getFullYear();
    const currentYear = new Date().getFullYear();
    const yearsOld = currentYear - releaseYear;

    // Bonus for films from last 5 years, penalty for very old films
    if (yearsOld <= 5) {
      recencyBonus = 15;
    } else if (yearsOld > 20) {
      recencyBonus = -10;
    }
  }

  return score + popularityScore + voteScore + recencyBonus;
}

// Select best candidate from unified results
function selectBestCandidate(candidates: TMDBCandidate[], queryTitle: string): TMDBCandidate | null {
  if (candidates.length === 0) return null;

  const scored = candidates.map(candidate => ({
    candidate,
    score: calculateCandidateScore(candidate, queryTitle)
  }));

  scored.sort((a, b) => b.score - a.score);

  // Return best match if score is above threshold
  return scored[0].score > 20 ? scored[0].candidate : null;
}

// In-memory cache to deduplicate requests for the same title
const titleCache = new Map<string, Promise<MovieWithImdbId | null>>();

// Main function: Get IMDb ID for a movie title with optimized search
export async function getImdbIdForTitle(
  title: string,
  options: TMDBSearchOptions & { year?: number } = {}
): Promise<MovieWithImdbId | null> {
  const cacheKey = `${title}|${options.year || ''}|${options.language || ''}`;
  
  if (titleCache.has(cacheKey)) {
    return titleCache.get(cacheKey)!;
  }

  const requestPromise = (async () => {
    const { language = 'de-DE', year } = options;
    const normalizedTitle = normalizeText(title);
    
    console.log('🎯 TMDB Search for:', title, 'Year:', year);

    // Helper to process results
    const processResults = async (candidates: TMDBCandidate[], queryTitle: string) => {
      if (!candidates || candidates.length === 0) return null;
      
      const bestCandidate = selectBestCandidate(candidates, queryTitle);

      if (bestCandidate) {
        // Get external IDs directly (lighter payload than full details)
        let imdbId: string | null = null;
        try {
          const externalIds = await getExternalIds(bestCandidate.id, bestCandidate.media_type);
          imdbId = externalIds.imdb_id ?? null;
        } catch (e) {
          console.warn('Failed to get external IDs', e);
        }

        if (imdbId) {
          const matchScore = calculateCandidateScore(bestCandidate, queryTitle);
          const confidence = matchScore >= 80 ? 'high' : matchScore >= 40 ? 'medium' : 'low';
          
          return {
            title: bestCandidate.title,
            imdbId,
            tmdbId: bestCandidate.id,
            confidence,
            year: bestCandidate.date ? new Date(bestCandidate.date).getFullYear() : undefined
          };
        }
      }
      return null;
    };

    // 1. Primary Search: Multi-search (Movies + TV) with provided title
    try {
      const results = await searchMulti(title, language);
      const match = await processResults(results, title);
      if (match) return match;
    } catch (e) { console.warn('Primary multi-search failed', e); }

    // 2. Secondary Search: Normalized title (if different)
    if (normalizedTitle !== title.toLowerCase()) {
      try {
        const results = await searchMulti(normalizedTitle, language);
        const match = await processResults(results, normalizedTitle);
        if (match) return match;
      } catch (e) { console.warn('Normalized multi-search failed', e); }
    }

    // 3. Fallback: English search (if original was German)
    if (language === 'de-DE') {
      try {
        const results = await searchMulti(title, 'en-US');
        const match = await processResults(results, title);
        if (match) return match;
      } catch (e) { console.warn('English fallback multi-search failed', e); }
    }

    return null;
  })();

  titleCache.set(cacheKey, requestPromise);
  return requestPromise;
}