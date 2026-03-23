import React, { useState, useCallback, useMemo, useDeferredValue } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Film, Copy, Trash2, ExternalLink, Loader2, Star, Search, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient, useQueries } from '@tanstack/react-query';
import { fetchMovieData } from '@/services/movieService';

interface MovieTitlesListProps {
  titles: string[];
  onClear: () => void;
}

export const MovieTitlesList = React.memo<MovieTitlesListProps>(function MovieTitlesList({
  titles,
  onClear,
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for UI controls
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'title' | 'rating' | 'hasImdb' | 'none'>('none');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // A single useQueries call to fetch all data concurrently for each title
  const movieQueries = useQueries({
    queries: titles.map(title => {
      return {
        queryKey: ['movieData', title],
        queryFn: () => fetchMovieData(title),
        staleTime: 1000 * 60 * 60, // 1 hour
        retry: 2,
      };
    }),
  });

  // Aggregate loading and error states from all queries
  const isError = movieQueries.some(q => q.isError);

  // Correctly extract successful data and create a lookup map WITHOUT faulty useMemo
  const allMovieData = movieQueries
    .filter(q => q.isSuccess && q.data)
    .map(q => q.data!);

  const movieLookup: Record<string, any> = Object.fromEntries(
    allMovieData.map(data => [data.ocrTitle, data])
  );

  // Stable callbacks with useCallback
  const copyToClipboard = useCallback(async (text: string, description: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Kopiert!', description });
    } catch (error) {
      toast({ title: 'Fehler', description: 'Konnte nicht in die Zwischenablage kopieren', variant: 'destructive' });
    }
  }, [toast]);

  const copyAllTitles = useCallback(async () => {
    const allTitlesText = titles.join('\n');
    await copyToClipboard(allTitlesText, `${titles.length} Titel wurden in die Zwischenablage kopiert`);
  }, [titles, copyToClipboard]);

  const copyAllImdbIds = useCallback(async () => {
    const moviesWithImdbId = allMovieData.filter(movie => !!movie.imdbId);
    if (moviesWithImdbId.length > 0) {
      const imdbIds = moviesWithImdbId.map(movie => movie.imdbId).join('\n');
      await copyToClipboard(imdbIds, `${moviesWithImdbId.length} IMDb-IDs wurden in die Zwischenablage kopiert`);
    }
  }, [allMovieData, copyToClipboard]);

  const copyAllRatings = useCallback(async () => {
    const ratingsLines = allMovieData
      .map(movie => movie.rating ? `${movie.ocrTitle}: ${movie.rating}/10` : null)
      .filter((line): line is string => line !== null);

    if (ratingsLines.length > 0) {
      const ratingsText = ratingsLines.join('\n');
      await copyToClipboard(ratingsText, `${ratingsLines.length} Bewertungen wurden in die Zwischenablage kopiert`);
    }
  }, [allMovieData, copyToClipboard]);


  const openImdbPage = useCallback((imdbId: string) => {
    window.open(`https://www.imdb.com/title/${imdbId}`, '_blank');
  }, []);

  const handleRefresh = useCallback(async () => {
    toast({ title: 'Aktualisiere...', description: 'Daten werden neu geladen' });
    // Invalidate all relevant queries for a complete hard refresh
    await queryClient.invalidateQueries({ queryKey: ['movieData'] });
    await queryClient.invalidateQueries({ queryKey: ['tmdb'] });
    await queryClient.invalidateQueries({ queryKey: ['omdb'] });
    toast({ title: 'Aktualisiert!', description: 'Alle Daten wurden neu geladen' });
  }, [queryClient, toast]);

  const toggleSort = useCallback((newSortBy: 'title' | 'rating' | 'hasImdb') => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder(newSortBy === 'rating' ? 'desc' : 'asc');
    }
  }, [sortBy, sortOrder]);

  const filteredAndSortedTitles = useMemo(() => {
    let filtered = titles.filter(title => title.toLowerCase().includes(deferredSearchTerm.toLowerCase()));

    if (sortBy !== 'none') {
      filtered.sort((a, b) => {
        const movieInfoA = movieLookup[a];
        const movieInfoB = movieLookup[b];
        let comparison = 0;

        switch (sortBy) {
          case 'title':
            comparison = a.localeCompare(b, 'de', { sensitivity: 'base' });
            break;
          case 'rating':
            const ratingA = movieInfoA?.rating ?? 0;
            const ratingB = movieInfoB?.rating ?? 0;
            comparison = ratingB - ratingA;
            break;
          case 'hasImdb':
            const hasImdbA = !!movieInfoA?.imdbId;
            const hasImdbB = !!movieInfoB?.imdbId;
            comparison = hasImdbA === hasImdbB ? 0 : hasImdbA ? -1 : 1;
            break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }
    return filtered;
  }, [titles, deferredSearchTerm, sortBy, sortOrder, movieLookup]);

  if (titles.length === 0) {
    return (
      <Card className="bg-gradient-card shadow-card border-border p-8 text-center">
        <Film className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">Noch keine Titel erkannt</h3>
        <p className="text-muted-foreground">Verwende die Kamera um Filmcover zu scannen</p>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-card shadow-card border-border p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs px-1.5 py-0.5">{titles.length} Film{titles.length !== 1 ? 'e' : ''}</Badge>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={copyAllTitles} className="h-6 px-2 text-xs" title="Alle Titel kopieren"><Copy className="w-3 h-3" /></Button>
          <Button variant="ghost" size="sm" onClick={onClear} className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10" title="Alle löschen"><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>

      <div className="mb-3 flex justify-end gap-1">
        <Button variant="outline" size="sm" onClick={handleRefresh} className="h-7 px-2 text-xs">
          <RefreshCw className="w-3 h-3 mr-1" />
          Aktualisieren
        </Button>
        <Button variant="outline" size="sm" onClick={() => toggleSort('rating')} className="h-7 px-2 text-xs">
          <Star className="w-3 h-3 mr-1" />
          {sortBy === 'rating' ? 'Sortierung aufheben' : 'Nach Rating sortieren'}
        </Button>
      </div>

      {isError && (
        <div className="mb-3 p-2 rounded bg-destructive/5 border border-destructive/20">
          <p className="text-xs text-destructive">Einige Filmdaten konnten nicht geladen werden. Bitte versuche es später erneut.</p>
        </div>
      )}

      <div className="space-y-1">
        {filteredAndSortedTitles.map((title) => {
          const movieInfo = movieLookup[title];
          // Find the query by title to ensure the correct loading state is always shown
          const query = movieQueries.find(q => q && q.queryKey && q.queryKey[1] === title);
          const isTitleLoading = query?.isLoading ?? false;

          return (
            <div key={title} className={`group flex items-center justify-between p-2 rounded-md hover:bg-secondary/50 transition-colors border border-transparent hover:border-secondary/30 ${movieInfo?.rating >= 7 ? 'bg-green-50/30 dark:bg-green-900/10' : ''}`}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h4 className="font-medium text-sm truncate flex-1">{title}</h4>
                {isTitleLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {movieInfo?.imdbId ? (
                  <Button variant="ghost" size="sm" onClick={() => openImdbPage(movieInfo.imdbId!)} className="h-6 w-6 p-0 hover:bg-primary/10" title="IMDb öffnen">
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                ) : <span className="text-xs text-muted-foreground w-6 text-center">—</span>}

                {movieInfo?.rating ? (
                  <div className="flex items-center gap-1 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded-full">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    <span className="font-bold text-sm text-yellow-700 dark:text-yellow-300">{movieInfo.rating}</span>
                  </div>
                ) : <span className="text-xs text-muted-foreground w-8 text-center">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
});
