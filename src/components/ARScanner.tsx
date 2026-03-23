import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon, Loader2, ZoomIn, ZoomOut, Camera, RefreshCw, Filter } from 'lucide-react';
import { analyzeFrameForCovers, DetectedCover } from '@/services/ocrService';
import { fetchMovieDataBatch, MovieDataResponse } from '@/services/movieService';
import { useQueryClient } from '@tanstack/react-query';
import NativeAR, { ZoomInfo } from '@/plugins/NativeARPlugin';
import { Capacitor } from '@capacitor/core';

interface ARScannerProps {
  onTitleFound: (title: string, rating: string) => void;
  onClose: () => void;
  isScanning: boolean;
}

interface TrackedCover {
  id: string;
  title: string;
  // Current position (for smooth interpolation)
  currentBox: { x: number; y: number; width: number; height: number };
  // Target position (from detection)
  targetBox: { x: number; y: number; width: number; height: number };
  confidence: 'high' | 'medium' | 'low';
  movieData?: MovieDataResponse;
  isLoading: boolean;
  lastSeen: number;
  framesSinceUpdate: number;
}

// Configuration
const CONFIG = {
  ANALYSIS_INTERVAL_MS: 1500,        // How often to analyze (faster with new model)
  MOTION_THRESHOLD: 0.02,            // Min change to trigger re-analysis
  SMOOTHING_FACTOR: 0.25,            // How smooth the box interpolation is (0-1)
  COVER_TIMEOUT_MS: 3000,            // How long to keep covers visible after lost
  MIN_RATING_FILTER: 0,              // Default: show all ratings
  INTERPOLATION_FPS: 30,             // Smooth animation framerate
};

