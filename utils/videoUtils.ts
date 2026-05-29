import React from "react";
import {
  AnimationType,
  EditorLayer,
  LayerType,
  TextEffect,
  ImageEffect,
  BackgroundAnimation,
  TextPosition,
} from "../types";

export const resolveTextScreenPosition = (
  width: number,
  height: number,
  aspectRatio: string,
  positionPreference: TextPosition | string,
  customX: number | undefined,
  customY: number | undefined,
  isStickyHeadline: boolean,
): { screenCenterX: number; screenCenterY: number } => {
  // If custom coordinates exist, overriding all enum logic completely
  if (customX !== undefined && customY !== undefined) {
    return {
      screenCenterX: customX * width,
      screenCenterY: customY * height,
    };
  }

  // Define Safe Zone Margins Based on Aspect Ratio
  let topMargin = height * 0.15;
  let bottomMargin = height * 0.15;
  let sideMargin = width * 0.1;

  if (aspectRatio === "9:16") {
    // Vertical
    topMargin = height * 0.18;
    bottomMargin = height * 0.25;
  } else if (aspectRatio === "16:9") {
    // Landscape
    topMargin = height * 0.12;
    bottomMargin = height * 0.12;
  } else if (aspectRatio === "1:1") {
    // Square
    topMargin = height * 0.15;
    bottomMargin = height * 0.15;
  }

  // Handle Sticky Headline Override
  let pos = positionPreference;
  if (pos === "Top" && !isStickyHeadline) {
    pos = "Bottom";
  }

  // Position Routing
  let screenCenterX = width / 2;
  let screenCenterY = height / 2;

  switch (pos) {
    case "Center":
      screenCenterX = width / 2;
      screenCenterY = height / 2;
      break;
    case "Top":
      screenCenterX = width / 2;
      screenCenterY = topMargin;
      break;
    case "Bottom":
      screenCenterX = width / 2;
      screenCenterY = height - bottomMargin;
      break;
    case "Left":
      screenCenterX = sideMargin;
      screenCenterY = height / 2;
      break;
    case "Right":
      screenCenterX = width - sideMargin;
      screenCenterY = height / 2;
      break;
    case "Top-Left":
      screenCenterX = sideMargin;
      screenCenterY = topMargin;
      break;
    case "Top-Right":
      screenCenterX = width - sideMargin;
      screenCenterY = topMargin;
      break;
    case "Bottom-Left":
      screenCenterX = sideMargin;
      screenCenterY = height - bottomMargin;
      break;
    case "Bottom-Right":
      screenCenterX = width - sideMargin;
      screenCenterY = height - bottomMargin;
      break;
    default:
      // Fallback
      screenCenterX = width / 2;
      screenCenterY = height / 2;
      break;
  }

  // If one of the custom overrides is present
  if (customX !== undefined) screenCenterX = customX * width;
  if (customY !== undefined) screenCenterY = customY * height;

  return { screenCenterX, screenCenterY };
};

export interface WordMetadata {
  text: string;
  start: number;
  end: number;
  width: number;
  lineIndex: number;
  relativeX: number; // Offset from the line's geometric center
  globalY: number; // Note: This is now the actual Y position including paragraph spacing
  index: number;
}

export interface LineMetadata {
  words: string[];
  y: number;
  height: number;
  isParagraphStart: boolean;
  wordIndices: number[]; // Store indices for O(1) lookup
  blockIdx: number;
  isFocusItem: boolean;
  isArabic?: boolean;
}

export type LayoutCache = Map<
  string,
  { lines: LineMetadata[]; words: WordMetadata[] }
>;

const LINE_BREAK_TOKEN = "||LB||";

/**
 * Standard cubic easing for smooth transitions.
 */
const easeInOutCubic = (t: number): number => {
  const clampedT = Math.max(0, Math.min(1, t));
  return clampedT < 0.5
    ? 4 * clampedT * clampedT * clampedT
    : 1 - Math.pow(-2 * clampedT + 2, 3) / 2;
};

/**
 * Normalizes text to ensure 1:1 mapping between TTS and Visuals.
 * Smartly handles brackets, newlines, and punctuation spacing.
 */
