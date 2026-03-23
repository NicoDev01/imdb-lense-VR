import { useState, useRef } from 'react';
import { MovieTitlesList } from '@/components/MovieTitlesList';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ARScanner } from '@/components/ARScanner';
import { Button } from '@/components/ui/button';
import { List, ScanLine } from 'lucide-react';

const Index = () => {
  const [isReady, setIsReady] = useState(false);
  const [movieTitles, setMovieTitles] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [showList, setShowList] = useState(false);
  
  // Keep track of normalized titles to prevent duplicates
  const existingTitlesRef = useRef<Set<string>>(new Set());

  const handleTitleFound = (title: string, rating: string | null) => {
    const normalized = title.trim().toLowerCase();
    
    // Check if we already have this title (normalized)
    if (!existingTitlesRef.current.has(normalized)) {
      existingTitlesRef.current.add(normalized);
      setMovieTitles(prev => [title.trim(), ...prev]); // Add new ones to top
    }
  };

  const clearTitles = () => {
    setMovieTitles([]);
    existingTitlesRef.current.clear();
  };

  if (!isReady) {
    return <LoadingScreen onReady={() => setIsReady(true)} />;
  }

  return (
    <div className={`h-screen w-screen relative overflow-hidden ${isScanning ? 'bg-transparent' : 'bg-black'}`}>
      
      {/* Full Screen AR Scanner */}
      <div className="absolute inset-0 z-0">
        {isScanning ? (
          <ARScanner 
            onTitleFound={handleTitleFound} 
            isScanning={isScanning}
            onClose={() => setIsScanning(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
            <div className="text-center">
              <p className="mb-4">Scanner Paused</p>
              <Button onClick={() => setIsScanning(true)}>
                <ScanLine className="mr-2 h-4 w-4" /> Resume Scan
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Controls */}
      <div className="absolute bottom-8 right-8 z-50 flex flex-col gap-4">
         <Button 
            onClick={() => setShowList(true)} 
            size="icon" 
            className="rounded-full h-14 w-14 shadow-lg bg-primary hover:bg-primary/90"
         >
            <List className="h-6 w-6" />
            {movieTitles.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center border-2 border-background">
                    {movieTitles.length}
                </span>
            )}
         </Button>
      </div>

      {/* List Overlay (Full Screen Drawer) */}
      {showList && (
        <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col animate-in slide-in-from-bottom duration-300">
          <div className="p-4 border-b flex justify-between items-center bg-background/50">
              <h2 className="font-bold text-xl">Gefundene Filme ({movieTitles.length})</h2>
              <Button variant="ghost" onClick={() => setShowList(false)}>Schließen</Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-md mx-auto pb-24">
              <MovieTitlesList
                titles={movieTitles}
                onClear={clearTitles}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
