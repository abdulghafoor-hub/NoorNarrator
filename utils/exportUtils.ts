import { Muxer, ArrayBufferTarget } from "webm-muxer";

export const exportDeterministicVideo = async (
  canvas: HTMLCanvasElement,
  fps: number,
  duration: number,
  width: number,
  height: number,
  drawFrame: (time: number) => void,
  audioBuffer: AudioBuffer | null,
  onProgress: (progress: number) => void,
): Promise<Blob> => {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "V_VP9",
      width,
      height,
    },
    audio: audioBuffer
      ? {
          codec: "A_OPUS",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
        }
      : undefined,
  });

  const videoEncoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta as any),
    error: (e) => console.error("Video encoding error", e),
  });

  videoEncoder.configure({
    codec: "vp09.00.10.08",
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps,
  });

  const totalFrames = Math.ceil(duration * fps);

  // Encode Video Frames
  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;
    drawFrame(time);

    // Create frame
    const frame = new window.VideoFrame(canvas, {
      timestamp: time * 1_000_000, // in microseconds
    });

    // Keyframe every second
    const keyFrame = i % fps === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    if (i % 10 === 0) {
      onProgress(0.5 * (i / totalFrames));
      await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
  }

  await videoEncoder.flush();

  // Encode Audio
  if (audioBuffer) {
    const audioEncoder = new window.AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta as any),
      error: (e) => console.error("Audio encoding error", e),
    });

    audioEncoder.configure({
      codec: "opus",
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate: 128_000,
    });

    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;

    const CHUNK_FRAMES = 48000 * 0.1; // 100ms chunks

    for (let offset = 0; offset < length; offset += CHUNK_FRAMES) {
      const end = Math.min(offset + CHUNK_FRAMES, length);
      const frameCount = end - offset;

      const audioDataInit: any = {
        format: "f32-planar", // AudioData format
        sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: channels,
        timestamp: (offset / sampleRate) * 1_000_000,
      };

      const f32Arrays = [];
      for (let c = 0; c < channels; c++) {
        f32Arrays.push(audioBuffer.getChannelData(c).slice(offset, end));
      }

      // Combine into a single ArrayBuffer for data payload
      const combined = new Float32Array(frameCount * channels);
      for (let c = 0; c < channels; c++) {
        combined.set(f32Arrays[c], c * frameCount);
      }

      const audioData = new window.AudioData({
        ...audioDataInit,
        data: combined,
      });

      audioEncoder.encode(audioData);
      audioData.close();

      onProgress(0.5 + 0.5 * (offset / length));
      if (offset % (CHUNK_FRAMES * 5) === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await audioEncoder.flush();
  }

  muxer.finalize();
  return new Blob([target.buffer], { type: "video/webm" });
};