export const normalizeText = (text: string): string => {
  return (
    text
      // Remove emojis and symbols
      .replace(
        /[\u{1F000}-\u{1F9FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu,
        "",
      )
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Encode Newlines as distinct tokens before collapsing space.
      // This allows the user to manually control pauses via the Enter key.
      .replace(/\n+/g, ` ${LINE_BREAK_TOKEN} `)
      // Remove space before suffix punctuation (stops, commas, closing brackets)
      .replace(/\s+([۔!?\.\؟,،:;»”’)\}\]])/g, "$1")
      // Remove space after prefix punctuation (opening brackets, quotes)
      .replace(/([«“‘\(\{\[])\s+/g, "$1")
      // Collapse remaining whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
};

/**
 * Checks if a word ends with a sentence-terminating character (Urdu/English).
 */
const isParagraphEnd = (word: string): boolean => {
  // Prevent breaking immediately after a numbered list item like "1." or "2)"
  if (/^\d+[\.\)]?$/.test(word)) return false;
  return /[۔!?\.\؟]['"”’)\}\]]*$/.test(word);
};

// --- SYNCHRONIZATION TUNING ---
// "Auto Caption" Sync Logic: Mapped to TTS phonetic length.
// Since `analyzeAudioSilence` dynamically strips start/end silence from audio buffers,
// we only need exact phonetic distribution across the active time segment.
const WEIGHT_START_PAD = 0;
const WEIGHT_CHAR = 10;
const WEIGHT_WORD_BASE = 8;
const WEIGHT_STOP = 60;
const WEIGHT_COMMA = 25;
const WEIGHT_BREAK = 20;
const WEIGHT_PARA = 10;

const getWordWeight = (word: string): number => {
  // Clean word for length count
  const cleanWord = word
    .replace(/[\u064B-\u065F\u0670]/g, "") // Remove Diacritics
    .replace(/[۔!?\.\؟,،:;""''«»\(\)\[\]\{\}]/g, ""); // Remove Punctuation

  const isArabicChar = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(cleanWord);
  let baseWt = isArabicChar ? WEIGHT_WORD_BASE * 1.5 : WEIGHT_WORD_BASE;
  let wWeight = baseWt + cleanWord.length * WEIGHT_CHAR * (isArabicChar ? 1.2 : 1.0);

  // Punctuation Timing
  if (/[۔؟!.\?]/.test(word)) {
    wWeight += WEIGHT_STOP;
  } else if (/[،:,]/.test(word)) {
    wWeight += WEIGHT_COMMA;
  }
  return wWeight;
};

/**
 * Calculates words and lines with high precision for alignment.
 */
export const isPureArabic = (text: string) =>
  /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\p{P}\d\u06F0-\u06F9]+$/gu.test(
    text.trim(),
  );

export const isRTL = (text: string) =>
  /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFF]/gm.test(
    text,
  );

export const getWordMetadata = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseFontSize: number,
  lineHeight: number,
  cache?: LayoutCache,
  isVertical: boolean = false,
  isLandscape: boolean = false,
): { lines: LineMetadata[]; words: WordMetadata[] } => {
  // 1. Check Cache
  const normalizedText = normalizeText(text);
  const cacheKey = `${normalizedText}_${maxWidth.toFixed(2)}_${baseFontSize.toFixed(2)}_${isVertical}_${isLandscape}`;

  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const isRtl = isRTL(normalizedText);

  ctx.font = `bold ${baseFontSize}px "Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar", "Inter", sans-serif`;

  const rawWords = normalizedText.split(" ").filter((w) => w.length > 0);

  const wordsMetadata: WordMetadata[] = [];
  const lines: LineMetadata[] = [];

  // Pass 1: Calculate Total Weight (Time Duration)
  let totalWeight = WEIGHT_START_PAD;
  rawWords.forEach((w) => {
    if (w === LINE_BREAK_TOKEN) {
      totalWeight += WEIGHT_BREAK;
    } else {
      totalWeight += getWordWeight(w);
    }
  });
  totalWeight += WEIGHT_PARA;

  if (totalWeight === 0) totalWeight = 100;

  // Pass 2: Layout & Timing Allocation
  const wordToIsArabic: boolean[] = [];
  let _wIdx = 0;
  while (_wIdx < rawWords.length) {
    let endIndex = _wIdx;
    const tempStr = [];
    while (endIndex < rawWords.length) {
      const w = rawWords[endIndex];
      if (w === LINE_BREAK_TOKEN) {
        if (tempStr.length === 0) {
          wordToIsArabic[endIndex] = false;
          endIndex++;
          continue;
        }
        break;
      }
      tempStr.push(w);
      if (isParagraphEnd(w) || /^[\d۰-۹]+[\.\)]?$/.test(w)) {
        endIndex++;
        break;
      }
      endIndex++;
    }
    const blockStr = tempStr.join(" ");
    const isArabic = isPureArabic(blockStr);
    for (let i = _wIdx; i < endIndex; i++) {
      wordToIsArabic[i] = isArabic;
    }
    _wIdx = endIndex;
  }

  let weightCursor = WEIGHT_START_PAD;
  let PARAGRAPH_SPACING = lineHeight * 0.4;

  let currentLineWords: string[] = [];
  let currentLineWordIndices: number[] = [];
  let currentLineWidth = 0;
  let currentLineY = 0;
  let currentLineIdx = 0;
  let lastWasParagraphBreak = false;
  let currentBlockIdx = 0;
  let linesInCurrentBlock = 0;
  let isFocusParagraph = false;

  const commitLine = () => {
    if (currentLineWords.length === 0) return;

    const isArabicLine = wordToIsArabic[currentLineWordIndices[0]] || false;
    ctx.font = isArabicLine
      ? `bold ${baseFontSize * 1.3}px "KFGQPC Uthmanic Script", "Traditional Arabic", sans-serif`
      : `bold ${baseFontSize}px "Montserrat Extra Bold", "The Bold Font", "Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar", sans-serif`;

    // Center alignment calculation
    const totalW = ctx.measureText(currentLineWords.join(" ")).width;

    let prevWidth = 0;
    currentLineWordIndices.forEach((globalIdx, i) => {
      const substring = currentLineWords.slice(0, i + 1).join(" ");
      const currWidth = ctx.measureText(substring).width;

      let wordCenterX = 0;
      if (isRtl) {
        wordCenterX = totalW / 2 - (prevWidth + currWidth) / 2;
      } else {
        wordCenterX = -totalW / 2 + (prevWidth + currWidth) / 2;
      }

      wordsMetadata[globalIdx].relativeX = wordCenterX;
      wordsMetadata[globalIdx].lineIndex = currentLineIdx;
      wordsMetadata[globalIdx].globalY = currentLineY;
      wordsMetadata[globalIdx].width = currWidth - prevWidth; // Store approximate rendered width

      prevWidth = currWidth;
    });

    lines.push({
      words: [...currentLineWords],
      wordIndices: [...currentLineWordIndices],
      y: currentLineY,
      height: lineHeight * (isArabicLine ? 1.5 : 1.0),
      isParagraphStart: false,
      blockIdx: currentBlockIdx,
      isFocusItem: isFocusParagraph,
      isArabic: isArabicLine,
    });

    linesInCurrentBlock++;
    if (linesInCurrentBlock >= 2) {
      currentBlockIdx++;
      linesInCurrentBlock = 0;
    }

    currentLineWords = [];
    currentLineWordIndices = [];
    currentLineWidth = 0;
    currentLineIdx++;
  };

  let visualWordIndex = 0;

  rawWords.forEach((word) => {
    if (word === LINE_BREAK_TOKEN) {
      if (currentLineWords.length > 0) {
        commitLine();
        currentLineY += lineHeight;
      }
      if (!lastWasParagraphBreak) {
        currentLineY += PARAGRAPH_SPACING;
        lastWasParagraphBreak = true;
      }
      weightCursor += WEIGHT_BREAK;
      currentBlockIdx++;
      linesInCurrentBlock = 0;
      isFocusParagraph = false;
      return;
    }

    // List heuristic: Detect bullet points or numbered lists
    if (currentLineWords.length === 0 && !isFocusParagraph) {
      if (/^([-•*]|[\d۰-۹]+[\.\)]?)$/.test(word)) {
        isFocusParagraph = true;
      }
    } else if (currentLineWords.length > 0 && /^[\d۰-۹]+[\.\)]?$/.test(word)) {
      commitLine();
      currentLineY += lineHeight;
      currentBlockIdx++;
      linesInCurrentBlock = 0;
      isFocusParagraph = true;
    }

    const isArabicWord = wordToIsArabic[visualWordIndex];
    ctx.font = isArabicWord
      ? `bold ${baseFontSize * 1.3}px "KFGQPC Uthmanic Script", "Traditional Arabic", sans-serif`
      : `bold ${baseFontSize}px "Montserrat Extra Bold", "The Bold Font", "Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar", sans-serif`;

    const wordWidth = ctx.measureText(word).width;

    // Calculate new total line width cumulatively
    const potentialLine =
      currentLineWords.length > 0
        ? currentLineWords.join(" ") + " " + word
        : word;
    const proposedWidth = ctx.measureText(potentialLine).width;

    let maxWordsPerLine = 100;
    if (isArabicWord) {
      maxWordsPerLine = 1000;
    } else if (isVertical) {
      maxWordsPerLine = 3;
    } else if (isLandscape) {
      maxWordsPerLine = 8;
    }

    const fits = proposedWidth <= maxWidth;

    if (
      currentLineWords.length > 0 &&
      (!fits || currentLineWords.length >= maxWordsPerLine)
    ) {
      commitLine();
      currentLineY += lineHeight;
    }

    lastWasParagraphBreak = false; // Reset since we added a normal word

    const wordWeight = getWordWeight(word);

    // Assign time slots
    const startTime = weightCursor / totalWeight;
    weightCursor += wordWeight;
    const endTime = weightCursor / totalWeight;

    wordsMetadata.push({
      text: word,
      start: startTime,
      end: endTime,
      width: wordWidth,
      lineIndex: 0,
      relativeX: 0,
      globalY: 0,
      index: visualWordIndex,
    });

    currentLineWords.push(word);
    currentLineWordIndices.push(visualWordIndex);
    currentLineWidth = proposedWidth;

    if (isParagraphEnd(word)) {
      commitLine();
      currentLineY += lineHeight;
      lastWasParagraphBreak = true; // Avoid stacking with immediately following LB
    }

    visualWordIndex++;
  });

  commitLine(); // Commit final line

  const result = { lines, words: wordsMetadata };
  if (cache) cache.set(cacheKey, result);
  return result;
};

