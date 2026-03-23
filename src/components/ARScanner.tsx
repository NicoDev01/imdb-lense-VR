import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon, Loader2, ZoomIn, ZoomOut, Camera, RefreshCw } from 'lucide-react';
import { analyzeFrameForCovers, DetectedCover } from '@/services/ocrService';
import { fetchMovieData, MovieDataResponse } from '@/services/movieService';
import { useQueryClient } from '@tanstack/react-query';
import NativeAR, { ZoomInfo } from '@/plugins/NativeARPlugin';
import { Capacitor } from '@capacitor/core';

interface ARScannerProps {
  onTitleFound: (title: string, rating: string) => void;
  onClose: () => void;
  isScanning: boolean;
}

interface EnrichedCover extends DetectedCover {
  movieData?: MovieDataResponse;
  isLoading?: boolean;
}

export const ARScanner = ({ onTitleFound, onClose, isScanning }: ARScannerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const [maxZoom, setMaxZoom] = useState(1.0);
  const [isNative, setIsNative] = useState(false);
  const queryClient = useQueryClient();
  
  // Detection state
  const [detectedCovers, setDetectedCovers] = useState<EnrichedCover[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const lastAnalysisTime = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Cache for movie data
  const movieCache = useRef<Map<string, MovieDataResponse>>(new Map());
  
  // Analysis interval (ms) - how often to analyze frame
  const ANALYSIS_INTERVAL = 2000; // 2 seconds between full frame analysis
  
  // Debug logs
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    console.log(`[ARScanner] ${msg}`);
    setLogs(prev => [msg, ...prev].slice(0, 6));
  }, []);
  
  // Initialize camera
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    
    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const platform = Capacitor.getPlatform();
        addLog(`Platform: ${platform}`);
        
        if (platform === 'android' || platform === 'ios') {
          // Native mode
          setIsNative(true);
          addLog('Starting native camera...');
          
          // Make background transparent
          document.body.style.backgroundColor = 'transparent';
          document.documentElement.style.backgroundColor = 'transparent';
          
          await NativeAR.startCamera();
          addLog('Native camera started');
          
          // Get zoom info
          try {
            const zoomInfo: ZoomInfo = await NativeAR.getZoom();
            setCurrentZoom(zoomInfo.zoom);
            setMaxZoom(zoomInfo.maxZoom);
            addLog(`Zoom: ${zoomInfo.zoom}x (max: ${zoomInfo.maxZoom}x)`);
          } catch (e) {
            addLog('Zoom not available');
          }
          
          cleanup = () => {
            NativeAR.stopCamera().catch(console.error);
            document.body.style.backgroundColor = '';
            document.documentElement.style.backgroundColor = '';
          };
        } else {
          // Web mode - use getUserMedia
          setIsNative(false);
          addLog('Starting web camera...');
          
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
            audio: false
          });
          
          streamRef.current = stream;
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            addLog('Web camera started');
          }
          
          cleanup = () => {
            stream.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          };
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error('Camera init failed:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        addLog(`Error: ${errorMsg}`);
        setIsLoading(false);
      }
    };
    
    if (isScanning) {
      init();
    }
    
    return () => {
      cleanup?.();
    };
  }, [isScanning, addLog]);
  
  // Capture current frame as base64
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (isNative) {
      // For native, we need to get frame from native plugin
      // This requires the cropObject method with full frame
      // For now, fall back to periodic full-frame capture
      try {
        const result = await NativeAR.cropObject({ objectId: '__fullframe__' });
        return result.imageBase64;
      } catch {
        // Full frame capture not supported, skip
        return null;
      }
    } else {
      // Web mode - capture from video
      const video = videoRef.current;
      if (!video || video.readyState !== 4) return null;
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      ctx.drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.8);
    }
  }, [isNative]);
  
  // Analyze frame for covers
  const analyzeCurrentFrame = useCallback(async () => {
    if (isAnalyzing) return;
    
    const now = Date.now();
    if (now - lastAnalysisTime.current < ANALYSIS_INTERVAL) return;
    
    lastAnalysisTime.current = now;
    setIsAnalyzing(true);
    addLog('Analyzing frame...');
    
    try {
      const frameBase64 = await captureFrame();
      if (!frameBase64) {
        addLog('No frame captured');
        setIsAnalyzing(false);
        return;
      }
      
      // Analyze with Gemini Vision
      const result = await analyzeFrameForCovers(frameBase64);
      addLog(`Found ${result.covers.length} covers`);
      
      if (result.covers.length > 0) {
        // Enrich covers with movie data
        const enrichedCovers: EnrichedCover[] = result.covers.map(cover => ({
          ...cover,
          isLoading: !movieCache.current.has(cover.title.toLowerCase())
        }));
        
        setDetectedCovers(enrichedCovers);
        
        // Fetch movie data for each cover
        for (const cover of enrichedCovers) {
          const cacheKey = cover.title.toLowerCase();
          
          if (movieCache.current.has(cacheKey)) {
            // Use cached data
            const cached = movieCache.current.get(cacheKey)!;
            setDetectedCovers(prev => prev.map(c => 
              c.title === cover.title 
                ? { ...c, movieData: cached, isLoading: false }
                : c
            ));
            
            if (cached.rating) {
              onTitleFound(cover.title, cached.rating.toString());
            }
          } else {
            // Fetch new data
            try {
              const movieData = await fetchMovieData(cover.title);
              movieCache.current.set(cacheKey, movieData);
              
              setDetectedCovers(prev => prev.map(c => 
                c.title === cover.title 
                  ? { ...c, movieData, isLoading: false }
                  : c
              ));
              
              if (movieData.rating) {
                onTitleFound(cover.title, movieData.rating.toString());
              }
              
              // Update React Query cache
              queryClient.setQueryData(['movieData', cover.title], movieData);
            } catch (err) {
              console.error(`Failed to fetch data for ${cover.title}:`, err);
              setDetectedCovers(prev => prev.map(c => 
                c.title === cover.title 
                  ? { ...c, isLoading: false }
                  : c
              ));
            }
          }
        }
      }
    } catch (err) {
      console.error('Frame analysis failed:', err);
      addLog(`Analysis error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
    
    setIsAnalyzing(false);
  }, [isAnalyzing, captureFrame, addLog, onTitleFound, queryClient]);
  
  // Periodic analysis loop
  useEffect(() => {
    if (isLoading || error) return;
    
    const interval = setInterval(analyzeCurrentFrame, ANALYSIS_INTERVAL);
    
    // Initial analysis
    analyzeCurrentFrame();
    
    return () => clearInterval(interval);
  }, [isLoading, error, analyzeCurrentFrame]);
  
  // Draw overlay with detected covers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Match canvas to container
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    
    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (const cover of detectedCovers) {
        const { boundingBox, title, movieData, isLoading: loading } = cover;
        
        // Convert normalized bbox to screen coordinates
        const x = boundingBox.x * canvas.width;
        const y = boundingBox.y * canvas.height;
        const w = boundingBox.width * canvas.width;
        const h = boundingBox.height * canvas.height;
        
        // Determine color based on state
        let boxColor = 'rgba(255, 255, 255, 0.8)';
        if (loading) {
          boxColor = 'rgba(59, 130, 246, 0.9)'; // Blue while loading
        } else if (movieData?.rating) {
          boxColor = 'rgba(74, 222, 128, 0.9)'; // Green when identified
        }
        
        // Draw bounding box with rounded corners
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = boxColor;
        
        const radius = 8;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.stroke();
        
        // Semi-transparent fill
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fill();
        
        // Draw label badge
        const badgeY = y - 50 < 0 ? y + 10 : y - 50;
        const badgeWidth = Math.max(w, 180);
        
        // Badge background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        ctx.roundRect(x, badgeY, badgeWidth, 45, 8);
        ctx.fill();
        
        if (loading) {
          // Loading state
          ctx.fillStyle = '#60a5fa';
          ctx.font = 'bold 16px system-ui, sans-serif';
          ctx.fillText('⏳ Loading...', x + 12, badgeY + 28);
        } else if (movieData?.rating) {
          // Show rating with star
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 24px system-ui, sans-serif';
          ctx.fillText('★', x + 10, badgeY + 30);
          
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 20px system-ui, sans-serif';
          ctx.fillText(movieData.rating.toString(), x + 38, badgeY + 30);
          
          // Show title (truncated)
          let displayTitle = movieData.title || title;
          if (displayTitle.length > 16) {
            displayTitle = displayTitle.substring(0, 14) + '...';
          }
          ctx.font = '13px system-ui, sans-serif';
          ctx.fillStyle = '#CCC';
          ctx.fillText(displayTitle, x + 75, badgeY + 30);
        } else {
          // No rating found
          ctx.fillStyle = '#888';
          ctx.font = '14px system-ui, sans-serif';
          let displayTitle = title;
          if (displayTitle.length > 20) {
            displayTitle = displayTitle.substring(0, 18) + '...';
          }
          ctx.fillText(displayTitle, x + 12, badgeY + 28);
        }
      }
      
      requestAnimationFrame(drawFrame);
    };
    
    const animationId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animationId);
  }, [detectedCovers]);
  
  // Zoom controls (native only)
  const handleZoomIn = async () => {
    if (!isNative) return;
    const newZoom = Math.min(currentZoom + 0.5, maxZoom);
    try {
      const result = await NativeAR.setZoom({ zoom: newZoom });
      setCurrentZoom(result.zoom);
    } catch (err) {
      console.error('Zoom failed:', err);
    }
  };
  
  const handleZoomOut = async () => {
    if (!isNative) return;
    const newZoom = Math.max(currentZoom - 0.5, 1.0);
    try {
      const result = await NativeAR.setZoom({ zoom: newZoom });
      setCurrentZoom(result.zoom);
    } catch (err) {
      console.error('Zoom failed:', err);
    }
  };
  
  // Manual scan trigger
  const handleManualScan = () => {
    lastAnalysisTime.current = 0; // Reset timer
    analyzeCurrentFrame();
  };
  
  // Close handler
  const handleClose = async () => {
    if (isNative) {
      try {
        await NativeAR.stopCamera();
      } catch (err) {
        console.error('Stop camera failed:', err);
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    onClose();
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex justify-center items-center">
      {/* Video element for web mode */}
      {!isNative && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          autoPlay
          muted
        />
      )}
      
      {/* AR Overlay Canvas */}
      <canvas 
        ref={canvasRef}
        className="absolute w-full h-full pointer-events-none z-20"
        style={{ background: isNative ? 'transparent' : 'transparent' }}
      />

      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="text-center text-white">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4" />
            <p>Starting Camera...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
          <div className="text-center text-white p-4">
            <Camera className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-red-400 mb-2 font-bold">Camera Error</p>
            <p className="text-sm text-gray-400 mb-4">{error}</p>
            <Button onClick={handleClose} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Top Controls */}
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-2">
        <Button 
          variant="secondary" 
          size="icon" 
          onClick={handleClose} 
          className="rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <XIcon className="h-6 w-6" />
        </Button>
      </div>

      {/* Zoom Controls (native only) */}
      {isNative && maxZoom > 1 && (
        <div className="absolute top-4 left-4 z-50 flex flex-col gap-2">
          <Button 
            variant="secondary" 
            size="icon" 
            onClick={handleZoomIn}
            disabled={currentZoom >= maxZoom}
            className="rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ZoomIn className="h-5 w-5" />
          </Button>
          <div className="text-white text-center text-sm bg-black/50 rounded-full px-2 py-1">
            {currentZoom.toFixed(1)}x
          </div>
          <Button 
            variant="secondary" 
            size="icon" 
            onClick={handleZoomOut}
            disabled={currentZoom <= 1}
            className="rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ZoomOut className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* Manual Scan Button */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50">
        <Button 
          onClick={handleManualScan}
          disabled={isAnalyzing}
          className="rounded-full bg-white/90 text-black hover:bg-white px-6 py-3 font-semibold shadow-lg"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <RefreshCw className="h-5 w-5 mr-2" />
              Scan Now
            </>
          )}
        </Button>
      </div>

      {/* Status Bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-black/60 text-white px-4 py-2 rounded-full text-sm flex items-center gap-2">
        {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
        <span>{detectedCovers.length} covers detected</span>
      </div>

      {/* Debug Log */}
      <div className="absolute bottom-4 left-4 z-40 bg-black/60 text-green-400 p-2 rounded text-xs font-mono max-w-[70%] pointer-events-none">
        {logs.map((log, i) => (
          <div key={i} className="truncate">{log}</div>
        ))}
      </div>
    </div>
  );
};
