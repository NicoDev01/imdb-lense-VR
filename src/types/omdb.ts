// OMDb API Response Types

export interface OmdbMovieResponse {
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Awards?: string;
  Poster?: string;
  Ratings?: Array<{
    Source: string;
    Value: string;
  }>;
  Metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: 'movie' | 'series' | 'episode';
  DVD?: string;
  BoxOffice?: string;
  Production?: string;
  Website?: string;
  Response: 'True' | 'False';
  Error?: string;
}

export interface OmdbError {
  Response: 'False';
  Error: string;
}

// Custom types for our app
export interface MovieRating {
  imdbId: string;
  rating: number | null;
  votes: string | null;
  source: 'omdb';
}

export interface MovieWithRating {
  title: string;
  imdbId: string | null;
  rating: number | null;
  votes: string | null;
  confidence: 'high' | 'medium' | 'low';
  year?: number;
}

// Search types (if needed in future)
export interface OmdbSearchResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: 'movie' | 'series' | 'episode';
  Poster: string;
}

export interface OmdbSearchResponse {
  Search?: OmdbSearchResult[];
  totalResults?: string;
  Response: 'True' | 'False';
  Error?: string;
}
