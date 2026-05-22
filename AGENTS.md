# Urdu Voice and Video Sync Rule

When generating or modifying code for this application, ensure the following rules are followed:

1. **Urdu Voice Generation**:
   - Always use `gemini-3.1-flash-tts-preview` for text-to-speech.
   - Explicitly instruct the model to speak in Urdu in the prompt (e.g., "Speak the following Urdu text naturally...").
   - Do not use `safetySettings` in the TTS config as it may block valid Urdu content.

2. **Screen Highlights and Sync**:
   - Urdu is a Right-To-Left (RTL) language. When calculating word positions for highlights, ensure the first word of a line is placed at the rightmost position, and subsequent words are placed to its left.
   - The highlight must move from right to left to correctly sync with the spoken Urdu words.
   - Ensure the text overlay respects the aspect ratio of the target screen (Desktop 16:9, TikTok/Reels 9:16, Facebook 4:5, Instagram 1:1) by dynamically adjusting font sizes and margins.

3. **Text Overlay and Animation**:
   - Draw text word-by-word to allow individual word highlighting, but ensure `ctx.textAlign = 'center'` and `ctx.textBaseline = 'middle'` are used with precise `x, y` coordinates.
   - Use a fallback font stack that supports Urdu (e.g., `"Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar"`).