export const renderNarrationLayer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: any,
  globalProgress: number,
  duration: number,
  cache?: LayoutCache,
) => {
  // Ensure precise coordinate anchoring for word drawing
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Convert global video time to layer local time (text relative 0.0 to 1.0)
  const currentTotalTime = globalProgress * duration;
  let progress =
    (currentTotalTime - layer.startTime) / (layer.endTime - layer.startTime);

  if (layer.audioMetadata && layer.audioMetadata.activeDuration > 0) {
    // Map progress to just the active speech part
    const activeStartRatio =
      layer.audioMetadata.startSilence / layer.audioMetadata.totalDuration;
    const activeEndRatio =
      (layer.audioMetadata.totalDuration - layer.audioMetadata.endSilence) /
      layer.audioMetadata.totalDuration;

    if (progress <= activeStartRatio) {
      progress = 0;
    } else if (progress >= activeEndRatio) {
      progress = 1;
    } else {
      progress =
        (progress - activeStartRatio) / (activeEndRatio - activeStartRatio);
    }
  }

  // Allow slight buffer (1.05) to keep text visible at very end
  if (progress < 0 || progress > 1.05) return;

  const aspectRatio = width / height;
  const isVertical = aspectRatio <= 0.6; // 9:16 is 0.5625
  const isSquare = Math.abs(aspectRatio - 1.0) < 0.1;
  const isLandscape = width > height;

  // Responsive Typography Scaling
  let scaleRef = width;
  let baseFontSize = scaleRef * 0.05; // default base limit

  if (isVertical) {
    baseFontSize = scaleRef * 0.05 * 1.3; // Large and bold for shorts
  } else if (isSquare) {
    baseFontSize = scaleRef * 0.045;
  } else if (isLandscape) {
    baseFontSize = height * 0.07 * 0.85; // Cleaner and elegant scale down
  }

  const lineHeight = baseFontSize * 2.1; // Standardized line spacing

  // Layout Reflow Logic -> adapt maxWidth based on orientation
  let maxWScale = 0.85;
  if (isVertical) maxWScale = 0.8;
  else if (isLandscape) maxWScale = 0.8;

  const maxWidth = width * maxWScale;

  const { lines, words } = getWordMetadata(
    ctx,
    layer.text,
    maxWidth,
    baseFontSize,
    lineHeight,
    cache,
    isVertical,
    isLandscape,
  );
  if (words.length === 0) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.font = `bold ${baseFontSize}px "Montserrat Extra Bold", "The Bold Font", "Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar", sans-serif`;

  // --- ROBUST ACTIVE INDEX FINDER ---
  let activeIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (progress >= words[i].start) {
      activeIdx = i;
    } else {
      break;
    }
  }
  if (activeIdx === -1) activeIdx = 0;

  const currentWord = words[activeIdx];
  const currentLineIndex = currentWord.lineIndex;

  if (!lines[currentLineIndex]) return;

  const currentLineMeta = lines[currentLineIndex];
  const activeBlockIdx = currentLineMeta.blockIdx;
  const isFocusMode = currentLineMeta.isFocusItem;

  // Focus block lines (needed for both centering and horizontal motion)
  const blockLines = lines.filter((l) => l.blockIdx === activeBlockIdx);
  const isArabicBlock =
    blockLines.length > 0 ? !!blockLines[0].isArabic : false;

  let cameraY = currentLineMeta.y;
  let cameraX = 0;

  // Arabic Isolation overrides
  const isHorizontalAnim =
    !isArabicBlock &&
    (layer.animationType === AnimationType.LEFT_TO_RIGHT ||
      layer.animationType === AnimationType.RIGHT_TO_LEFT);
  const isVerticalScroll =
    !isArabicBlock && layer.animationType === AnimationType.VERTICAL_SCROLL;

  // Horizontal motion handling
  if (isHorizontalAnim) {
    let blockProgress = 0.5;
    if (blockLines.length > 0) {
      const blockStart = words[blockLines[0].wordIndices[0]].start;
      const lastLineIndices = blockLines[blockLines.length - 1].wordIndices;
      const blockEnd = words[lastLineIndices[lastLineIndices.length - 1]].end;
      const blockDur = blockEnd - blockStart;
      if (blockDur > 0) {
        blockProgress = Math.min(
          1,
          Math.max(0, (progress - blockStart) / Math.min(blockDur, 2.0)),
        );
      }
    }
    // Wide horizontal sweep across screen width (RTL_SLIDE / LTR_SLIDE)
    const maxScrollX = width * 1.5;
    const xProgress =
      layer.animationType === AnimationType.LEFT_TO_RIGHT
        ? -0.5 + blockProgress
        : 0.5 - blockProgress;
    cameraX = xProgress * maxScrollX;
  }

  // Vertical scroll / Focus handling
  if (isArabicBlock || isFocusMode || !isVerticalScroll) {
    // Center the entire block and DO NOT scroll vertically line-by-line
    if (blockLines.length > 0) {
      const blockStartY = blockLines[0].y;
      const blockEndY = blockLines[blockLines.length - 1].y;
      
      let baseCameraY = (blockStartY + blockEndY) / 2;
      
      // Shift camera to anchor blocks properly on margins without clipping
      if (
        layer.positionPreference === "Bottom" ||
        layer.positionPreference === "Bottom-Left" ||
        layer.positionPreference === "Bottom-Right"
      ) {
        // Shift camera down so text moves up (anchor bottom of block to margin)
        baseCameraY += (blockEndY - blockStartY) / 2;
      } else if (
        layer.positionPreference === "Top" ||
        layer.positionPreference === "Top-Left" ||
        layer.positionPreference === "Top-Right"
      ) {
        // Shift camera up so text moves down (anchor top of block to margin)
        baseCameraY -= (blockEndY - blockStartY) / 2;
      }
      
      cameraY = baseCameraY;
    }
  } else {
    // Continuous vertical scroll logic
    if (blockLines.length > 0) {
      const blockStartY = blockLines[0].y;
      const blockEndY = blockLines[blockLines.length - 1].y;

      const blockStart = words[blockLines[0].wordIndices[0]].start;
      const lastLineIndices = blockLines[blockLines.length - 1].wordIndices;
      const blockEnd = words[lastLineIndices[lastLineIndices.length - 1]].end;
      const blockDur = blockEnd - blockStart;

      let blockProgress = 0;
      if (blockDur > 0) {
        blockProgress = Math.min(
          1,
          Math.max(0, (progress - blockStart) / blockDur),
        );
      }

      cameraY = blockStartY + (blockEndY - blockStartY) * blockProgress;
    }
  }

  // Safe Area & Margins
  const marginY = isVertical ? height * 0.18 : height * 0.1;
  const marginX = width * 0.1;
  const textHalfWidth = maxWidth / 2;
  const VISUAL_WINDOW_HEIGHT = lineHeight * 6.5;

  lines.forEach((lineMeta, lineIdx) => {
    let relativeY = lineMeta.y - cameraY;

    // Sticky Headline logic for Shorts & Landscape
    let isStickyHeadline =
      layer.positionPreference === "Top" && lineMeta.blockIdx === 0;
    if (lineMeta.isArabic) isStickyHeadline = false; // Pause sticky logic for Arabic isolation

    const aspectRatioStr = isVertical ? "9:16" : isLandscape ? "16:9" : "1:1";

    // Resolve Text Position
    let { screenCenterX, screenCenterY } = resolveTextScreenPosition(
      width,
      height,
      aspectRatioStr,
      layer.positionPreference || "Center",
      layer.customX,
      layer.customY,
      isStickyHeadline,
    );

    let drawY = screenCenterY + relativeY;
    if (isStickyHeadline) {
      relativeY = 0; // Bypass distance filters
      drawY = screenCenterY + (lineMeta.y - lines[0].y) * 1.4; // Multi-line headline spacing
    } else {
      if (Math.abs(relativeY) > VISUAL_WINDOW_HEIGHT) return;
    }

    // Focus mode / Arabic Isolation / horizontal anim: completely hide other blocks
    if (
      !isStickyHeadline &&
      (isFocusMode || isHorizontalAnim || lineMeta.isArabic || isArabicBlock) &&
      lineMeta.blockIdx !== activeBlockIdx
    ) {
      return;
    }

    let distRatio = Math.abs(relativeY) / (lineHeight * 4.0);
    if (
      isStickyHeadline ||
      isFocusMode ||
      isHorizontalAnim ||
      lineMeta.isArabic
    )
      distRatio = 0;

    const focusFactor = Math.max(0, 1 - distRatio);
    let scale =
      (isFocusMode || isHorizontalAnim) && !isStickyHeadline
        ? 1.1
        : 0.85 + 0.15 * focusFactor;

    // Scale up the sticky headline to make it readable as the main title
    if (isStickyHeadline) {
      scale *= isLandscape ? 1.2 : 1.4; // Slightly smaller scale in landscape to avoid overflow
    }

    // For sticky headline after it is read, lower opacity slightly so it's a watermark/title
    let opacity = 0.2 + 0.8 * focusFactor;
    if (isStickyHeadline && activeBlockIdx > 0) {
      opacity = 0.9;
    }

    // Slide-in/Fade-out for Focus Mode & Horizontal Anim
    if (!isStickyHeadline && (isFocusMode || isHorizontalAnim)) {
      const blockLines = lines.filter((l) => l.blockIdx === activeBlockIdx);
      const blockStartT = words[blockLines[0].wordIndices[0]].start;
      const lastLineIndices = blockLines[blockLines.length - 1].wordIndices;
      const blockEndT = words[lastLineIndices[lastLineIndices.length - 1]].end;
      const blockDur = blockEndT - blockStartT;

      const slideInP = Math.min(
        1,
        Math.max(0, (progress - blockStartT) / Math.min(0.05, blockDur * 0.2)),
      ); // 5% of video or 20% of block fade in

      const slideOutP = Math.min(
        1,
        Math.max(0, (blockEndT - progress) / Math.min(0.05, blockDur * 0.2)),
      ); // 5% of video or 20% of block fade out

      opacity *= slideInP * slideOutP;
    }

    ctx.save();
    ctx.translate(screenCenterX + cameraX, drawY);
    ctx.scale(scale, scale);

    lineMeta.wordIndices.forEach((wIdx) => {
      const w = words[wIdx];
      const isWordActive = activeIdx === wIdx;

      ctx.save();
      ctx.translate(w.relativeX, 0);

      ctx.globalAlpha = opacity;

      // Animation scaling
      if (isWordActive) {
        const wp = Math.max(
          0,
          Math.min(1, (progress - w.start) / Math.max(0.001, w.end - w.start)),
        );
        const isGap = progress > w.end;

        if (!isGap) {
          if (isVertical) {
            // High-impact jump for Shorts
            const pulse = 1.0 + 0.15 * Math.sin(wp * Math.PI);
            const rise = Math.sin(wp * Math.PI) * -(baseFontSize * 0.15); // moves up
            ctx.translate(0, rise);
            ctx.scale(pulse, pulse);
          } else {
            // Very subtle scale for Long-form
            const pulse = 1.0 + 0.02 * Math.sin(wp * Math.PI);
            ctx.scale(pulse, pulse);
          }
        }
      }

      // Pass 1: The Outline/Stroke
      ctx.strokeStyle = "rgba(18, 18, 18, 0.95)";
      ctx.lineJoin = "round";
      ctx.lineWidth = isVertical ? 12 : 6;
      ctx.strokeText(w.text, 0, 0);

      // Pass 2 & 3: Fill
      if (isWordActive) {
        const gradient = ctx.createLinearGradient(
          0,
          -baseFontSize / 2,
          0,
          baseFontSize / 2,
        );
        gradient.addColorStop(0, "#FFF5C0"); // bright champagne gold
        gradient.addColorStop(1, "#FFD700"); // rich golden yellow

        ctx.fillStyle = gradient;

        if (isVertical) {
          ctx.shadowColor = "rgba(255, 215, 0, 0.5)";
          ctx.shadowBlur = 12;
        } else {
          ctx.shadowBlur = 0;
        }
      } else {
        // Inactive Fill
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowBlur = 0;

        // For inactive words that are past, maybe we drop their opacity slightly for better visual hierarchy?
        // Let's keep it simple and clean as requested, white solid.
        // Wait, if it's already read, we can lower opacity. Let's do nothing extra if not asked, except maybe 0.7 for past words.
        if (activeIdx > wIdx && !isStickyHeadline) {
          // isWordPast
          ctx.globalAlpha = opacity * 0.8;
        }
      }

      ctx.fillText(w.text, 0, 0);

      // Reset shadow immediately after
      ctx.shadowBlur = 0;
      ctx.restore();
    });
    ctx.restore();
  });
};

