import { Muxer, ArrayBufferTarget } from "mp4-muxer";

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
      codec: "avc",
      width,
      height,
    },
    audio: audioBuffer
      ? {
          codec: "aac",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
        }
      : undefined,
  });

  let videoError: any = null;
  const videoEncoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta as any),
    error: (e) => {
      console.error("Video encoding error", e);
      videoError = e;
    },
  });

  videoEncoder.configure({
    codec: "avc1.4d002a",
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps,
    avc: { format: "avc" },
  });

  let audioEncoder: any = null;
  let audioError: any = null;

  if (audioBuffer) {
    audioEncoder = new window.AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta as any),
      error: (e) => {
        console.error("Audio encoding error", e);
        audioError = e;
      },
    });

    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate: 128_000,
    });
  }

  const totalFrames = Math.ceil(duration * fps);

  // Audio state
  let audioOffset = 0;
  const sampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
  const channels = audioBuffer ? audioBuffer.numberOfChannels : 2;
  const length = audioBuffer ? audioBuffer.length : 0;
  const CHUNK_FRAMES = 48000 * 0.1; // 100ms chunks

  for (let i = 0; i < totalFrames; i++) {
    if (videoError) throw videoError;
    if (audioError) throw audioError;

    const time = i / fps;

    // 1. Encode Audio up to this time
    if (audioEncoder && audioBuffer) {
      while (
        audioOffset < length &&
        audioOffset / sampleRate <= time + 1 / fps
      ) {
        if (audioEncoder.encodeQueueSize > 50) {
          await new Promise((r) => setTimeout(r, 0));
        }

        const end = Math.min(audioOffset + CHUNK_FRAMES, length);
        const frameCount = end - audioOffset;

        const f32Arrays = [];
        for (let c = 0; c < channels; c++) {
          f32Arrays.push(audioBuffer.getChannelData(c).slice(audioOffset, end));
        }
        const combined = new Float32Array(frameCount * channels);
        for (let c = 0; c < channels; c++) {
          combined.set(f32Arrays[c], c * frameCount);
        }

        const audioData = new window.AudioData({
          format: "f32-planar",
          sampleRate,
          numberOfFrames: frameCount,
          numberOfChannels: channels,
          timestamp: Math.round((audioOffset / sampleRate) * 1_000_000),
          data: combined,
        });

        audioEncoder.encode(audioData);
        audioData.close();
        audioOffset += CHUNK_FRAMES;
      }
    }

    // 2. Encode Video Frame
    if (videoEncoder.encodeQueueSize > 30) {
      await new Promise((r) => setTimeout(r, 10)); // let queue drain
    }

    drawFrame(time);

    const frame = new window.VideoFrame(canvas, {
      timestamp: time * 1_000_000,
    });

    const keyFrame = i % fps === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    if (i % 5 === 0) {
      onProgress(i / totalFrames);
      await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
  }

  // Final drain for remaining audio
  if (audioEncoder && audioBuffer && audioOffset < length) {
    while (audioOffset < length) {
      if (audioError) throw audioError;

      const end = Math.min(audioOffset + CHUNK_FRAMES, length);
      const frameCount = end - audioOffset;

      const f32Arrays = [];
      for (let c = 0; c < channels; c++) {
        f32Arrays.push(audioBuffer.getChannelData(c).slice(audioOffset, end));
      }
      const combined = new Float32Array(frameCount * channels);
      for (let c = 0; c < channels; c++) {
        combined.set(f32Arrays[c], c * frameCount);
      }

      const audioData = new window.AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: channels,
        timestamp: Math.round((audioOffset / sampleRate) * 1_000_000),
        data: combined,
      });

      audioEncoder.encode(audioData);
      audioData.close();
      audioOffset += CHUNK_FRAMES;
    }
  }

  onProgress(0.99);

  await videoEncoder.flush();
  videoEncoder.close();

  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
  }

  muxer.finalize();
  onProgress(1.0);
  return new Blob([target.buffer], { type: "video/mp4" });
};
