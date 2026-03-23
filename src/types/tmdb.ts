// TMDB API Response Types

export interface TMDBMovieSearchResult {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
  adult?: boolean;
  video?: boolean;
  genre_ids?: number[];
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  original_language?: string;
}

export interface TMDBSearchResponse {
  page: number;
  results: TMDBMovieSearchResult[];
  total_pages: number;
  total_results: number;
}

export interface TMDBMovieDetails {
  id: number;
  imdb_id?: string;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  runtime?: number;
  genres: Array<{ id: number; name: string }>;
  vote_average: number;
  vote_count: number;
  popularity: number;
  poster_path?: string;
  backdrop_path?: string;
  external_ids?: TMDBExternalIds;
}

export interface TMDBExternalIds {
  imdb_id?: string;
  facebook_id?: string;
  instagram_id?: string;
  twitter_id?: string;
}

export interface TMDBError {
  status_message: string;
  status_code: number;
  success: boolean;
}

// Custom types for our app
export interface MovieWithImdbId {
  title: string;
  imdbId: string | null;
  tmdbId: number;
  confidence: 'high' | 'medium' | 'low';
  year?: number;
}

export interface TMDBSearchOptions {
  language?: string;
  region?: string;
  year?: number;
  includeAdult?: boolean;
}

// Unified candidate structure for all media types (Movies + TV)
export interface TMDBCandidate {
  id: number;
  media_type: 'movie' | 'tv';
  title: string;
  date?: string;
  popularity?: number;
  vote_count?: number;
}
