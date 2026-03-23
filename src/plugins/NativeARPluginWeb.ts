import { WebPlugin } from '@capacitor/core';
import type { 
  NativeARPluginInterface, 
  TrackedObject, 
  DetectionUpdateEvent,
  ZoomInfo,
  CropResult 
} from './NativeARTypes';
import { v4 as uuidv4 } from 'uuid';

/**
 * Web fallback implementation of NativeARPlugin
 * Uses browser APIs for camera and basic detection
 */
export class NativeARPluginWeb extends WebPlugin implements NativeARPluginInterface {
  
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private isDetecting = false;
  private animationFrameId: number | null = null;
  private lastDetectionTime = 0;
  private trackedObjects: Map<string, TrackedObject> = new Map();
  
  // Detection parameters
  private readonly DETECTION_INTERVAL_MS = 100;
  private readonly MIN_ASPECT_RATIO = 1.1;
  private readonly MAX_ASPECT_RATIO = 2.8;
  private readonly MIN_AREA_PERCENT = 0.01;
  private readonly MAX_AREA_PERCENT = 0.6;
  private readonly STABILITY_THRESHOLD = 8;
  private readonly SMOOTHING_FACTOR = 0.3;
  private readonly IOU_THRESHOLD = 0.3;
  private readonly GRACE_PERIOD_MS = 500;
  
