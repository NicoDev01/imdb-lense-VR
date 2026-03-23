import { useEffect, useState } from 'react';
import { Loader2, Film, AlertCircle } from 'lucide-react';
import { initializeGemini } from '@/services/ocrService';
import { Button } from '@/components/ui/button';

interface LoadingScreenProps {
  onReady: () => void;
}

export const LoadingScreen = ({ onReady }: LoadingScreenProps) => {
  const [loadingText, setLoadingText] = useState('Initialisiere Film Scanner...');
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');

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
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        setErrorDetails(errorMsg);
        
        if (errorMsg.includes('API Key')) {
          setLoadingText('API Key fehlt');
          setHasError(true);
        } else {
          setLoadingText('Fehler beim Laden. Versuche erneut...');
          // Retry after 2 seconds
          setTimeout(initApp, 2000);
        }
      }
    };

    initApp();
  }, [onReady]);

  const handleSkipInit = () => {
    onReady();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-6">
        <div className="relative">
          <Film className="w-16 h-16 mx-auto text-primary" />
          {!hasError && (
            <Loader2 className="w-8 h-8 absolute -bottom-2 -right-2 animate-spin text-primary" />
          )}
          {hasError && (
            <AlertCircle className="w-8 h-8 absolute -bottom-2 -right-2 text-yellow-500" />
          )}
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Film Scanner</h1>
          <p className="text-muted-foreground">{loadingText}</p>
          {hasError && errorDetails && (
            <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto">
              {errorDetails}
            </p>
          )}
        </div>

        {!hasError && (
          <div className="w-48 mx-auto">
            <div className="h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-gradient-primary animate-pulse" />
            </div>
          </div>
        )}

        {hasError && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Füge VITE_GEMINI_API_KEY in die .env Datei ein.
            </p>
            <Button onClick={handleSkipInit} variant="outline" size="sm">
              Trotzdem starten (Demo-Modus)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
