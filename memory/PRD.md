# IMDB Lense - Product Requirements Document

## Original Problem Statement
Die visuelle Echtzeit-Erkennung von Film-Covern und deren Umrandung (Bounding-Boxes) mit IMDb-Bewertungen funktioniert nicht. Der User möchte sein Handy auf eine Film-Bibliothek (z.B. Netflix) halten und sofort in den Covern die IMDb-Bewertung sehen.

## User Personas
- **Primary User**: Film-Enthusiast der Netflix/Streaming-Bibliotheken scannt
- **Use Case**: Vom Sofa auf den TV schauen, Cover erkennen, Ratings sehen

## Core Requirements (Static)
1. Echtzeit Kamera-Feed mit Zoom-Kontrolle (für Entfernung TV)
2. Film-Cover Erkennung mit Bounding-Boxes
3. IMDb-Rating Anzeige direkt auf dem Cover
4. Stabile Tracking bei leichter Bewegung

## Technical Architecture

### Neuer Ansatz (v2.2) - Optimized Gemini Vision
- **Modell**: `gemini-3.1-flash-lite-preview` (schneller + besser)
- **Ansatz**: Gemini Vision analysiert komplettes Frame → liefert Cover-Positionen + Titel

### Datenfluss:
```
Kamera-Frame → Motion Detection → Gemini Vision → Cover-Positionen + Titel 
    → Parallel TMDB/OMDb → Rating → Smooth Interpolation → Overlay
```

### Implementierte Optimierungen:

1. **✅ Gemini 3.1 Flash Lite Preview**
   - Schnelleres und besseres Modell

2. **✅ Parallele API-Aufrufe**
   - `fetchMovieDataBatch()` - alle Cover gleichzeitig abfragen
   - 3 Cover = 1x Zeit statt 3x

3. **✅ Motion Detection**
   - Frame-Hash Vergleich
   - Nur bei signifikanter Änderung neu analysieren
   - Spart API-Kosten

4. **✅ Smooth Tracking**
   - Bounding-Boxes interpolieren zwischen Frames
   - `SMOOTHING_FACTOR: 0.25` für flüssige Animation
   - 30 FPS Interpolation

5. **✅ Confidence-basierte Anzeige**
   - `high`: Solide Linie
   - `medium`: Gepunktete Linie (orange)
   - `low`: Gestrichelte Linie (grau)

6. **✅ Lokaler Cover-Cache**
   - `movieDataCache` in movieService
   - Sofortige Anzeige für bereits erkannte Cover

7. **✅ Haptic Feedback**
   - Kurze Vibration bei neuer Cover-Erkennung

8. **✅ Rating Filter**
   - Filter Button oben rechts
   - "Alle", "6.0+", "7.0+", "8.0+" Optionen

### Konfiguration (CONFIG):
```typescript
ANALYSIS_INTERVAL_MS: 1500,    // Frame-Analyse Intervall
MOTION_THRESHOLD: 0.02,        // Motion Detection Schwelle
SMOOTHING_FACTOR: 0.25,        // Box Interpolation
COVER_TIMEOUT_MS: 3000,        // Cover verschwindet nach X ms
```

### Geänderte Dateien:
- `src/services/ocrService.ts` - Gemini 3.1 + Cover Detection
- `src/services/movieService.ts` - Parallele Batch-Abfragen + Cache
- `src/components/ARScanner.tsx` - Alle Optimierungen
- `src/components/LoadingScreen.tsx` - Demo-Modus
- `src/plugins/NativeARPluginWeb.ts` - Full-frame Support
- `android/.../NativeARPlugin.java` - Full-frame Support

## What's Been Implemented (2026-03-23)
- [x] Gemini 3.1 Flash Lite Preview Modell
- [x] Parallele API-Aufrufe (fetchMovieDataBatch)
- [x] Motion Detection (Frame-Hash)
- [x] Smooth Tracking (Box Interpolation)
- [x] Confidence-basierte Anzeige
- [x] Lokaler Movie Data Cache
- [x] Haptic Feedback
- [x] Rating Filter UI

## Prioritized Backlog

### P0 - Kritisch
- [ ] Testen auf echtem Android-Gerät mit API Keys

### P1 - Wichtig  
- [ ] Watchlist-Integration (Swipe up = hinzufügen)
- [ ] Cover-Bild Caching (Poster Preview)

### P2 - Nice to Have
- [ ] Offline-Modus mit lokalem SQLite Cache
- [ ] TFLite Model für noch schnellere On-Device Erkennung
- [ ] Share-Funktion für erkannte Filme

## Next Tasks
1. API Keys in `.env` eintragen
2. `yarn build && npx cap sync android && npx cap open android`
3. Auf echtem Android-Gerät testen
4. Performance-Tuning basierend auf Tests
