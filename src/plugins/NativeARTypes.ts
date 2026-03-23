/**
 * Shared types for NativeAR Plugin
 */

export interface TrackedObject {
  id: string;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized 0-1
  stabilityScore: number;
  confirmationFrames: number;
  status: 'detecting' | 'pending_ocr' | 'identified' | 'failed';
  title?: string;
  rating?: string;
}

export interface DetectionUpdateEvent {
  objects: TrackedObject[];
  frameWidth: number;
  frameHeight: number;
}

export interface ZoomInfo {
  zoom: number;
  maxZoom: number;
  minZoom: number;
}

export interface CropResult {
  objectId: string;
  imageBase64: string;
  width: number;
  height: number;
}

export interface NativeARPluginInterface {
  /**
   * Start the native camera preview
   */
  startCamera(): Promise<void>;
  
  /**
   * Stop the camera and release resources
   */
  stopCamera(): Promise<void>;
  
  /**
   * Start object detection
   */
  startDetection(): Promise<void>;
  
  /**
   * Stop object detection
   */
  stopDetection(): Promise<void>;
  
  /**
   * Set zoom level
   */
  setZoom(options: { zoom: number }): Promise<ZoomInfo>;
  
  /**
   * Get current zoom level
   */
  getZoom(): Promise<ZoomInfo>;
  
  /**
   * Crop a detected object and return as Base64
   */
  cropObject(options: { objectId: string }): Promise<CropResult>;
  
  /**
   * Update object status after OCR processing
   */
  updateObjectStatus(options: { 
    objectId: string; 
    status: string; 
    title?: string; 
    rating?: string; 
  }): Promise<void>;
  
  /**
   * Get all tracked objects
   */
  getTrackedObjects(): Promise<{ objects: TrackedObject[] }>;
  
  /**
   * Get objects that are stable enough for OCR
   */
  getStableObjects(): Promise<{ objects: TrackedObject[] }>;
  
  /**
   * Add listener for detection updates
   */
  addListener(
    eventName: 'detectionUpdate',
    listenerFunc: (event: DetectionUpdateEvent) => void
  ): Promise<{ remove: () => void }>;
  
  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;
}
