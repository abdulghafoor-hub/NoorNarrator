export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function encodeAudioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const result = new Float32Array(buffer.length * numChannels);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      result[i * numChannels + channel] = channelData[i];
    }
  }

  const dataLen = result.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(arrayBuffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(arrayBuffer);
}

export function encode(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface AudioTrimMetadata {
  startSilence: number;
  endSilence: number;
  activeDuration: number;
  totalDuration: number;
}

export function analyzeAudioSilence(
  buffer: AudioBuffer,
  threshold = 0.05,
): AudioTrimMetadata {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  let startIdx = 0;
  let endIdx = channelData.length - 1;
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms window

  // Find start
  for (let i = 0; i < channelData.length; i += windowSize) {
    let maxAmp = 0;
    for (let j = 0; j < windowSize && i + j < channelData.length; j++) {
      maxAmp = Math.max(maxAmp, Math.abs(channelData[i + j]));
    }
    if (maxAmp > threshold) {
      startIdx = Math.max(0, i - windowSize); // keep a tiny bit of buffer
      break;
    }
  }

  // Find end
  for (let i = channelData.length - windowSize; i >= 0; i -= windowSize) {
    let maxAmp = 0;
    for (let j = 0; j < windowSize && i + j < channelData.length; j++) {
      maxAmp = Math.max(maxAmp, Math.abs(channelData[i + j]));
    }
    if (maxAmp > threshold) {
      endIdx = Math.min(channelData.length - 1, i + windowSize * 2);
      break;
    }
  }

  return {
    startSilence: startIdx / sampleRate,
    endSilence: (channelData.length - 1 - endIdx) / sampleRate,
    activeDuration: Math.max(0, (endIdx - startIdx) / sampleRate),
    totalDuration: buffer.duration,
  };
}