const renderTextLayer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: any,
  time: number,
) => {
  if (time < layer.startTime || time > layer.endTime) return;
  const duration = layer.endTime - layer.startTime;
  const localTime = time - layer.startTime;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${layer.fontSize}px Inter, sans-serif`;
  ctx.fillStyle = layer.color;
  let alpha = 1;
  let scale = 1;
  let offsetY = 0;
  if (layer.animation === "fade") {
    if (localTime < 0.5) alpha = localTime / 0.5;
    else if (duration - localTime < 0.5) alpha = (duration - localTime) / 0.5;
  } else if (layer.animation === "slide") {
    if (localTime < 0.5) offsetY = (1 - localTime / 0.5) * 50;
  } else if (layer.animation === "bounce") {
    scale = 1 + 0.1 * Math.sin(localTime * 10);
  } else if (layer.animation === "typewriter") {
    const charsToShow = Math.floor(
      layer.text.length * Math.min(1, localTime / (duration * 0.5)),
    );
    ctx.fillText(
      layer.text.substring(0, charsToShow),
      width * layer.x,
      height * layer.y + offsetY,
    );
    ctx.restore();
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.translate(width * layer.x, height * layer.y + offsetY);
  ctx.scale(scale, scale);
  ctx.fillText(layer.text, 0, 0);
  ctx.restore();
};

const renderMediaLayer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: any, // MediaLayer
  time: number,
  loadedAssetsRef:
    | React.MutableRefObject<Map<string, HTMLImageElement | HTMLVideoElement>>
    | Map<string, HTMLImageElement | HTMLVideoElement>,
) => {
  if (time < layer.startTime || time > layer.endTime) return;

  let element = null;

  if (loadedAssetsRef instanceof Map) {
    element = loadedAssetsRef.get(layer.id);
  } else if (loadedAssetsRef && loadedAssetsRef.current) {
    element = loadedAssetsRef.current.get(layer.id);
  }

  if (!element) return;

  ctx.save();
  const elWidth =
    element instanceof HTMLVideoElement
      ? element.videoWidth
      : (element as HTMLImageElement).width;
  const elHeight =
    element instanceof HTMLVideoElement
      ? element.videoHeight
      : (element as HTMLImageElement).height;

  if (elWidth > 0 && elHeight > 0) {
    const bgAspect = elWidth / elHeight;
    const canvasAspect = width / height;
    let renderWidth, renderHeight, x, y;

    // Cover mode by default for media layers used as scenes
    if (bgAspect > canvasAspect) {
      renderHeight = height;
      renderWidth = height * bgAspect;
      x = (width - renderWidth) / 2;
      y = 0;
    } else {
      renderWidth = width;
      renderHeight = width / bgAspect;
      x = 0;
      y = (height - renderHeight) / 2;
    }

    // Add fade transitions
    const localTime = time - layer.startTime;
    const duration = layer.endTime - layer.startTime;
    let alpha = 1;
    if (localTime < 0.5) alpha = localTime / 0.5;
    else if (duration - localTime < 0.5) alpha = (duration - localTime) / 0.5;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    ctx.drawImage(element, x, y, renderWidth, renderHeight);
  }
  ctx.restore();
};

const renderImageLayer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: any,
  time: number,
) => {
  if (time < layer.startTime || time > layer.endTime) return;
  const localTime = time - layer.startTime;
  const duration = layer.endTime - layer.startTime;
  const img = new Image();
  img.src = layer.url;
  if (!img.complete) return;
  ctx.save();
  let scale = layer.scale;
  let alpha = 1;
  if (layer.animation === "zoom") scale *= 1 + 0.2 * (localTime / duration);
  else if (layer.animation === "fade")
    alpha =
      Math.min(1, localTime / 0.5) * Math.min(1, (duration - localTime) / 0.5);
  ctx.globalAlpha = alpha;
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  ctx.drawImage(
    img,
    width * layer.x - drawW / 2,
    height * layer.y - drawH / 2,
    drawW,
    drawH,
  );
  ctx.restore();
};

interface LoadedBackgroundAsset {
  element: HTMLImageElement | HTMLVideoElement;
  type: "image" | "video";
  id: string;
}

const drawBackgroundSlideshow = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bgAssets: LoadedBackgroundAsset[],
  currentTime: number,
  totalDuration: number,
  bgAnim: BackgroundAnimation,
) => {
  if (bgAssets.length === 0) return;

  const slideDuration = Math.max(2, totalDuration / bgAssets.length);
  const totalSlides = bgAssets.length;

  let slideIndex = Math.floor(currentTime / slideDuration);
  if (slideIndex >= totalSlides) slideIndex = totalSlides - 1;

  const currentAsset = bgAssets[slideIndex];
  const timeInSlide = currentTime - slideIndex * slideDuration;
  const fadeDuration = 1.0;
  const remainingTime = slideDuration - timeInSlide;

  let nextAsset: LoadedBackgroundAsset | null = null;
  let crossFadeOpacity = 0;

  if (remainingTime < fadeDuration && slideIndex < totalSlides - 1) {
    nextAsset = bgAssets[slideIndex + 1];
    crossFadeOpacity = 1 - remainingTime / fadeDuration;
  }

  const drawSingleBg = (
    asset: LoadedBackgroundAsset,
    opacity: number,
    progressForAnim: number,
  ) => {
    const bg = asset.element;
    const bgW = bg instanceof HTMLVideoElement ? bg.videoWidth : bg.width;
    const bgH = bg instanceof HTMLVideoElement ? bg.videoHeight : bg.height;

    if (bgW > 0) {
      // --- WATER FLOW ANIMATION ---
      if (bgAnim === BackgroundAnimation.WATER_FLOW) {
        const numSlices = 80;
        const sliceHeight = height / numSlices;

        const scale = Math.max(width / bgW, height / bgH) * 1.15; // Zoom in to allow movement
        const drawW = bgW * scale;
        const drawH = bgH * scale;
        const startX = (width - drawW) / 2;
        const startY = (height - drawH) / 2;

        const amplitude = width * 0.04; // Stronger wave
        const frequency = 0.08; // Tighter wave
        const speed = 5.0; // Faster wave

        ctx.save();
        ctx.globalAlpha = 0.8 * opacity; // less transparent

        for (let i = 0; i < numSlices; i++) {
          // Calculate sine wave X-offset based on Y-position and Time
          const offset =
            Math.sin(i * frequency + currentTime * speed) * amplitude;

          // Define horizontal slice on Canvas
          const dy = i * sliceHeight;
          const dh = sliceHeight + 1.5; // Slight overlap to fix sub-pixel gaps

          // Map canvas slice back to Source Image coordinates
          // Relative Y in the drawn image
          const relativeY = dy - startY;
          const sy = relativeY / scale;
          const sh = dh / scale;

          // Safety check for source bounds
          if (sy >= 0 && sy + sh <= bgH) {
            ctx.drawImage(
              bg,
              0,
              sy,
              bgW,
              sh, // Source: Full width strip
              startX + offset,
              dy,
              drawW,
              dh, // Dest: Shifted X
            );
          }
        }
        ctx.restore();
        return;
      }

      // --- STANDARD ANIMATIONS ---
      let baseScale = Math.max(width / bgW, height / bgH);
      let animScale = 1.0;
      let animX = 0;
      let animY = 0;

      // Resolve RANDOM to a specific animation based on the slide index
      let activeAnim: BackgroundAnimation = bgAnim;
      if (activeAnim === BackgroundAnimation.RANDOM) {
        const animOptions: BackgroundAnimation[] = [
          BackgroundAnimation.ZOOM_IN,
          BackgroundAnimation.PAN_LEFT,
          BackgroundAnimation.CINEMATIC_3D,
          BackgroundAnimation.ZOOM_OUT,
          BackgroundAnimation.PAN_RIGHT,
          BackgroundAnimation.PAN_UP,
          BackgroundAnimation.PAN_DOWN,
        ];
        activeAnim = animOptions[slideIndex % animOptions.length];
      }

      switch (activeAnim) {
        case BackgroundAnimation.ZOOM_IN:
          animScale = 1.0 + progressForAnim * 0.40; // High movement zoom in
          break;
        case BackgroundAnimation.ZOOM_OUT:
          animScale = 1.40 - progressForAnim * 0.40; // High movement zoom out
          break;
        case BackgroundAnimation.CINEMATIC_3D:
          // Simulate 3D parallax: Dramatic zoom + pan
          animScale = 1.2 + progressForAnim * 0.40;
          animX =
            (slideIndex % 2 === 0 ? -1 : 1) * (progressForAnim * width * 0.20);
          animY =
            (slideIndex % 3 === 0 ? -1 : 1) * (progressForAnim * height * 0.15);
          break;
        case BackgroundAnimation.PAN_LEFT:
          animScale = 1.5;
          animX = -(progressForAnim * width * 0.35); // Big sweep left
          break;
        case BackgroundAnimation.PAN_RIGHT:
          animScale = 1.5;
          animX = progressForAnim * width * 0.35 - width * 0.35; // Big sweep right
          break;
        case BackgroundAnimation.PAN_UP:
          animScale = 1.5;
          animY = -(progressForAnim * height * 0.35); // Big sweep up
          break;
        case BackgroundAnimation.PAN_DOWN:
          animScale = 1.5;
          animY = progressForAnim * height * 0.35 - height * 0.35; // Big sweep down
          break;
      }

      ctx.save();
      ctx.globalAlpha = 0.85 * opacity;
      const finalScale = baseScale * animScale;
      const drawWidth = bgW * finalScale;
      const drawHeight = bgH * finalScale;
      const x = (width - drawWidth) / 2 + animX;
      const y = (height - drawHeight) / 2 + animY;

      ctx.drawImage(bg, x, y, drawWidth, drawHeight);
      ctx.restore();
    }
  };

  const currentSlideProgress = timeInSlide / slideDuration;
  drawSingleBg(currentAsset, 1, currentSlideProgress);

  if (nextAsset && crossFadeOpacity > 0) {
    drawSingleBg(nextAsset, crossFadeOpacity, 0);
  }
};

export const drawVideoFrame = (
  canvas: HTMLCanvasElement,
  bgAssets: LoadedBackgroundAsset[],
  layers: EditorLayer[],
  currentTime: number,
  totalDuration: number,
  bgAnim: BackgroundAnimation = BackgroundAnimation.NONE,
  layoutCache?: LayoutCache,
  loadedAssetsMap?: Map<string, HTMLImageElement | HTMLVideoElement>,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;

  // Main Content Rendering
  const contentTime = currentTime;
  const contentDuration = Math.max(0.1, totalDuration);

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, width, height);

  drawBackgroundSlideshow(
    ctx,
    width,
    height,
    bgAssets,
    contentTime,
    contentDuration,
    bgAnim,
  );

  // Cinematic Particles / Dust animation
  ctx.save();

  // God Rays
  ctx.globalCompositeOperation = "screen";
  const numRays = 5;
  for (let r = 0; r < numRays; r++) {
    const angle = Math.PI / 4 + Math.sin(contentTime * 0.2 + r) * 0.1; // sweeping slowly
    const rayWidth =
      width * 0.1 + Math.abs(Math.sin(contentTime * 0.5 + r)) * (width * 0.2);
    const opacity = (Math.sin(contentTime * 0.8 + r * 2.1) * 0.5 + 0.5) * 0.15;

    ctx.save();
    ctx.translate(width * 0.2 + r * width * 0.15, -height * 0.1);
    ctx.rotate(angle);
    const rayGrad = ctx.createLinearGradient(0, 0, 0, height * 1.5);
    rayGrad.addColorStop(0, `rgba(255, 240, 200, ${opacity})`);
    rayGrad.addColorStop(1, `rgba(255, 240, 200, 0)`);
    ctx.fillStyle = rayGrad;
    ctx.fillRect(-rayWidth / 2, 0, rayWidth, height * 1.5);
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";

  const particleCount = 100;
  for (let i = 0; i < particleCount; i++) {
    const seedX = Math.sin(i * 345.67) * 0.5 + 0.5;
    const seedY = Math.cos(i * 765.43) * 0.5 + 0.5;
    const speedX = Math.sin(i * 11.1) * 15 + (width > height ? 10 : 5);
    const speedY = Math.cos(i * 22.2) * 10 - 20; // moving up slightly

    const x =
      (((seedX * width + contentTime * speedX) % width) + width) % width;
    const y =
      (((seedY * height + contentTime * speedY) % height) + height) % height;

    const size = (Math.sin(i * 44.4) * 0.5 + 0.5) * (width * 0.001) + 0.5;
    const opacity = (Math.sin(contentTime * 1.5 + i) * 0.5 + 0.5) * 0.35 + 0.05;

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`; // clear particles
    ctx.fill();

    ctx.shadowBlur = 0; // removed blur
    ctx.shadowColor = `transparent`;
  }
  ctx.restore();

  // Vignette for Cinematic Effect (Reduced darkness to keep background clear)
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    height * 0.1,
    width / 2,
    height / 2,
    height * 1.0,
  );
  vignette.addColorStop(0, "rgba(2, 6, 23, 0.0)");
  vignette.addColorStop(0.6, "rgba(2, 6, 23, 0.2)");
  vignette.addColorStop(1, "rgba(2, 6, 23, 0.6)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  sortedLayers.forEach((layer) => {
    if (!layer.visible) return;
    if (layer.type === LayerType.NARRATION) {
      renderNarrationLayer(
        ctx,
        width,
        height,
        layer,
        currentTime / totalDuration,
        totalDuration,
        layoutCache,
      );
    } else if (layer.type === LayerType.TEXT) {
      renderTextLayer(ctx, width, height, layer, currentTime);
    } else if (
      layer.type === LayerType.IMAGE ||
      layer.type === LayerType.VIDEO
    ) {
      // NOTE: use provided loadedAssetsMap or fallback to bgAssets
      const loadMap =
        loadedAssetsMap || new Map(bgAssets.map((b) => [b.id, b.element]));
      renderMediaLayer(ctx, width, height, layer, currentTime, loadMap);
    }
  });

  // Branding Watermark
};

