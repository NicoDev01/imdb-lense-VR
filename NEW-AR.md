Hier ist ein **State-of-the-Art Architektur-Vorschlag 2025**, passend zu *deinem Workflow* (Android App in Vite / PWA-ähnlich, native Kamera + Zoom + Live-AR-Overlay) — mit konkreten Empfehlungen für **jeden Schritt**:

---

# 📱 Architektur für deine Android App (Vite / hybride App)

> Du willst:
> **Live-Kamera → Frames → Cover-Erkennung → Tracking → AR-Overlay → Crop → VLM**
> Alles **in Echtzeit**. Dafür brauchst du eine Mischung aus **modernen CV-Tools + AR-SDKs + nativer Kamerasteuerung**.

---

## 1) 📹 Video-Stream (Native Kamera mit Zoom)

**Empfehlung:**
🔹 **Android Native Camera2 / CameraX API** – volle Kontrolle über Fokus, Zoom, native Performance
✔ bietet native Kamera-Streams mit manuellem Fokus, Zoom und Exposure.
✔ deutlich besser für Latenz & Verarbeitung als Web-only Kameras.

👉 In einer Vite-basierten App musst du das native Modul **via Plugin** oder **Capacitor / Cordova Native Plugin** einbinden, weil reine Web-API nicht denselben nativen Zoom/Fokus liefert.

**Warum native?**
Weil WebRTC/Web API Kameras nur eingeschränkt Zugriff auf Zoom + Fokus geben — besonders bei Android.
→ native Camera2/CameraX liefert feinere Kontrolle und Echtzeit-Frames für ML.
*(Hinweis: Kamera-Ersetzen durch Videodatei ist systemseitig nicht möglich ohne Root – Android erlaubt das nicht)([SilverPC Blog][1])*

---

## 2) 🧱 Frame Extraction

✔ **Mediapipe Frame-Processor** – lokale Frame-Verarbeitung
✔ **VisionCamera (Frame Processor)** – real-time Frame Access

**Bibliotheken / Optionen:**

* **react-native-vision-camera** (Frame Processors)

  * direkt Frame-Callbacks
  * kann per JS/Native TFLite/Edge-Modelle auslesen
  * unterstützt Zoom/Resolution etc. gut auf Android([Toolerific.AI][2])

* **Google MediaPipe**

  * Android / native pipelines, läuft on-device
  * speziell für Video-Frame Processing optimiert (Edge-ML integriert)([Wikipedia][3])

💡 *VisionCamera* ist eine sehr gute Basis für eine hybride App mit nativer Kamera + Frame extraction.

---

## 3) 🧠 Object Detection (Cover Detection)

**Ziel:** In jedem Frame erkennen, wo Filmcover sind → Bounding Boxes.

**Empfohlene Ansätze 2025**

### 🌀 On-Device Detection

Für Echtzeit und geringe Latenz:

🔹 TensorFlow Lite / Mobile-Optimized Models
✔ lightweight Detektor für Mobilgeräte
✔ läuft in VisionCamera Frame Processor oder Mediapipe

Beispiel:

* **TensorFlow Lite SSD/MobileNet Varianten**
* **PP-PicoDet / andere mobile optimized Detectors** (leichter und schnell)
  → echte Echtzeit-Detektion auf Mobilgeräten durch optimierte Architektur([Wikipedia][3])

📌 Output: Bounding Boxes für potentielle Cover im Bild.

---

## 4) 🧹 Filtering (Cover vs. Nicht-Cover)

Da generelle Detektoren oft viele Objekte erkennen, brauchst du:

✅ Konfidenz-Thresholds
➤ Nur Bounding Boxes über hoher Confidence behalten

oder

✅ Zweite Stufe: Klassifizierung
→ jeden Crop kurz klassifizieren, ob es ein Filmtitel/Poster ist.

Techniken:

* **On-Device Mini-Classifier**
  z. B. leichtes CNN / TFLite Classifier, trained auf Film Poster
* **Edge Embeddings**
  z. B. CLIP-Style Embeddings → Filter nach semantischer Nähe zu bekannten Cover-Vektoren

🔥 Tipp: On device Filtern ergibt niedrigere Latenz bevor API-Calls gemacht werden.

---

## 5) 👣 Tracking (Cover durch Frames verfolgen)

🔁 Tracking sorgt dafür, dass du *nicht jedes Cover jedes Frame neu an den Server schicken musst* — außerdem kannst du Bewegung stabil verfolgen.

Empfohlene Optionen:

### 📍 Kalman Filter (klassisch, leicht)

• Trackt Bounding Boxes über Frames
• Ideal für mobile devices

### 📍 Deep Learning Tracking

• z. B. leichtgewichtige Siamese Tracking Modelle
• Sehr robust für bewegte Objekte in AR Szenen
→ state-of-the-art Lightweight Tracking wird 2025 aktiv in AR/AR-Brillen etc. eingesetzt – z. B. kompakte Siamese-Netzwerke für AR-Tracking bei ~30+ FPS auf Mobilgeräten([arXiv][4])

