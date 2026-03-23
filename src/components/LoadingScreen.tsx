import { useEffect, useState } from 'react';
import { Loader2, Film } from 'lucide-react';
import { initializeGemini } from '@/services/ocrService';

interface LoadingScreenProps {
  onReady: () => void;
}

export const LoadingScreen = ({ onReady }: LoadingScreenProps) => {
  const [loadingText, setLoadingText] = useState('Initialisiere Film Scanner...');

  useEffect(() => {
    const initApp = async () => {
      try {
        setLoadingText('Lade OCR Modell...');
        await initializeGemini();
        setLoadingText('Fast fertig...');
        
        // Small delay for smooth transition
        setTimeout(() => {
          onReady();
        }, 500);
      } catch (error) {
        console.error('Error initializing app:', error);
        setLoadingText('Fehler beim Laden. Versuche erneut...');
        // Retry after 2 seconds
        setTimeout(initApp, 2000);
      }
    };

    initApp();
  }, [onReady]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-6">
        <div className="relative">
          <Film className="w-16 h-16 mx-auto text-primary" />
          <Loader2 className="w-8 h-8 absolute -bottom-2 -right-2 animate-spin text-primary" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Film Scanner</h1>
          <p className="text-muted-foreground">{loadingText}</p>
        </div>

        <div className="w-48 mx-auto">
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-gradient-primary animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
};
