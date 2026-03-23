# 🚀 AR Film Scanner - Architektur-Dokumentation (v2.0)

## 📋 Executive Summary

Diese App ist eine **Augmented Reality Film Scanner App** die DVD/Blu-ray Cover in Echtzeit erkennt, den Filmtitel extrahiert und IMDb-Bewertungen anzeigt.

**Neue Architektur (v2.0)** basiert auf:
- **Native CameraX** für volle Kamera-Kontrolle (Zoom, Fokus)
- **On-Device Detection** mit Tracking (Kalman-Filter)
- **Capacitor Native Plugin** für Bridge zwischen Native und Web
- **Gemini Vision API** für OCR
- **TMDB/OMDb** für Film-Daten

---

## 🔧 Technologie-Stack

### Der komplette Flow:
```
┌─────────────────────────────────────────────────────────────────┐
│  📱 Native Layer (Android/Kotlin/Java)                          │
├─────────────────────────────────────────────────────────────────┤
│  1. CameraX       │  Native Kamera mit Zoom/Fokus-Kontrolle     │
│  2. Detection     │  Contrast-based Detection (→TFLite geplant) │
│  3. Tracking      │  Kalman-Filter mit Velocity Smoothing       │
│  4. Crop          │  Native Bitmap-Verarbeitung                 │
└────────┬────────────────────────────────────────────────────────┘
         │ Capacitor Bridge (NativeARPlugin)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  🌐 Web Layer (TypeScript/React)                                 │
├─────────────────────────────────────────────────────────────────┤
│  5. OCR           │  Gemini Vision API (gemini-2.5-flash-lite)  │
│  6. Film-Daten    │  TMDB API → OMDb API (IMDb Ratings)         │
│  7. AR Overlay    │  Canvas 2D (Bounding Boxes + Rating Badges) │
│  8. UI            │  React + Shadcn/UI + Tailwind               │
└─────────────────────────────────────────────────────────────────┘
```

### Verwendete Technologien:

| Layer | Technologie | Beschreibung |
|-------|-------------|--------------|
| Camera | CameraX 1.3.1 | Native Android Kamera API |
| Detection | Custom (Contrast-based) | On-device Detection |
| Tracking | Kalman Filter | Smooth Tracking mit Velocity |
| Bridge | Capacitor Plugin | Native ↔ Web Kommunikation |
| OCR | Gemini Vision API | Cloud-basierte Text-Erkennung |
| Film-Daten | TMDB + OMDb | Metadaten + IMDb Ratings |
| UI Framework | React 18 + Vite | Frontend |

---

## 📁 Projekt-Struktur

```
src/
├── components/
│   └── ARScanner.tsx          # Haupt AR-Scanner Komponente
├── plugins/
│   ├── NativeARPlugin.ts      # TypeScript Plugin Interface
│   └── NativeARPluginWeb.ts   # Web Fallback Implementation
├── services/
│   ├── ocrService.ts          # Gemini Vision OCR
│   ├── movieService.ts        # Film-Daten Aggregation
│   ├── tmdbService.ts         # TMDB API Client
│   └── omdbService.ts         # OMDb API Client
└── pages/
    └── Index.tsx              # Haupt-Seite

android/app/src/main/java/com/nicodev/filmscanner/
├── MainActivity.java          # Plugin Registration
└── plugins/
    └── NativeARPlugin.java    # Native Camera + Detection Plugin
```

---

## 🎯 Native AR Plugin Features

### NativeARPlugin.java

**Funktionen:**
- `startCamera()` - Startet CameraX Preview
- `stopCamera()` - Stoppt Kamera und gibt Ressourcen frei
- `startDetection()` - Startet Frame-Analyse
- `stopDetection()` - Stoppt Detection Loop
- `setZoom(zoom)` - Setzt Zoom-Level (1.0 - maxZoom)
- `getZoom()` - Gibt aktuellen Zoom zurück
- `cropObject(objectId)` - Cropt erkanntes Objekt als Base64
- `updateObjectStatus(...)` - Aktualisiert Objekt nach OCR
- `getTrackedObjects()` - Gibt alle getrackten Objekte zurück
- `getStableObjects()` - Gibt stabile Objekte für OCR zurück

**Events:**
- `detectionUpdate` - Wird bei jeder Detection ausgelöst

### Tracking-Algorithmus