export const ARScanner = ({ onTitleFound, onClose, isScanning }: ARScannerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const [maxZoom, setMaxZoom] = useState(1.0);
  const [isNative, setIsNative] = useState(false);
  const [minRatingFilter, setMinRatingFilter] = useState(CONFIG.MIN_RATING_FILTER);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const queryClient = useQueryClient();
  
  // Detection state
  const [trackedCovers, setTrackedCovers] = useState<Map<string, TrackedCover>>(new Map());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [coversFound, setCoversFound] = useState(0);
  const lastAnalysisTime = useRef(0);
  const lastFrameHash = useRef<string>('');
  const streamRef = useRef<MediaStream | null>(null);
  
  // Debug logs
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    console.log(`[ARScanner] ${msg}`);
    setLogs(prev => [msg, ...prev].slice(0, 5));
  }, []);

  // Haptic feedback helper
  const triggerHaptic = useCallback(() => {
    if (isNative && 'vibrate' in navigator) {
      navigator.vibrate(50); // Short vibration
    }
  }, [isNative]);

  // Calculate simple frame hash for motion detection
  const calculateFrameHash = useCallback((canvas: HTMLCanvasElement): string => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    
    // Sample a small grid of pixels for quick comparison
    const gridSize = 8;
    const stepX = Math.floor(canvas.width / gridSize);
    const stepY = Math.floor(canvas.height / gridSize);
    let hash = '';
    
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const pixel = ctx.getImageData(x * stepX, y * stepY, 1, 1).data;
        // Quantize to reduce sensitivity
        const gray = Math.floor((pixel[0] + pixel[1] + pixel[2]) / 3 / 32);
        hash += gray.toString(16);
      }
    }
    return hash;
  }, []);

  // Check if frame has significant motion
  const hasSignificantMotion = useCallback((newHash: string): boolean => {
    if (!lastFrameHash.current) {
      lastFrameHash.current = newHash;
      return true;
    }
    
    let differences = 0;
    const minLength = Math.min(newHash.length, lastFrameHash.current.length);
    
    for (let i = 0; i < minLength; i++) {
      if (newHash[i] !== lastFrameHash.current[i]) {
        differences++;
      }
    }
    
    const changeRatio = differences / minLength;
    lastFrameHash.current = newHash;
    
    return changeRatio > CONFIG.MOTION_THRESHOLD;
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
          setIsNative(true);
          addLog('Starting native camera...');
          
          document.body.style.backgroundColor = 'transparent';
          document.documentElement.style.backgroundColor = 'transparent';
          
          await NativeAR.startCamera();
          addLog('Native camera started');
          
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
  const captureFrame = useCallback(async (): Promise<{ base64: string; canvas: HTMLCanvasElement } | null> => {
    if (isNative) {
      try {
        const result = await NativeAR.cropObject({ objectId: '__fullframe__' });
        // Create a temporary canvas for motion detection
        const canvas = document.createElement('canvas');
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = result.imageBase64;
        });
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        return { base64: result.imageBase64, canvas };
      } catch {
        return null;
      }
    } else {
      const video = videoRef.current;
      if (!video || video.readyState !== 4) return null;
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      ctx.drawImage(video, 0, 0);
      return { base64: canvas.toDataURL('image/jpeg', 0.8), canvas };
    }
  }, [isNative]);

  // Update tracked covers with new detections
  const updateTrackedCovers = useCallback((newCovers: DetectedCover[]) => {
    const now = Date.now();
    
    setTrackedCovers(prev => {
      const updated = new Map(prev);
      const matchedIds = new Set<string>();

      // Match new covers to existing ones (by title similarity)
      for (const newCover of newCovers) {
        const existingEntry = Array.from(updated.entries()).find(
          ([_, cover]) => cover.title.toLowerCase() === newCover.title.toLowerCase()
        );

        if (existingEntry) {
          const [id, existing] = existingEntry;
          matchedIds.add(id);
          
          // Update target position for smooth interpolation
          updated.set(id, {
            ...existing,
            targetBox: { ...newCover.boundingBox },
            confidence: newCover.confidence,
            lastSeen: now,
            framesSinceUpdate: 0,
          });
        } else {
          // New cover detected
          const id = `cover_${now}_${Math.random().toString(36).substr(2, 9)}`;
          updated.set(id, {
            id,
            title: newCover.title,
            currentBox: { ...newCover.boundingBox },
            targetBox: { ...newCover.boundingBox },
            confidence: newCover.confidence,
            isLoading: true,
            lastSeen: now,
            framesSinceUpdate: 0,
          });
          
          // Haptic feedback for new cover
          triggerHaptic();
        }
      }

      // Mark unmatched covers as aging
      for (const [id, cover] of updated) {
        if (!matchedIds.has(id) && !newCovers.some(nc => nc.title.toLowerCase() === cover.title.toLowerCase())) {
          cover.framesSinceUpdate++;
          
          // Remove covers that haven't been seen for too long
          if (now - cover.lastSeen > CONFIG.COVER_TIMEOUT_MS) {
            updated.delete(id);
          }
        }
      }

      return updated;
    });
  }, [triggerHaptic]);

  // Fetch movie data for covers in parallel
  const fetchMovieDataForCovers = useCallback(async (covers: DetectedCover[]) => {
    const titles = covers.map(c => c.title);
    
    try {
      const results = await fetchMovieDataBatch(titles);
      
      setTrackedCovers(prev => {
        const updated = new Map(prev);
        
        for (const [id, cover] of updated) {
          const movieData = results.get(cover.title);
          if (movieData) {
            updated.set(id, {
              ...cover,
              movieData,
              isLoading: false,
            });
            
            // Notify parent and update query cache
            if (movieData.rating) {
              onTitleFound(cover.title, movieData.rating.toString());
              queryClient.setQueryData(['movieData', cover.title], movieData);
            }
          }
        }
        
        return updated;
      });
    } catch (err) {
      console.error('Batch fetch failed:', err);
      // Mark all as not loading on error
      setTrackedCovers(prev => {
        const updated = new Map(prev);
        for (const [id, cover] of updated) {
          if (cover.isLoading) {
            updated.set(id, { ...cover, isLoading: false });
          }
        }
        return updated;
      });
    }
  }, [onTitleFound, queryClient]);
  
  // Analyze frame for covers
  const analyzeCurrentFrame = useCallback(async (force: boolean = false) => {
    if (isAnalyzing) return;
    
    const now = Date.now();
    if (!force && now - lastAnalysisTime.current < CONFIG.ANALYSIS_INTERVAL_MS) return;
    
    try {
      const frameResult = await captureFrame();
      if (!frameResult) {
        return;
      }
      
      // Motion detection - skip if no significant change (unless forced)
      const frameHash = calculateFrameHash(frameResult.canvas);
      if (!force && !hasSignificantMotion(frameHash)) {
        addLog('No motion detected, skipping');
        return;
      }
      
      lastAnalysisTime.current = now;
      setIsAnalyzing(true);
      addLog('Analyzing frame...');
      
      // Analyze with Gemini Vision
      const result = await analyzeFrameForCovers(frameResult.base64);
      addLog(`Found ${result.covers.length} covers`);
      
      setCoversFound(result.covers.length);
      
      if (result.covers.length > 0) {
        // Update tracked covers
        updateTrackedCovers(result.covers);
        
        // Fetch movie data in parallel for new covers
        const newCovers = result.covers.filter(cover => {
          const existing = Array.from(trackedCovers.values()).find(
            tc => tc.title.toLowerCase() === cover.title.toLowerCase() && tc.movieData
          );
          return !existing;
        });
        
        if (newCovers.length > 0) {
          fetchMovieDataForCovers(newCovers);
        }
      }
    } catch (err) {
      console.error('Frame analysis failed:', err);
      addLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
    
    setIsAnalyzing(false);
  }, [isAnalyzing, captureFrame, calculateFrameHash, hasSignificantMotion, addLog, updateTrackedCovers, fetchMovieDataForCovers, trackedCovers]);
  
  // Periodic analysis loop
  useEffect(() => {
    if (isLoading || error) return;
    
    const interval = setInterval(() => analyzeCurrentFrame(false), CONFIG.ANALYSIS_INTERVAL_MS);
    
    // Initial analysis
    setTimeout(() => analyzeCurrentFrame(true), 500);
    
    return () => clearInterval(interval);
  }, [isLoading, error, analyzeCurrentFrame]);

  // Smooth interpolation animation loop
  useEffect(() => {
    let animationId: number;
    
    const interpolate = () => {
      setTrackedCovers(prev => {
        const updated = new Map(prev);
        let hasChanges = false;
        
        for (const [id, cover] of updated) {
          const { currentBox, targetBox } = cover;
          
          // Interpolate towards target
          const newBox = {
            x: currentBox.x + (targetBox.x - currentBox.x) * CONFIG.SMOOTHING_FACTOR,
            y: currentBox.y + (targetBox.y - currentBox.y) * CONFIG.SMOOTHING_FACTOR,
            width: currentBox.width + (targetBox.width - currentBox.width) * CONFIG.SMOOTHING_FACTOR,
            height: currentBox.height + (targetBox.height - currentBox.height) * CONFIG.SMOOTHING_FACTOR,
          };
          
          // Check if position changed significantly
          const threshold = 0.001;
          if (
            Math.abs(newBox.x - currentBox.x) > threshold ||
            Math.abs(newBox.y - currentBox.y) > threshold ||
            Math.abs(newBox.width - currentBox.width) > threshold ||
            Math.abs(newBox.height - currentBox.height) > threshold
          ) {
            updated.set(id, { ...cover, currentBox: newBox });
            hasChanges = true;
          }
        }
        
        return hasChanges ? updated : prev;
      });
      
      animationId = requestAnimationFrame(interpolate);
    };
    
    animationId = requestAnimationFrame(interpolate);
    
    return () => cancelAnimationFrame(animationId);
  }, []);
  
  // Draw overlay with tracked covers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    
    const drawFrame = () => {
      // Match canvas to container
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (const [_, cover] of trackedCovers) {
        const { currentBox, confidence, movieData, isLoading } = cover;
        
        // Apply rating filter
        if (movieData?.rating && movieData.rating < minRatingFilter) {
          continue;
        }
        
        // Convert normalized bbox to screen coordinates
        const x = currentBox.x * canvas.width;
        const y = currentBox.y * canvas.height;
        const w = currentBox.width * canvas.width;
        const h = currentBox.height * canvas.height;
        
        // Determine style based on state and confidence
        let boxColor = 'rgba(255, 255, 255, 0.6)';
        let lineStyle: number[] = [];
        
        if (confidence === 'low') {
          boxColor = 'rgba(255, 255, 255, 0.4)';
          lineStyle = [5, 5]; // Dashed for low confidence
        } else if (confidence === 'medium') {
          boxColor = 'rgba(255, 200, 100, 0.7)';
          lineStyle = [10, 5]; // Dotted for medium
        } else if (isLoading) {
          boxColor = 'rgba(59, 130, 246, 0.9)';
        } else if (movieData?.rating) {
          // Color based on rating
          if (movieData.rating >= 7.5) {
            boxColor = 'rgba(74, 222, 128, 0.9)'; // Green for good
          } else if (movieData.rating >= 6.0) {
            boxColor = 'rgba(250, 204, 21, 0.9)'; // Yellow for okay
          } else {
            boxColor = 'rgba(248, 113, 113, 0.9)'; // Red for poor
          }
        }
        
        // Draw bounding box with rounded corners
        ctx.setLineDash(lineStyle);
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
        ctx.setLineDash([]);
        
        // Semi-transparent fill
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fill();
        
        // Draw label badge
        const badgeY = y - 52 < 0 ? y + 10 : y - 52;
        const badgeWidth = Math.max(w, 200);
        
        // Badge background with shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        ctx.roundRect(x, badgeY, badgeWidth, 48, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        if (isLoading) {
          // Loading animation
          ctx.fillStyle = '#60a5fa';
          ctx.font = 'bold 16px system-ui, sans-serif';
          ctx.fillText('⏳ Laden...', x + 12, badgeY + 30);
        } else if (movieData?.rating) {
          // Star icon
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 26px system-ui, sans-serif';
          ctx.fillText('★', x + 10, badgeY + 32);
          
          // Rating with color
          const ratingColor = movieData.rating >= 7.5 ? '#4ade80' : 
                              movieData.rating >= 6.0 ? '#facc15' : '#f87171';
          ctx.fillStyle = ratingColor;
          ctx.font = 'bold 22px system-ui, sans-serif';
          ctx.fillText(movieData.rating.toFixed(1), x + 42, badgeY + 32);
          
          // Title
          let displayTitle = movieData.title || cover.title;
          if (displayTitle.length > 14) {
            displayTitle = displayTitle.substring(0, 12) + '...';
          }
          ctx.font = '14px system-ui, sans-serif';
          ctx.fillStyle = '#CCC';
          ctx.fillText(displayTitle, x + 95, badgeY + 32);
        } else if (confidence !== 'low') {
          // No rating found but confident detection
          ctx.fillStyle = '#888';
          ctx.font = '14px system-ui, sans-serif';
          let displayTitle = cover.title;
          if (displayTitle.length > 22) {
            displayTitle = displayTitle.substring(0, 20) + '...';
          }
          ctx.fillText(displayTitle, x + 12, badgeY + 30);
        }
      }
      
      animationId = requestAnimationFrame(drawFrame);
    };
    
    animationId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animationId);
  }, [trackedCovers, minRatingFilter]);
  
  // Zoom controls
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
    lastAnalysisTime.current = 0;
    lastFrameHash.current = '';
    analyzeCurrentFrame(true);
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

  // Rating filter options
  const filterOptions = [
    { label: 'Alle', value: 0 },
    { label: '6.0+', value: 6.0 },
    { label: '7.0+', value: 7.0 },
    { label: '8.0+', value: 8.0 },
  ];

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

      {/* Filter Button */}
      <div className="absolute top-4 right-16 z-50">
        <Button 
          variant="secondary" 
          size="icon" 
          onClick={() => setShowFilterMenu(!showFilterMenu)}
          className="rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <Filter className="h-5 w-5" />
        </Button>
        
        {showFilterMenu && (
          <div className="absolute top-12 right-0 bg-black/90 rounded-lg p-2 min-w-[100px]">
            {filterOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => {
                  setMinRatingFilter(opt.value);
                  setShowFilterMenu(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded text-sm ${
                  minRatingFilter === opt.value 
                    ? 'bg-primary text-white' 
                    : 'text-gray-300 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
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
              Scanning...
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
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-black/60 text-white px-4 py-2 rounded-full text-sm flex items-center gap-2">
        {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
        <span>{trackedCovers.size} covers • {coversFound} detected</span>
        {minRatingFilter > 0 && (
          <span className="text-yellow-400">• {minRatingFilter}+ filter</span>
        )}
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
