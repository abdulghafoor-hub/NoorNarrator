# Application Features & Functions Documentation

This document provides a comprehensive breakdown of all features, functions, and architectural components of the AI Cinematic Video Generator.

## 1. Core Features (User-Facing)

*   **Multi-Platform Output (Aspect Ratio Selection)**
    *   *Functionality*: Users can select between various templates such as 9:16 (Shorts/Reels/TikTok), 16:9 (YouTube Landscape), and 1:1 (Instagram Square). 
    *   *System Impact*: This selection dynamically drives canvas resolution, font sizing, margin padding, and text positioning.
*   **AI Scene & Timeline Generation**
    *   *Functionality*: By clicking "Generate AI Scene Timeline", the app processes a raw topic or script and breaks it down into precise, timestamped scenes.
    *   *System Impact*: Invokes the `generateVideoScenes` function, which maps out pacing, voiceover text, on-screen text overlays, and cinematic visual prompts.
*   **Urdu Audio Narration (TTS)**
    *   *Functionality*: Converts Urdu text inputs into natural, high-quality speech.
    *   *System Impact*: Uses `gemini-3.1-flash-tts-preview` to generate audio. The system maps the returned audio with word-level timestamps to synchronize visual highlights.
*   **Viral SEO Metadata Generation**
    *   *Functionality*: Automatically creates viral titles, descriptions, and hashtags tailored for the video.
    *   *System Impact*: Generates mixed-language (Urdu Title | English Title) hooks and incorporates trending keywords to maximize Click-Through Rates (CTR).
*   **Canvas Preview & Video Export**
    *   *Functionality*: Users can preview the animated video in real-time within the browser and record the final output.
    *   *System Impact*: Uses HTML5 `<canvas>` for rendering and the `MediaRecorder` API to capture the canvas stream and audio track into a `.webm` file.

## 2. Advanced Rendering Engine (`utils/videoUtils.ts`)

The rendering engine is responsible for painting every frame of the video. It includes the following specific functions and capabilities:

*   **RTL (Right-to-Left) Text Support**
    *   *Function*: Detects Arabic/Urdu characters and handles precise RTL line-breaking and word-by-word positioning. 
    *   *Typography*: Uses a robust fallback font stack (`Jameel Noori Nastaleeq`, `Amiri`, `Inter`) to ensure native rendering of Urdu scripts alongside English.
*   **Word-by-Word Audio Synchronization**
    *   *Function*: Analyzes current audio playback time and highlights the exact spoken word.
    *   *Visual Effect*: Active words receive a glowing golden gradient, an increased shadow blur for a glowing effect, and a slight upward scale/pulse animation driven by a sine-wave function.
*   **Dynamic Layout & Animation Modes**
    *   *Sticky Headlines*: Locks the primary title block to the top of the screen (or side on Landscape) while sub-text animates.
    *   *Focus Mode*: Scrolls text vertically, keeping the current spoken sentence horizontally centered while fading out past/future sentences.
    *   *Horizontal Slide*: Slides text blocks from Left to Right (or vice versa).
*   **Cinematic Compositing (VFX)**
    *   *God Rays*: Animated diagonal light beams rendered using `ctx.createLinearGradient` and the `screen` composite operation, giving a heavenly/dramatic lighting effect.
    *   *Dust Particles*: Rendered using mathematical sine/cosine functions to simulate floating, glowing, warm dust orbs in the foreground.
    *   *Vignette & Backgrounds*: A dark radial gradient at the edges of the screen focuses attention on the center, while background images slowly pan/zoom (Ken Burns effect).

## 3. Backend AI Services (`services/geminiService.ts`)

These modular async functions interact directly with the Gemini API to orchestrate intelligent operations:

*   `generateVideoScenes(topicOrScript: string)`:
    *   Takes raw input and returns a structured JSON array representing scenes (start time, end time, voiceover, short onscreen text, and a prompt for image generation).
*   `processScript(topic: string, promptIndex: number)`:
    *   Expands a basic topic into a full, emotionally resonant script (specialized in Islamic wisdom, deep quotes, etc.).
*   `generateSEOMetadata(script: string)`:
    *   Analyzes the script and outputs optimized SEO blocks in JSON (Titles, Descriptions, Keywords).
*   `generateAtmosphereImage(prompt: string, aspectRatio: string)`:
    *   Takes the cinematic prompts from the scene generation phase and generates actual background imagery for the video.
*   `generateThumbnailData(script: string)`: 
    *   Suggests a high-impact, short catchphrase specifically designed for the video thumbnail.

## 4. Layer & State Management (`App.tsx`)

The main application component acts as the director, maintaining the state of the video project:

*   **Layer System**: The video is composed of independent layers (Text, Image, Video, Shape). Each layer has its own `zIndex`, `startTime`, `endTime`, positioning (`x`, `y`), and animation settings.
*   **State Hooks**: React hooks manage the `currentTime` of the video, the `isPlaying` status, and the `isRecording` status.
*   **Timeline Interactions**: Users can theoretically modify layer properties (font size, color, text content) which immediately updates the rendering loop.

## 5. Summary of Extensibility
Because the architecture decouples AI Generation (Services), State Management (React/App), and Rendering (Canvas/Utils), the app can easily be extended to support new languages, new VFX particle systems, or integration with external video B-roll APIs without fundamentally rewriting the core synchronization logic.