export const createCompositeThumbnail = async (
  imageUrl: string,
  overlayText: string,
  styleCategory: string,
  colorPop: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;

  await new Promise((resolve) => {
    if (img.complete) resolve(true);
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });

  const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
  const x = canvas.width / 2 - (img.width / 2) * scale;
  const y = canvas.height / 2 - (img.height / 2) * scale;
  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

  const isTech = styleCategory.toLowerCase().includes("tech");
  const isStory = styleCategory.toLowerCase().includes("storytelling");
  const isRelig =
    styleCategory.toLowerCase().includes("religious") ||
    styleCategory.toLowerCase().includes("urdu");

  // Vignette / Gradient based on style
  if (isTech) {
    // Tech: Neon glow edge
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "rgba(0,0,0,0.8)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.4)");
    grad.addColorStop(1, "rgba(0,0,0,0.8)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = colorPop;
    ctx.lineWidth = 15;
    ctx.shadowColor = colorPop;
    ctx.shadowBlur = 50;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.shadowBlur = 0;
  } else if (isStory) {
    // Story: Heavy vignette
    const radial = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      canvas.height * 0.2,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.8,
    );
    radial.addColorStop(0, "rgba(0,0,0,0)");
    radial.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    // Brand Kit Guidelines: Deep Navy Fade
    const isLandscape = canvas.width > canvas.height;

    if (isLandscape) {
      // Landscape: Darker on the right for text
      const rightGrad = ctx.createLinearGradient(
        canvas.width * 0.4,
        0,
        canvas.width,
        0,
      );
      rightGrad.addColorStop(0, "rgba(8, 20, 32, 0)"); // Deep Navy
      rightGrad.addColorStop(1, "rgba(8, 20, 32, 0.95)");
      ctx.fillStyle = rightGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      // Vertical: Darker on the top for text
      const topGrad = ctx.createLinearGradient(0, canvas.height * 0.4, 0, 0);
      topGrad.addColorStop(0, "rgba(8, 20, 32, 0)");
      topGrad.addColorStop(1, "rgba(8, 20, 32, 0.95)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Also a slight dark fade at bottom for watermark
      const bottomGrad = ctx.createLinearGradient(
        0,
        canvas.height * 0.8,
        0,
        canvas.height,
      );
      bottomGrad.addColorStop(0, "rgba(8, 20, 32, 0)");
      bottomGrad.addColorStop(1, "rgba(8, 20, 32, 0.8)");
      ctx.fillStyle = bottomGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // Draw overlay text
  if (overlayText) {
    const isLandscape = canvas.width > canvas.height;
    const scaleRef = isLandscape ? canvas.height * 1.45 : canvas.width;
    const fontSize = Math.floor(scaleRef * 0.12);

    // Choose font stack based on style
    let fontStack = `"Inter", sans-serif`;
    if (isRelig || isRTL(overlayText)) {
      fontStack = `"Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Amiri", "Gulzar", "Inter", sans-serif`;
    }

    ctx.font = `900 ${fontSize}px ${fontStack}`;

    // Positional alignments
    let textAlign = isLandscape && (isRelig || !isTech) ? "right" : "center";
    ctx.textAlign = textAlign as CanvasTextAlign;
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";

    const words = overlayText.split(" ");
    let lines: string[] = [];
    let currentLine = words[0] || "";

    const maxWidth = isLandscape ? canvas.width * 0.5 : canvas.width * 0.88;
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;
      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    const lineHeight = fontSize * 1.6;
    let startY = 0;

    if (isLandscape && (isRelig || !isTech)) {
      // Center vertically on the right
      const totalHeight = lines.length * lineHeight;
      startY = canvas.height / 2 - totalHeight / 2 + fontSize / 2;
    } else if (!isLandscape && (isRelig || !isTech)) {
      // Top alignment for vertical reels
      startY = canvas.height * 0.15 + fontSize / 2;
    } else {
      startY = canvas.height * (isLandscape ? 0.18 : 0.12) + fontSize / 2;
    }

    lines.forEach((line, i) => {
      const lineY = startY + i * lineHeight;
      const textWidth = ctx.measureText(line).width;

      let drawX = canvas.width / 2;
      if (ctx.textAlign === "right") {
        drawX = canvas.width * 0.92;
      }

      ctx.save();

      if (isTech) {
        // Neon text
        ctx.shadowBlur = 30;
        ctx.shadowColor = colorPop;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(line, drawX, lineY);

        // Core
        ctx.shadowBlur = 0;
        ctx.lineWidth = fontSize * 0.05;
        ctx.strokeStyle = "#000000";
        ctx.strokeText(line, drawX, lineY);
      } else if (isStory) {
        // Intense drop shadow, huge impact, no box
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 15;
        ctx.fillStyle = colorPop;
        if (i % 2 === 0) ctx.fillStyle = "#ffffff"; // alternate colors

        ctx.lineWidth = fontSize * 0.1;
        ctx.strokeStyle = "#000000";
        ctx.strokeText(line, drawX, lineY);
        ctx.fillText(line, drawX, lineY);
      } else {
        // Brand Kit: Islamic Wisdom Style
        const isGold = i % 2 !== 0; // Alternate sizes/colors

        ctx.fillStyle = isGold ? "#FFD700" : "#FFFFFF";

        ctx.shadowColor = isGold ? "rgba(255, 215, 0, 0.3)" : "rgba(0,0,0,0.7)";
        ctx.shadowBlur = isGold ? 20 : 15;
        ctx.shadowOffsetY = 8;

        ctx.lineWidth = fontSize * 0.08;
        ctx.strokeStyle = "#020617"; // Very dark navy/black
        ctx.strokeText(line, drawX, lineY);
        ctx.fillText(line, drawX, lineY);
      }
      ctx.restore();
    });
  }

  const brandSize = Math.max(16, canvas.width * 0.03);
  ctx.font = `bold ${brandSize}px "Inter", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.shadowBlur = 0;
  ctx.textAlign = "right";
  ctx.fillText(
    "LifeBeauty • Islamic Wisdom",
    canvas.width - brandSize * 1.5,
    brandSize * 2.5,
  );

  return canvas.toDataURL("image/png", 0.9);
};
