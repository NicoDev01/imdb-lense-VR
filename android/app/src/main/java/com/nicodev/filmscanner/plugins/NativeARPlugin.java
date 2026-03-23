package com.nicodev.filmscanner.plugins;

import android.Manifest;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.util.Base64;
import android.util.Log;
import android.util.Size;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native AR Plugin for Film Scanner
 * 
 * Provides:
 * - CameraX integration with zoom/focus control
 * - ML Kit object detection (poster/cover detection)
 * - Kalman filter tracking
 * - Frame cropping and Base64 encoding
 */
@CapacitorPlugin(
    name = "NativeAR",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
public class NativeARPlugin extends Plugin {
    
    private static final String TAG = "NativeARPlugin";
    
    // Camera components
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private PreviewView previewView;
    private ImageAnalysis imageAnalysis;
    private ExecutorService cameraExecutor;
    private TextRecognizer textRecognizer;
    
    // Detection state
    private boolean isDetecting = false;
    private long lastDetectionTime = 0;
    private static final long DETECTION_INTERVAL_MS = 80; // ~12.5 FPS
    
    // Tracking state (Kalman-like smoothing)
    private Map<String, TrackedObject> trackedObjects = new HashMap<>();
    private static final float SMOOTHING_FACTOR = 0.3f;
    private static final int STABILITY_THRESHOLD = 8;
    private static final float IOU_THRESHOLD = 0.3f;
    private static final long GRACE_PERIOD_MS = 500;
    
    // Detection parameters
    private static final float MIN_CONFIDENCE = 0.25f;
    private static final float MIN_ASPECT_RATIO = 1.1f;
    private static final float MAX_ASPECT_RATIO = 2.8f;
    private static final float MIN_AREA_PERCENT = 0.005f;
    private static final float MAX_AREA_PERCENT = 0.6f;
    
    // Current zoom level
    private float currentZoom = 1.0f;
    
    // Last captured frame for cropping
    private Bitmap lastFrame;
    private int frameWidth = 0;
    private int frameHeight = 0;
    
    /**
     * Tracked object data class
     */
    private static class TrackedObject {
        String id;
        float[] bbox; // [x, y, width, height] normalized 0-1
        float[] smoothedBbox;
        long lastSeen;
        int stabilityScore;
        int confirmationFrames;
        String status; // "detecting", "pending_ocr", "identified", "failed"
        String title;
        String rating;
        
        // Kalman-like velocity estimates
        float[] velocity = new float[4];
        
        TrackedObject(String id, float[] bbox) {
            this.id = id;
            this.bbox = bbox.clone();
            this.smoothedBbox = bbox.clone();
            this.lastSeen = System.currentTimeMillis();
            this.stabilityScore = 0;
            this.confirmationFrames = 1;
            this.status = "detecting";
        }
        
        void update(float[] newBbox, float smoothingFactor) {
            // Simple Kalman-like smoothing
            for (int i = 0; i < 4; i++) {
                float predicted = smoothedBbox[i] + velocity[i];
                float innovation = newBbox[i] - predicted;
                smoothedBbox[i] = predicted + smoothingFactor * innovation;
                velocity[i] = 0.5f * velocity[i] + 0.5f * (newBbox[i] - bbox[i]);
            }
            this.bbox = newBbox.clone();
            this.lastSeen = System.currentTimeMillis();
            this.stabilityScore++;
            this.confirmationFrames++;
        }
        
        void predict() {
            // Predict position when object is temporarily lost
            for (int i = 0; i < 4; i++) {
                smoothedBbox[i] += velocity[i] * 0.5f;
            }
        }
        
        JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("id", id);
            
            JSArray bboxArray = new JSArray();
            try {
                bboxArray.put(smoothedBbox[0]);
                bboxArray.put(smoothedBbox[1]);
                bboxArray.put(smoothedBbox[2]);
                bboxArray.put(smoothedBbox[3]);
            } catch (JSONException e) {
                Log.e(TAG, "Error creating bbox array", e);
            }
            obj.put("bbox", bboxArray);
            
            obj.put("stabilityScore", stabilityScore);
            obj.put("confirmationFrames", confirmationFrames);
            obj.put("status", status);
            if (title != null) obj.put("title", title);
            if (rating != null) obj.put("rating", rating);
            return obj;
        }
    }
    
    @Override
    public void load() {
        super.load();
        cameraExecutor = Executors.newSingleThreadExecutor();
        
        // Initialize ML Kit Text Recognizer
        textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        
        Log.d(TAG, "NativeARPlugin loaded with ML Kit Text Recognition");
    }
    
    /**
     * Start the camera preview
     */
    @PluginMethod
    public void startCamera(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                // Create preview view
                previewView = new PreviewView(getContext());
                previewView.setLayoutParams(new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                
                // Add to WebView's parent
                ViewGroup webViewParent = (ViewGroup) getBridge().getWebView().getParent();
                webViewParent.addView(previewView, 0); // Add behind WebView
                
                // Make WebView transparent
                getBridge().getWebView().setBackgroundColor(0x00000000);
                
                // Start camera
                startCameraInternal();
                
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start camera", e);
                call.reject("Failed to start camera: " + e.getMessage());
            }
        });
    }
    
    private void startCameraInternal() {
        Context context = getContext();
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture = 
            ProcessCameraProvider.getInstance(context);
        
        cameraProviderFuture.addListener(() -> {
            try {
                cameraProvider = cameraProviderFuture.get();
                bindCameraUseCases();
            } catch (ExecutionException | InterruptedException e) {
                Log.e(TAG, "Camera provider initialization failed", e);
            }
        }, ContextCompat.getMainExecutor(context));
    }
    
    private void bindCameraUseCases() {
        if (cameraProvider == null) return;
        
        // Unbind all existing use cases
        cameraProvider.unbindAll();
        
        // Camera selector (back camera)
        CameraSelector cameraSelector = new CameraSelector.Builder()
            .requireLensFacing(CameraSelector.LENS_FACING_BACK)
            .build();
        
        // Preview
        Preview preview = new Preview.Builder()
            .setTargetResolution(new Size(1280, 720))
            .build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        
        // Image Analysis for frame processing
        imageAnalysis = new ImageAnalysis.Builder()
            .setTargetResolution(new Size(1280, 720))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        
        imageAnalysis.setAnalyzer(cameraExecutor, this::analyzeFrame);
        
        // Bind use cases to lifecycle
        try {
            camera = cameraProvider.bindToLifecycle(
                (LifecycleOwner) getActivity(),
                cameraSelector,
                preview,
                imageAnalysis
            );
            
            Log.d(TAG, "Camera use cases bound successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to bind camera use cases", e);
        }
    }
    
    /**
     * Analyze each camera frame
     */
    @androidx.annotation.OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void analyzeFrame(@NonNull ImageProxy imageProxy) {
        long now = System.currentTimeMillis();
        
        // Always capture frame for full-frame capture support
        // Even when not detecting, keep updating lastFrame
        android.media.Image mediaImage = imageProxy.getImage();
        if (mediaImage != null) {
            try {
                // Update lastFrame more frequently for full-frame capture
                if (lastFrame == null || now - lastDetectionTime > 500) {
                    Bitmap newFrame = imageProxyToBitmap(imageProxy);
                    if (newFrame != null) {
                        lastFrame = newFrame;
                        frameWidth = lastFrame.getWidth();
                        frameHeight = lastFrame.getHeight();
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Frame capture failed", e);
            }
        }
        
        // Throttle detection
        if (now - lastDetectionTime < DETECTION_INTERVAL_MS || !isDetecting) {
            imageProxy.close();
            return;
        }
        lastDetectionTime = now;
        
        if (mediaImage == null) {
            imageProxy.close();
            return;
        }

        try {
            InputImage image = InputImage.fromMediaImage(mediaImage, imageProxy.getImageInfo().getRotationDegrees());
            
            textRecognizer.process(image)
                .addOnSuccessListener(text -> {
                    List<float[]> detections = new ArrayList<>();
                    int width = imageProxy.getWidth(); 
                    int height = imageProxy.getHeight();
                    
                    // Adjust for rotation
                    int rotation = imageProxy.getImageInfo().getRotationDegrees();
                    if (rotation == 90 || rotation == 270) {
                        width = imageProxy.getHeight();
                        height = imageProxy.getWidth();
                    }

                    // Group text blocks into potential movie covers
                    // Strategy: Find text blocks, expand them slightly to capture context (poster art)
                    for (Text.TextBlock block : text.getTextBlocks()) {
                        Rect boundingBox = block.getBoundingBox();
                        if (boundingBox == null) continue;
                        
                        // Filter out very small text (noise)
                        if (boundingBox.height() < height * 0.02) continue;
                        
                        // Expand box to capture surrounding poster art
                        // Posters usually have text in the middle or bottom, so we expand mostly up and down
                        int cx = boundingBox.centerX();
                        int cy = boundingBox.centerY();
                        int w = (int) (boundingBox.width() * 1.5f); // Expand width a bit
                        int h = (int) (boundingBox.height() * 3.0f); // Expand height significantly to get the poster
                        
                        // Ensure we don't go out of bounds
                        int left = Math.max(0, cx - w/2);
                        int top = Math.max(0, cy - h/2);
                        int right = Math.min(width, cx + w/2);
                        int bottom = Math.min(height, cy + h/2);
                        
                        // Normalize coordinates 0-1
                        float nx = (float) left / width;
                        float ny = (float) top / height;
                        float nw = (float) (right - left) / width;
                        float nh = (float) (bottom - top) / height;
                        
                        // Confidence is not provided by TextRecognizer for blocks, assume high if text is found
                        detections.add(new float[]{nx, ny, nw, nh, 0.9f});
                    }
                    
                    // Merge overlapping detections to avoid multiple boxes for one poster
                    detections = nonMaxSuppression(detections, 0.3f);
                    
                    if (!detections.isEmpty()) {
                        updateTracking(detections);
                        notifyDetections();
                    }
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "ML Kit text recognition failed", e);
                })
                .addOnCompleteListener(task -> {
                    imageProxy.close();
                });
                
        } catch (Exception e) {
            Log.e(TAG, "Frame analysis failed", e);
            imageProxy.close();
        }
    }
    
    /**
     * Convert ImageProxy to Bitmap
     */
    private Bitmap imageProxyToBitmap(ImageProxy image) {
        try {
            ImageProxy.PlaneProxy[] planes = image.getPlanes();
            ByteBuffer yBuffer = planes[0].getBuffer();
            ByteBuffer uBuffer = planes[1].getBuffer();
            ByteBuffer vBuffer = planes[2].getBuffer();
            
            int ySize = yBuffer.remaining();
            int uSize = uBuffer.remaining();
            int vSize = vBuffer.remaining();
            
            byte[] nv21 = new byte[ySize + uSize + vSize];
            yBuffer.get(nv21, 0, ySize);
            vBuffer.get(nv21, ySize, vSize);
            uBuffer.get(nv21, ySize + vSize, uSize);
            
            YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, 
                image.getWidth(), image.getHeight(), null);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, 
                image.getWidth(), image.getHeight()), 80, out);
            
            byte[] imageBytes = out.toByteArray();
            Bitmap bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
            
            // Rotate if needed
            int rotation = image.getImageInfo().getRotationDegrees();
            if (rotation != 0) {
                Matrix matrix = new Matrix();
                matrix.postRotate(rotation);
                bitmap = Bitmap.createBitmap(bitmap, 0, 0, 
                    bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            }
            
            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "Failed to convert ImageProxy to Bitmap", e);
            return null;
        }
    }
    
    /**
     * Simple detection using edge/contrast analysis and aspect ratio filtering
     * In production, this would use a TFLite model
     */
    private List<float[]> detectPotentialCovers(Bitmap bitmap) {
        List<float[]> detections = new ArrayList<>();
        
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        float area = width * height;
        
        // Simple grid-based detection simulation
        // In production, replace with TFLite model inference
        // This is a placeholder that looks for high-contrast rectangular regions
        
        int gridSize = 4;
        int cellWidth = width / gridSize;
        int cellHeight = height / gridSize;
        
        for (int gx = 0; gx < gridSize - 1; gx++) {
            for (int gy = 0; gy < gridSize - 1; gy++) {
                int x = gx * cellWidth;
                int y = gy * cellHeight;
                int w = cellWidth * 2;
                int h = cellHeight * 2;
                
                // Check aspect ratio
                float aspectRatio = (float) h / w;
                if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
                    continue;
                }
                
                // Check area
                float areaPercent = (w * h) / area;
                if (areaPercent < MIN_AREA_PERCENT || areaPercent > MAX_AREA_PERCENT) {
                    continue;
                }
                
                // Calculate contrast in this region
                float contrast = calculateContrast(bitmap, x, y, w, h);
                if (contrast > 30) { // Threshold for potential cover
                    // Normalize to 0-1
                    detections.add(new float[]{
                        (float) x / width,
                        (float) y / height,
                        (float) w / width,
                        (float) h / height,
                        Math.min(contrast / 100f, 1.0f) // confidence
                    });
                }
            }
        }
        
        // Non-maximum suppression
        return nonMaxSuppression(detections, 0.5f);
    }
    
    private float calculateContrast(Bitmap bitmap, int x, int y, int w, int h) {
        int sampleSize = 10;
        int stepX = Math.max(1, w / sampleSize);
        int stepY = Math.max(1, h / sampleSize);
        
        float sum = 0;
        float sumSq = 0;
        int count = 0;
        
        for (int px = x; px < x + w && px < bitmap.getWidth(); px += stepX) {
            for (int py = y; py < y + h && py < bitmap.getHeight(); py += stepY) {
                int pixel = bitmap.getPixel(px, py);
                float gray = 0.299f * ((pixel >> 16) & 0xFF) + 
                             0.587f * ((pixel >> 8) & 0xFF) + 
                             0.114f * (pixel & 0xFF);
                sum += gray;
                sumSq += gray * gray;
                count++;
            }
        }
        
        if (count == 0) return 0;
        
        float mean = sum / count;
        float variance = (sumSq / count) - (mean * mean);
        return (float) Math.sqrt(variance);
    }
    
    private List<float[]> nonMaxSuppression(List<float[]> detections, float threshold) {
        List<float[]> result = new ArrayList<>();
        boolean[] suppressed = new boolean[detections.size()];
        
        // Sort by confidence (descending)
        detections.sort((a, b) -> Float.compare(b[4], a[4]));
        
        for (int i = 0; i < detections.size(); i++) {
            if (suppressed[i]) continue;
            
            result.add(detections.get(i));
            
            for (int j = i + 1; j < detections.size(); j++) {
                if (suppressed[j]) continue;
                
                float iou = calculateIoU(detections.get(i), detections.get(j));
                if (iou > threshold) {
                    suppressed[j] = true;
                }
            }
        }
        
        return result;
    }
    
    private float calculateIoU(float[] box1, float[] box2) {
        float x1 = Math.max(box1[0], box2[0]);
        float y1 = Math.max(box1[1], box2[1]);
        float x2 = Math.min(box1[0] + box1[2], box2[0] + box2[2]);
        float y2 = Math.min(box1[1] + box1[3], box2[1] + box2[3]);
        
        float interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        float box1Area = box1[2] * box1[3];
        float box2Area = box2[2] * box2[3];
        float unionArea = box1Area + box2Area - interArea;
        
        return unionArea > 0 ? interArea / unionArea : 0;
    }
    
    /**
     * Update object tracking with new detections
     */
    private void updateTracking(List<float[]> detections) {
        long now = System.currentTimeMillis();
        Map<String, TrackedObject> newTrackedObjects = new HashMap<>();
        boolean[] usedDetections = new boolean[detections.size()];
        
        // Match existing objects to new detections
        for (TrackedObject obj : trackedObjects.values()) {
            int bestMatch = -1;
            float bestIoU = 0;
            
            for (int i = 0; i < detections.size(); i++) {
                if (usedDetections[i]) continue;
                
                float iou = calculateIoU(obj.bbox, detections.get(i));
                if (iou > IOU_THRESHOLD && iou > bestIoU) {
                    bestIoU = iou;
                    bestMatch = i;
                }
            }
            
            if (bestMatch >= 0) {
                // Update existing object
                float[] det = detections.get(bestMatch);
                obj.update(new float[]{det[0], det[1], det[2], det[3]}, SMOOTHING_FACTOR);
                usedDetections[bestMatch] = true;
                newTrackedObjects.put(obj.id, obj);
            } else {
                // Object lost - keep in grace period
                if (now - obj.lastSeen < GRACE_PERIOD_MS) {
                    obj.predict();
                    obj.confirmationFrames = Math.max(0, obj.confirmationFrames - 1);
                    newTrackedObjects.put(obj.id, obj);
                }
            }
        }
        
        // Add new objects
        for (int i = 0; i < detections.size(); i++) {
            if (!usedDetections[i]) {
                float[] det = detections.get(i);
                String id = UUID.randomUUID().toString();
                TrackedObject newObj = new TrackedObject(id, 
                    new float[]{det[0], det[1], det[2], det[3]});
                newTrackedObjects.put(id, newObj);
            }
        }
        
        trackedObjects = newTrackedObjects;
    }
    
    /**
     * Notify JavaScript about current detections
     */
    private void notifyDetections() {
        JSObject result = new JSObject();
        JSArray objects = new JSArray();
        
        for (TrackedObject obj : trackedObjects.values()) {
            if (obj.confirmationFrames >= 3) { // Only show confirmed objects
                objects.put(obj.toJSObject());
            }
        }
        
        result.put("objects", objects);
        result.put("frameWidth", frameWidth);
        result.put("frameHeight", frameHeight);
        
        notifyListeners("detectionUpdate", result);
    }
    
    /**
     * Start detection
     */
    @PluginMethod
    public void startDetection(PluginCall call) {
        isDetecting = true;
        trackedObjects.clear();
        call.resolve();
        Log.d(TAG, "Detection started");
    }
    
    /**
     * Stop detection
     */
    @PluginMethod
    public void stopDetection(PluginCall call) {
        isDetecting = false;
        call.resolve();
        Log.d(TAG, "Detection stopped");
    }
    
    /**
     * Stop camera
     */
    @PluginMethod
    public void stopCamera(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                isDetecting = false;
                
                if (cameraProvider != null) {
                    cameraProvider.unbindAll();
                }
                
                if (previewView != null) {
                    ViewGroup parent = (ViewGroup) previewView.getParent();
                    if (parent != null) {
                        parent.removeView(previewView);
                    }
                    previewView = null;
                }
                
                trackedObjects.clear();
                lastFrame = null;
                
                call.resolve();
                Log.d(TAG, "Camera stopped");
            } catch (Exception e) {
                Log.e(TAG, "Failed to stop camera", e);
                call.reject("Failed to stop camera: " + e.getMessage());
            }
        });
    }
    
    /**
     * Set zoom level (1.0 = no zoom)
     */
    @PluginMethod
    public void setZoom(PluginCall call) {
        float zoom = call.getFloat("zoom", 1.0f);
        
        if (camera != null) {
            float maxZoom = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
            float minZoom = camera.getCameraInfo().getZoomState().getValue().getMinZoomRatio();
            
            currentZoom = Math.max(minZoom, Math.min(zoom, maxZoom));
            camera.getCameraControl().setZoomRatio(currentZoom);
            
            JSObject result = new JSObject();
            result.put("zoom", currentZoom);
            result.put("maxZoom", maxZoom);
            result.put("minZoom", minZoom);
            call.resolve(result);
        } else {
            call.reject("Camera not initialized");
        }
    }
    
    /**
     * Get current zoom level
     */
    @PluginMethod
    public void getZoom(PluginCall call) {
        if (camera != null) {
            float maxZoom = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
            float minZoom = camera.getCameraInfo().getZoomState().getValue().getMinZoomRatio();
            
            JSObject result = new JSObject();
            result.put("zoom", currentZoom);
            result.put("maxZoom", maxZoom);
            result.put("minZoom", minZoom);
            call.resolve(result);
        } else {
            call.reject("Camera not initialized");
        }
    }
    
    /**
     * Crop a detected object and return as Base64
     * Special case: objectId "__fullframe__" returns the full frame
     */
    @PluginMethod
    public void cropObject(PluginCall call) {
        String objectId = call.getString("objectId");
        
        if (objectId == null) {
            call.reject("ObjectId required");
            return;
        }
        
        // Special case: full frame capture for Gemini Vision analysis
        if ("__fullframe__".equals(objectId)) {
            if (lastFrame == null) {
                call.reject("No frame available");
                return;
            }
            
            try {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                lastFrame.compress(Bitmap.CompressFormat.JPEG, 80, baos);
                byte[] imageBytes = baos.toByteArray();
                String base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
                
                JSObject result = new JSObject();
                result.put("objectId", "__fullframe__");
                result.put("imageBase64", "data:image/jpeg;base64," + base64);
                result.put("width", lastFrame.getWidth());
                result.put("height", lastFrame.getHeight());
                call.resolve(result);
                return;
            } catch (Exception e) {
                Log.e(TAG, "Failed to capture full frame", e);
                call.reject("Failed to capture full frame: " + e.getMessage());
                return;
            }
        }
        
        // Normal object crop
        if (!trackedObjects.containsKey(objectId)) {
            call.reject("Object not found");
            return;
        }
        
        if (lastFrame == null) {
            call.reject("No frame available");
            return;
        }
        
        TrackedObject obj = trackedObjects.get(objectId);
        
        try {
            // Convert normalized bbox to pixel coordinates
            int x = (int) (obj.smoothedBbox[0] * lastFrame.getWidth());
            int y = (int) (obj.smoothedBbox[1] * lastFrame.getHeight());
            int w = (int) (obj.smoothedBbox[2] * lastFrame.getWidth());
            int h = (int) (obj.smoothedBbox[3] * lastFrame.getHeight());
            
            // Clamp to image bounds
            x = Math.max(0, Math.min(x, lastFrame.getWidth() - 1));
            y = Math.max(0, Math.min(y, lastFrame.getHeight() - 1));
            w = Math.min(w, lastFrame.getWidth() - x);
            h = Math.min(h, lastFrame.getHeight() - y);
            
            if (w <= 0 || h <= 0) {
                call.reject("Invalid crop dimensions");
                return;
            }
            
            // Crop bitmap
            Bitmap cropped = Bitmap.createBitmap(lastFrame, x, y, w, h);
            
            // Convert to Base64
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, 85, baos);
            byte[] imageBytes = baos.toByteArray();
            String base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
            
            // Mark as pending OCR
            obj.status = "pending_ocr";
            
            JSObject result = new JSObject();
            result.put("objectId", objectId);
            result.put("imageBase64", "data:image/jpeg;base64," + base64);
            result.put("width", w);
            result.put("height", h);
            call.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to crop object", e);
            call.reject("Failed to crop object: " + e.getMessage());
        }
    }
    
    /**
     * Update object status after processing
     */
    @PluginMethod
    public void updateObjectStatus(PluginCall call) {
        String objectId = call.getString("objectId");
        String status = call.getString("status");
        String title = call.getString("title");
        String rating = call.getString("rating");
        
        if (objectId == null || !trackedObjects.containsKey(objectId)) {
            call.reject("Object not found");
            return;
        }
        
        TrackedObject obj = trackedObjects.get(objectId);
        obj.status = status != null ? status : obj.status;
        obj.title = title;
        obj.rating = rating;
        
        call.resolve();
    }
    
    /**
     * Get all tracked objects
     */
    @PluginMethod
    public void getTrackedObjects(PluginCall call) {
        JSObject result = new JSObject();
        JSArray objects = new JSArray();
        
        for (TrackedObject obj : trackedObjects.values()) {
            objects.put(obj.toJSObject());
        }
        
        result.put("objects", objects);
        call.resolve(result);
    }
    
    /**
     * Get stable objects ready for OCR
     */
    @PluginMethod
    public void getStableObjects(PluginCall call) {
        JSObject result = new JSObject();
        JSArray objects = new JSArray();
        
        for (TrackedObject obj : trackedObjects.values()) {
            if (obj.stabilityScore >= STABILITY_THRESHOLD && 
                "detecting".equals(obj.status)) {
                objects.put(obj.toJSObject());
            }
        }
        
        result.put("objects", objects);
        call.resolve(result);
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
        }
        
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
        }
    }
}