```java
// Kalman-like Smoothing
void update(float[] newBbox, float smoothingFactor) {
    for (int i = 0; i < 4; i++) {
        float predicted = smoothedBbox[i] + velocity[i];
        float innovation = newBbox[i] - predicted;
        smoothedBbox[i] = predicted + smoothingFactor * innovation;
        velocity[i] = 0.5f * velocity[i] + 0.5f * (newBbox[i] - bbox[i]);
    }
}
```

---

## ⚙️ Konfigurationsparameter

### Detection Parameter (NativeARPlugin.java)

```java
// Detection
private static final long DETECTION_INTERVAL_MS = 80;    // ~12.5 FPS
private static final float MIN_CONFIDENCE = 0.25f;       // Mindest-Confidence

// Aspect Ratio Filter (für Hochformat-Cover)
private static final float MIN_ASPECT_RATIO = 1.1f;
private static final float MAX_ASPECT_RATIO = 2.8f;

// Area Filter
private static final float MIN_AREA_PERCENT = 0.005f;    // 0.5% des Screens
private static final float MAX_AREA_PERCENT = 0.6f;      // Max 60%

// Tracking
private static final float SMOOTHING_FACTOR = 0.3f;      // Kalman Smoothing
private static final int STABILITY_THRESHOLD = 8;        // Frames bis OCR
private static final float IOU_THRESHOLD = 0.3f;         // Matching Threshold
private static final long GRACE_PERIOD_MS = 500;         // Object Keep-Alive
```

---

## 🚀 Build & Deployment

### Prerequisites

1. Android Studio mit SDK 34+
2. Node.js 18+
3. Bun oder npm

### Build Commands

```bash
# Install dependencies
bun install

# Build web assets
bun run build

# Sync with Capacitor
npx cap sync android

# Open in Android Studio
npx cap open android
```

### Gradle Dependencies (android/app/build.gradle)

```groovy
// CameraX
def camerax_version = "1.3.1"
implementation "androidx.camera:camera-core:${camerax_version}"
implementation "androidx.camera:camera-camera2:${camerax_version}"
implementation "androidx.camera:camera-lifecycle:${camerax_version}"
implementation "androidx.camera:camera-view:${camerax_version}"

// Guava for ListenableFuture
implementation 'com.google.guava:guava:32.1.3-android'
```

---

## 🔮 Geplante Erweiterungen

### Phase 1: TFLite Model Integration
- [ ] Custom YOLOv8 Modell für DVD-Cover trainieren
- [ ] TensorFlow Lite Integration in NativeARPlugin
- [ ] Model-Optimierung für mobile Geräte

### Phase 2: ARCore Integration
- [ ] ARCore für besseres 3D-Tracking
- [ ] Plane Detection für Regal-Erkennung
- [ ] Persistente AR-Anchors

### Phase 3: Offline Mode
- [ ] Lokale Film-Datenbank
- [ ] Cached Covers mit Embeddings
- [ ] Offline OCR mit ML Kit

---

## 📊 Vergleich: Alt vs. Neu

| Feature | Alt (v1.0) | Neu (v2.0) |
|---------|-----------|------------|
| Camera | Web API (getUserMedia) | CameraX Native |
| Detection | TensorFlow.js COCO-SSD | Native Detection |
| Tracking | IoU-Matching + EMA | Kalman Filter + Velocity |
| Zoom | ❌ Nicht möglich | ✅ Native Zoom |
| Fokus | ❌ Auto nur | ✅ Native Fokus |
| Performance | ~10 FPS (WebGL) | ~12.5 FPS (Native) |
| Bundle Size | +15MB (TF.js) | Minimal JS |
| Offline Detection | ❌ Nein | ✅ Möglich (TFLite) |

---

## 🗑️ Entfernte Abhängigkeiten

Diese Pakete wurden entfernt:
- `@tensorflow/tfjs` - Ersetzt durch Native Detection
- `@tensorflow/tfjs-backend-cpu` - Nicht mehr benötigt
- `@tensorflow-models/coco-ssd` - Ersetzt durch Native Detection

---

## 📝 Changelog

### v2.0.0 (2025-12-22)
- ✅ Komplette Neuimplementierung mit Native Plugins
- ✅ CameraX Integration für native Kamera-Kontrolle
- ✅ Kalman-Filter Tracking System
- ✅ Zoom-Kontrolle hinzugefügt
- ✅ TensorFlow.js Abhängigkeiten entfernt
- ✅ Web Fallback für Browser-Testing
