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

### Neuer Ansatz (v2.1) - Gemini Vision Cover Detection
- **Problem gelöst**: Alter Ansatz (Text finden → Cover ableiten) funktioniert nicht
- **Neuer Ansatz**: Gemini Vision analysiert komplettes Frame → liefert Cover-Positionen + Titel

### Datenfluss:
```
Kamera-Frame → Gemini Vision → Cover-Positionen + Titel → TMDB/OMDb → Rating → Overlay
```

### Geänderte Dateien:
- `src/services/ocrService.ts` - Neue `analyzeFrameForCovers()` Funktion
- `src/components/ARScanner.tsx` - Kompletter Rewrite mit neuem Ansatz
- `src/components/LoadingScreen.tsx` - Besseres Error Handling
- `src/plugins/NativeARPluginWeb.ts` - Full-frame capture Support
- `android/.../NativeARPlugin.java` - Full-frame capture Support

## What's Been Implemented (2026-03-23)
- [x] Neuer Gemini Vision Ansatz für Cover-Erkennung mit Bounding-Boxes
- [x] Full-frame capture für beide Plattformen (Native + Web)
- [x] Periodische Frame-Analyse (2 Sekunden Intervall)
- [x] Movie Data Caching für Performance
- [x] Verbessertes Error Handling mit Demo-Modus
- [x] Canvas-basiertes Overlay mit Bounding-Boxes und Rating-Badges

## Prioritized Backlog

### P0 - Kritisch
- [ ] Testen auf echtem Android-Gerät mit API Keys
- [ ] Native Frame-Capture Timing optimieren

### P1 - Wichtig
- [ ] Tracking-Stabilität verbessern (Cover bleiben bei Bewegung)
- [ ] Geschwindigkeit optimieren (evtl. kürzere Intervalle)
- [ ] Caching zwischen Frames für flüssigere Anzeige

### P2 - Nice to Have
- [ ] Offline-Modus mit lokalem Cache
- [ ] TFLite Model für noch schnellere Cover-Erkennung
- [ ] Haptic Feedback bei Cover-Erkennung

## Next Tasks
1. API Keys in `.env` eintragen:
   - `VITE_GEMINI_API_KEY`
   - `VITE_TMDB_API_KEY`
   - `VITE_OMDB_API_KEY`
2. App auf echtem Android-Gerät bauen und testen
3. Frame-Analyse Intervall anpassen basierend auf Performance
