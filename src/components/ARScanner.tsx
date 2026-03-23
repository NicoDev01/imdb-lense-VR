import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { extractTextFromImage } from '@/services/ocrService';
import { fetchMovieData } from '@/services/movieService';
import { useQueryClient } from '@tanstack/react-query';
import NativeAR, { TrackedObject, DetectionUpdateEvent } from '@/plugins/NativeARPlugin';
import { Capacitor } from '@capacitor/core';

interface ARScannerProps {
  onTitleFound: (title: string, rating: string) => void;
  onClose: () => void;
  isScanning: boolean;
}

export const ARScanner = ({ onTitleFound, onClose, isScanning }: ARScannerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const [maxZoom, setMaxZoom] = useState(1.0);
  const queryClient = useQueryClient();
  
  // Tracking state
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const isProcessingRef = useRef<boolean>(false);
  const processedIdsRef = useRef<Set<string>>(new Set());
  
  // Cache for known titles
  const titleCacheRef = useRef<Map<string, { rating: string; votes: string }>>(new Map());
  
  // Frame dimensions for overlay rendering
  const frameDimensionsRef = useRef({ width: 1280, height: 720 });
  
  // Stability threshold for OCR trigger
  const STABILITY_TRIGGER = 8;
  
  // Debug logs
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    console.log(`[ARScanner] ${msg}`);
    setLogs(prev => [msg, ...prev].slice(0, 8));
  }, []);
  
  // Initialize camera and detection
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    
    // Make background transparent for camera visibility
    const originalBodyBg = document.body.style.backgroundColor;
    const originalHtmlBg = document.documentElement.style.backgroundColor;
    
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    
    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        addLog(`Platform: ${Capacitor.getPlatform()}`);
        addLog('Starting native camera...');
        
        // Start camera
        await NativeAR.startCamera();
        addLog('Camera started');
        
        // Get zoom info
        try {
          const zoomInfo = await NativeAR.getZoom();
          setCurrentZoom(zoomInfo.zoom);
          setMaxZoom(zoomInfo.maxZoom);
          addLog(`Zoom: ${zoomInfo.zoom}x (max: ${zoomInfo.maxZoom}x)`);
        } catch (e) {
          addLog('Zoom not available');
        }
        
        // Listen for detection updates
        const listener = await NativeAR.addListener('detectionUpdate', handleDetectionUpdate);
        cleanup = () => {
          listener.remove();
        };
        
        // Start detection
        await NativeAR.startDetection();
        addLog('Detection started');
        
        setIsLoading(false);
      } catch (err) {
        console.error('Initialization failed:', err);
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
      NativeAR.stopDetection().catch(console.error);
      NativeAR.stopCamera().catch(console.error);
      
      // Restore background
      document.body.style.backgroundColor = originalBodyBg;
      document.documentElement.style.backgroundColor = originalHtmlBg;
    };
  }, [isScanning, addLog]);
  
  // Handle detection updates from native
  const handleDetectionUpdate = useCallback((event: DetectionUpdateEvent) => {
    frameDimensionsRef.current = {
      width: event.frameWidth,
      height: event.frameHeight
    };
    setTrackedObjects(event.objects);
    
    // Check for stable objects to process
    checkStableObjects(event.objects);
    
    // Draw overlay
    drawOverlay(event.objects);
  }, []);
  
  // Check for objects ready for OCR
  const checkStableObjects = useCallback(async (objects: TrackedObject[]) => {
    if (isProcessingRef.current) return;
    
    for (const obj of objects) {
      // Check if stable and not yet processed
      if (
        obj.stabilityScore >= STABILITY_TRIGGER && 
        obj.status === 'detecting' &&
        !processedIdsRef.current.has(obj.id)
      ) {
        isProcessingRef.current = true;
        processedIdsRef.current.add(obj.id);
        addLog('Scanning detected cover...');
        
        try {
          await processObject(obj.id);
        } catch (err) {
          console.error('Processing failed:', err);
        }
        
        isProcessingRef.current = false;
        break; // Process one at a time
      }
    }
  }, [addLog]);
  
  // Process a detected object
  const processObject = async (objectId: string) => {
    try {
      // Crop the object
      const cropResult = await NativeAR.cropObject({ objectId });
      addLog(`Cropped: ${cropResult.width}x${cropResult.height}`);
      
      // OCR with Gemini
      const extractedTitles = await extractTextFromImage(cropResult.imageBase64);
      
      if (!extractedTitles || extractedTitles.length === 0) {
        await NativeAR.updateObjectStatus({
          objectId,
          status: 'failed'
        });
        addLog('No text found');
        return;
      }
      
      const rawTitle = extractedTitles[0];
      addLog(`OCR: "${rawTitle}"`);
      
      // Check cache
      if (titleCacheRef.current.has(rawTitle)) {
        const cached = titleCacheRef.current.get(rawTitle)!;
        await NativeAR.updateObjectStatus({
          objectId,
          status: 'identified',
          title: rawTitle,
          rating: cached.rating
        });
        onTitleFound(rawTitle, cached.rating);
        addLog(`Cache hit: ${rawTitle}`);
        return;
      }
      
      // Fetch movie data
      const movieData = await fetchMovieData(rawTitle);
      
      if (movieData.title) {
        const ratingStr = movieData.rating ? movieData.rating.toString() : 'N/A';
        const votesStr = movieData.votes || '';
        
        // Update cache
        titleCacheRef.current.set(rawTitle, { rating: ratingStr, votes: votesStr });
        
        // Update React Query cache
        queryClient.setQueryData(['movieData', rawTitle], movieData);
        
        // Update object status
        await NativeAR.updateObjectStatus({
          objectId,
          status: 'identified',
          title: movieData.title,
          rating: ratingStr
        });
        
        // Notify parent
        onTitleFound(rawTitle, ratingStr);
        addLog(`Found: ${movieData.title} (${ratingStr})`);
      } else {
        await NativeAR.updateObjectStatus({
          objectId,
          status: 'failed'
        });
        addLog('Movie not found');
      }
    } catch (err) {
      console.error('Processing error:', err);
      await NativeAR.updateObjectStatus({
        objectId,
        status: 'failed'
      });
      addLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };
  
  // Draw AR overlay
  const drawOverlay = useCallback((objects: TrackedObject[]) => {
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
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const { width: frameWidth, height: frameHeight } = frameDimensionsRef.current;
    const scaleX = canvas.width / frameWidth;
    const scaleY = canvas.height / frameHeight;
    
    for (const obj of objects) {
      if (obj.status === 'failed') continue;
      if (obj.confirmationFrames < 3 && obj.status === 'detecting') continue;
      
      // Convert normalized bbox to screen coordinates
      const x = obj.bbox[0] * frameWidth * scaleX;
      const y = obj.bbox[1] * frameHeight * scaleY;
      const w = obj.bbox[2] * frameWidth * scaleX;
      const h = obj.bbox[3] * frameHeight * scaleY;
      
      // Draw bounding box
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = getBoxColor(obj.status);
      
      // Rounded rectangle
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
      
      // Draw label
      if (obj.status === 'identified' && obj.rating) {
        const badgeY = y - 45 < 0 ? y + 10 : y - 45;
        
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        const pillWidth = Math.min(w, 280);
        ctx.beginPath();
        ctx.roundRect(x, badgeY, pillWidth, 40, 6);
        ctx.fill();
        
        // Star
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('★', x + 10, badgeY + 28);
        
        // Rating
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(obj.rating, x + 40, badgeY + 28);
        
        // Title
        let displayTitle = obj.title || '';
        if (displayTitle.length > 18) displayTitle = displayTitle.substring(0, 16) + '...';
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#CCC';
        ctx.fillText(displayTitle, x + 90, badgeY + 28);
        
      } else if (obj.status === 'pending_ocr') {
        // Scanning indicator
        ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
        ctx.beginPath();
        ctx.roundRect(x, y - 32, 130, 28, 6);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('🔍 Scanning...', x + 10, y - 12);
        
      } else if (obj.status === 'detecting') {
        // Progress indicator
        if (obj.stabilityScore > 3) {
          const progress = Math.min(obj.stabilityScore / STABILITY_TRIGGER, 1);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(x, y + h + 4, w * progress, 3);
        }
      }
    }
  }, []);
  
  const getBoxColor = (status: TrackedObject['status']) => {
    switch (status) {
      case 'detecting': return 'rgba(255, 255, 255, 0.7)';
      case 'pending_ocr': return '#60a5fa';
      case 'identified': return '#4ade80';
      case 'failed': return '#f87171';
      default: return 'white';
    }
  };
  
  // Zoom controls
  const handleZoomIn = async () => {
    const newZoom = Math.min(currentZoom + 0.5, maxZoom);
    try {
      const result = await NativeAR.setZoom({ zoom: newZoom });
      setCurrentZoom(result.zoom);
    } catch (err) {
      console.error('Zoom failed:', err);
    }
  };
  
  const handleZoomOut = async () => {
    const newZoom = Math.max(currentZoom - 0.5, 1.0);
    try {
      const result = await NativeAR.setZoom({ zoom: newZoom });
      setCurrentZoom(result.zoom);
    } catch (err) {
      console.error('Zoom failed:', err);
    }
  };
  
  // Handle close
  const handleClose = async () => {
    try {
      await NativeAR.stopDetection();
      await NativeAR.stopCamera();
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
    onClose();
  };
  
  // Continuous overlay rendering
  useEffect(() => {
    let animationFrameId: number;
    
    const renderLoop = () => {
      drawOverlay(trackedObjects);
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    
    if (!isLoading && !error) {
      animationFrameId = requestAnimationFrame(renderLoop);
    }
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isLoading, error, trackedObjects, drawOverlay]);

  return (
    <div className="relative w-full h-full bg-transparent overflow-hidden flex justify-center items-center">
      {/* Native camera preview is behind WebView */}
      {/* AR Overlay Canvas */}
      <canvas 
        ref={canvasRef}
        className="absolute w-full h-full pointer-events-none z-20"
        style={{ background: 'transparent' }}
      />

      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="text-center text-white">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4" />
            <p>Starting AR Camera...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
          <div className="text-center text-white p-4">
            <p className="text-red-400 mb-4">Camera Error</p>
            <p className="text-sm text-gray-400 mb-4">{error}</p>
            <Button onClick={handleClose} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Controls */}
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

      {/* Zoom Controls */}
      {maxZoom > 1 && (
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

      {/* Debug Log */}
      <div className="absolute bottom-20 left-4 z-50 bg-black/60 text-green-400 p-2 rounded text-xs font-mono max-w-[80%] pointer-events-none">
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
      
      {/* Object Count */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
        {trackedObjects.filter(o => o.status === 'identified').length} found
      </div>
    </div>
  );
};