  async startCamera(): Promise<void> {
    console.log('[NativeARPluginWeb] Starting camera...');
    
    try {
      // Create hidden video element
      this.videoElement = document.createElement('video');
      this.videoElement.setAttribute('playsinline', 'true');
      this.videoElement.setAttribute('autoplay', 'true');
      this.videoElement.setAttribute('muted', 'true');
      this.videoElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: -1;
      `;
      document.body.appendChild(this.videoElement);
      
      // Create canvas for processing
      this.canvasElement = document.createElement('canvas');
      this.canvasElement.style.display = 'none';
      document.body.appendChild(this.canvasElement);
      
      // Request camera access
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      this.videoElement.srcObject = this.stream;
      
      await new Promise<void>((resolve, reject) => {
        if (this.videoElement) {
          this.videoElement.onloadedmetadata = () => {
            this.videoElement!.play()
              .then(() => resolve())
              .catch(reject);
          };
          this.videoElement.onerror = reject;
        } else {
          reject(new Error('Video element not created'));
        }
      });
      
      console.log('[NativeARPluginWeb] Camera started');
    } catch (error) {
      console.error('[NativeARPluginWeb] Failed to start camera:', error);
      throw error;
    }
  }
  
  async stopCamera(): Promise<void> {
    console.log('[NativeARPluginWeb] Stopping camera...');
    
    this.isDetecting = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement.remove();
      this.videoElement = null;
    }
    
    if (this.canvasElement) {
      this.canvasElement.remove();
      this.canvasElement = null;
    }
    
    this.trackedObjects.clear();
  }
  
  async startDetection(): Promise<void> {
    console.log('[NativeARPluginWeb] Starting detection...');
    this.isDetecting = true;
    this.trackedObjects.clear();
    this.runDetectionLoop();
  }
  
  async stopDetection(): Promise<void> {
    console.log('[NativeARPluginWeb] Stopping detection...');
    this.isDetecting = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  private runDetectionLoop = () => {
    if (!this.isDetecting) return;
    
    const now = Date.now();
    
    if (now - this.lastDetectionTime >= this.DETECTION_INTERVAL_MS) {
      this.lastDetectionTime = now;
      this.detectObjects();
    }
    
    this.animationFrameId = requestAnimationFrame(this.runDetectionLoop);
  };
  
  private detectObjects() {
    if (!this.videoElement || !this.canvasElement) return;
    if (this.videoElement.readyState !== 4) return;
    
    const video = this.videoElement;
    const canvas = this.canvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Match canvas size to video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw current frame
    ctx.drawImage(video, 0, 0);
    
    // Simple edge-based detection (placeholder for real ML)
    const detections = this.simpleDetection(ctx, canvas.width, canvas.height);
    
    // Update tracking
    this.updateTracking(detections);
    
    // Notify listeners
    this.notifyListeners('detectionUpdate', {
      objects: Array.from(this.trackedObjects.values())
        .filter(obj => obj.confirmationFrames >= 3),
      frameWidth: canvas.width,
      frameHeight: canvas.height
    } as DetectionUpdateEvent);
  }
  
  private simpleDetection(
    ctx: CanvasRenderingContext2D, 
    width: number, 
    height: number
  ): Array<{ bbox: [number, number, number, number]; confidence: number }> {
    const detections: Array<{ bbox: [number, number, number, number]; confidence: number }> = [];
    const area = width * height;
    
    // Grid-based detection simulation
    const gridSize = 4;
    const cellWidth = width / gridSize;
    const cellHeight = height / gridSize;
    
    for (let gx = 0; gx < gridSize - 1; gx++) {
      for (let gy = 0; gy < gridSize - 1; gy++) {
        const x = gx * cellWidth;
        const y = gy * cellHeight;
        const w = cellWidth * 2;
        const h = cellHeight * 2;
        
        // Check aspect ratio
        const aspectRatio = h / w;
        if (aspectRatio < this.MIN_ASPECT_RATIO || aspectRatio > this.MAX_ASPECT_RATIO) {
          continue;
        }
        
        // Check area
        const areaPercent = (w * h) / area;
        if (areaPercent < this.MIN_AREA_PERCENT || areaPercent > this.MAX_AREA_PERCENT) {
          continue;
        }
        
        // Calculate contrast
        const contrast = this.calculateContrast(ctx, x, y, w, h);
        if (contrast > 30) {
          detections.push({
            bbox: [x / width, y / height, w / width, h / height],
            confidence: Math.min(contrast / 100, 1.0)
          });
        }
      }
    }
    
    // Non-maximum suppression
    return this.nonMaxSuppression(detections, 0.5);
  }
  
  private calculateContrast(
    ctx: CanvasRenderingContext2D, 
    x: number, y: number, 
    w: number, h: number
  ): number {
    try {
      const imageData = ctx.getImageData(
        Math.floor(x), 
        Math.floor(y), 
        Math.floor(w), 
        Math.floor(h)
      );
      const data = imageData.data;
      
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      
      // Sample every 10th pixel for performance
      for (let i = 0; i < data.length; i += 40) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += gray;
        sumSq += gray * gray;
        count++;
      }
      
      if (count === 0) return 0;
      
      const mean = sum / count;
      const variance = (sumSq / count) - (mean * mean);
      return Math.sqrt(variance);
    } catch {
      return 0;
    }
  }
  
  private nonMaxSuppression(
    detections: Array<{ bbox: [number, number, number, number]; confidence: number }>,
    threshold: number
  ): Array<{ bbox: [number, number, number, number]; confidence: number }> {
    const result: Array<{ bbox: [number, number, number, number]; confidence: number }> = [];
    const suppressed = new Set<number>();
    
    // Sort by confidence (descending)
    detections.sort((a, b) => b.confidence - a.confidence);
    
    for (let i = 0; i < detections.length; i++) {
      if (suppressed.has(i)) continue;
      
      result.push(detections[i]);
      
      for (let j = i + 1; j < detections.length; j++) {
        if (suppressed.has(j)) continue;
        
        const iou = this.calculateIoU(detections[i].bbox, detections[j].bbox);
        if (iou > threshold) {
          suppressed.add(j);
        }
      }
    }
    
    return result;
  }
  
  private calculateIoU(
    box1: [number, number, number, number], 
    box2: [number, number, number, number]
  ): number {
    const x1 = Math.max(box1[0], box2[0]);
    const y1 = Math.max(box1[1], box2[1]);
    const x2 = Math.min(box1[0] + box1[2], box2[0] + box2[2]);
    const y2 = Math.min(box1[1] + box1[3], box2[1] + box2[3]);
    
    const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const box1Area = box1[2] * box1[3];
    const box2Area = box2[2] * box2[3];
    const unionArea = box1Area + box2Area - interArea;
    
    return unionArea > 0 ? interArea / unionArea : 0;
  }
  
  private updateTracking(
    detections: Array<{ bbox: [number, number, number, number]; confidence: number }>
  ) {
    const now = Date.now();
    const newTrackedObjects = new Map<string, TrackedObject>();
    const usedDetections = new Set<number>();
    
    // Match existing objects
    for (const obj of this.trackedObjects.values()) {
      let bestMatch = -1;
      let bestIoU = 0;
      
      for (let i = 0; i < detections.length; i++) {
        if (usedDetections.has(i)) continue;
        
        const iou = this.calculateIoU(obj.bbox, detections[i].bbox);
        if (iou > this.IOU_THRESHOLD && iou > bestIoU) {
          bestIoU = iou;
          bestMatch = i;
        }
      }
      
      if (bestMatch >= 0) {
        const det = detections[bestMatch];
        usedDetections.add(bestMatch);
        
        // Smooth update
        const smoothedBbox: [number, number, number, number] = [
          obj.bbox[0] + (det.bbox[0] - obj.bbox[0]) * this.SMOOTHING_FACTOR,
          obj.bbox[1] + (det.bbox[1] - obj.bbox[1]) * this.SMOOTHING_FACTOR,
          obj.bbox[2] + (det.bbox[2] - obj.bbox[2]) * this.SMOOTHING_FACTOR,
          obj.bbox[3] + (det.bbox[3] - obj.bbox[3]) * this.SMOOTHING_FACTOR,
        ];
        
        newTrackedObjects.set(obj.id, {
          ...obj,
          bbox: smoothedBbox,
          stabilityScore: obj.stabilityScore + 1,
          confirmationFrames: obj.confirmationFrames + 1
        });
      } else {
        // Object lost - keep in grace period
        if (now - Date.now() < this.GRACE_PERIOD_MS) {
          newTrackedObjects.set(obj.id, {
            ...obj,
            confirmationFrames: Math.max(0, obj.confirmationFrames - 1)
          });
        }
      }
    }
    
    // Add new objects
    for (let i = 0; i < detections.length; i++) {
      if (usedDetections.has(i)) continue;
      
      const id = uuidv4();
      newTrackedObjects.set(id, {
        id,
        bbox: detections[i].bbox,
        stabilityScore: 0,
        confirmationFrames: 1,
        status: 'detecting'
      });
    }
    
    this.trackedObjects = newTrackedObjects;
  }
  
  async setZoom(_options: { zoom: number }): Promise<ZoomInfo> {
    // Web API has limited zoom support
    console.warn('[NativeARPluginWeb] Zoom not fully supported in web mode');
    return {
      zoom: 1.0,
      maxZoom: 1.0,
      minZoom: 1.0
    };
  }
  
  async getZoom(): Promise<ZoomInfo> {
    return {
      zoom: 1.0,
      maxZoom: 1.0,
      minZoom: 1.0
    };
  }
  
  async cropObject(options: { objectId: string }): Promise<CropResult> {
    if (!this.videoElement) {
      throw new Error('Camera not initialized');
    }
    
    const video = this.videoElement;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    
    // Special case: full frame capture
    if (options.objectId === '__fullframe__') {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
      return {
        objectId: '__fullframe__',
        imageBase64,
        width: video.videoWidth,
        height: video.videoHeight
      };
    }
    
    // Normal object crop
    const obj = this.trackedObjects.get(options.objectId);
    if (!obj) {
      throw new Error('Object not found');
    }
    
    // Convert normalized bbox to pixel coordinates
    const x = obj.bbox[0] * video.videoWidth;
    const y = obj.bbox[1] * video.videoHeight;
    const w = obj.bbox[2] * video.videoWidth;
    const h = obj.bbox[3] * video.videoHeight;
    
    canvas.width = w;
    canvas.height = h;
    
    ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
    
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);
    
    // Update status
    obj.status = 'pending_ocr';
    this.trackedObjects.set(options.objectId, obj);
    
    return {
      objectId: options.objectId,
      imageBase64,
      width: Math.floor(w),
      height: Math.floor(h)
    };
  }
  
  async updateObjectStatus(options: { 
    objectId: string; 
    status: string; 
    title?: string; 
    rating?: string;
  }): Promise<void> {
    const obj = this.trackedObjects.get(options.objectId);
    if (!obj) {
      throw new Error('Object not found');
    }
    
    obj.status = options.status as TrackedObject['status'];
    if (options.title) obj.title = options.title;
    if (options.rating) obj.rating = options.rating;
    
    this.trackedObjects.set(options.objectId, obj);
  }
  
  async getTrackedObjects(): Promise<{ objects: TrackedObject[] }> {
    return {
      objects: Array.from(this.trackedObjects.values())
    };
  }
  
  async getStableObjects(): Promise<{ objects: TrackedObject[] }> {
    return {
      objects: Array.from(this.trackedObjects.values())
        .filter(obj => 
          obj.stabilityScore >= this.STABILITY_THRESHOLD && 
          obj.status === 'detecting'
        )
    };
  }
}