→ *Tracking ist wichtig*, um zu vermeiden, dass ein einmal erkannter Cover jede Sekunde neu gecropt wird.

---

## 6) ✂️ Crop/Extract

**Crop Logik:**

✔ Bounding Box Normalisierung
✔ Crop aus dem Frame → Base64 oder Bitmap

Damit bereitest du die Bilder für die VLM-API vor.

🔥 Tipp:
🎯 Vor dem Upload: Downscale auf moderate Auflösung, um Kosten/Latenz zu reduzieren.

📌 Nur croppen, wenn Tracking bestätigt, dass es *anderes Objekt* ist → nicht wiederholt dasselbe.

---

## 7) 🧑‍🎨 AR Overlay Rendering

Ziel: Live-AR-Overlay über jedes erkannte Cover setzen.

**Empfohlene Optionen 2025**

### 🟢 ARCore (Android AR SDK)

✔ Googles AR-Plattform für Android
✔ Markerless Tracking — Kameraposition + Umgebung
✔ Lichtschätzung + Stabilität für virtuelle Objekte([vuframe.com][5])

Du kannst damit über jeden real-welt-Frame eine Overlay-Ebene rendern.

**Use Cases:**
→ Redux für jedes erkannte Cover
→ Live-Bounding Boxes, Titel + Confidence, UI-Panels, 3D Frames über Cover

Um das UI schön zu rendern, kombiniert man:

🧠 **Sceneform / OpenGL / Vulkan**
oder
💻 **Unity Plugin** (für komplexere AR-Erlebnisse)

---

## 🔌 How all pieces fit zusammen

```
📱 Native Camera (CameraX/Camera2)
         ↓ Frames (VisionCamera / Mediapipe)
         ↓ Object Detection (TFLite Mobile)
         ↓ Filtering (Confidence Threshold + Secondary Filter)
         ↓ Tracking (Kalman / Lightweight DL Tracker)
         ↓ Crop (Bounding Box → Image)
         ↓ Send to VLM API (Gemini 2.5 Flash-Lite Structured JSON)
         ↓ Receive Titel → Store
         ↓ ARCore Overlay (Box + Text Render)
```

---

## 🛠 Tech Stack & Libraries (konkret)

| Layer            | Empfehlung                                     |
| ---------------- | ---------------------------------------------- |
| Camera           | **CameraX / Camera2** (Native Android)         |
| Frame Extraction | VisionCamera Frame Processor / Mediapipe       |
| Detection        | TensorFlow Lite / Mobile Detectors             |
| Filtering        | Secondary Light classifier / Embeddings        |
| Tracking         | Kalman + Lightweight Siamese Tracker           |
| Crop             | Native Bitmap/Buffer Crop                      |
| AR Overlay       | **ARCore** (Android)                           |
| UI / Hybrid App  | Vite + Capacitor Plugin für Native Integration |

---

## 💡 Wichtige Hinweise für Vite-App + Native Kamera

📌 Eine rein browserbasierte PWA wird nicht reichen, weil Zoom/Native Camera Steuerung + ARCore nicht von Web APIs unterstützt wird → musst **native Modules** einbinden (via Capacitor/React-Native Bridge).
📌 ARCore ist die Standard-Augmented-Reality-SDK für Android und funktioniert tief mit Camera + Motion Tracking.([vuframe.com][5])

---

## 🧠 Fazit – State-of-the-Art 2025

✔ On-Device Detection & Tracking für Tempo und Effizienz
✔ Native Camera für Zoom/Focus
✔ ARCore für Overlay + Tracking
✔ VLM API für semantische Cover-Erkennung

👉 Diese Architektur kombiniert das Beste aus **on-device Computer Vision**, **AR SDKs**, **Tracking**, und **Gemini API-Integration**, um *echten Echtzeit-AR-Workflow mit strukturiertem Output* zu bauen.

---

Wenn du willst, kann ich dir **Beispiel-Code-Snippets** und ein **Projekt-Setup-Template** (z. B. Vite + Capacitor + native Modules) geben. Sag einfach Bescheid! 👩‍💻📱

[1]: https://blog.silverpc.hu/2025/09/13/der-ultimative-kamera-trick-ist-es-mit-einer-android-app-moglich-die-kamera-durch-eine-videodatei-zu-ersetzen/?utm_source=chatgpt.com "Der ultimative Kamera-Trick: Ist es mit einer *Android App möglich, die Kamera durch eine Videodatei zu ersetzen*? - SilverPC Blog"
[2]: https://toolerific.ai/ai-tools/opensource/mrousavy-react-native-vision-camera?utm_source=chatgpt.com "github- react-native-vision-camera :Features,Alternatives | Toolerific"
[3]: https://en.wikipedia.org/wiki/MediaPipe?utm_source=chatgpt.com "MediaPipe"
[4]: https://arxiv.org/abs/2511.17508?utm_source=chatgpt.com "Deep Learning-based Lightweight RGB Object Tracking for Augmented Reality Devices"
[5]: https://www.vuframe.com/blog/3d-lexikon/arcore/?utm_source=chatgpt.com "ARCore"
