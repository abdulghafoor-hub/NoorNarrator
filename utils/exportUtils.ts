import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export const exportDeterministicVideo = async (
  canvas: HTMLCanvasElement,
  fps: number,
  duration: number,
  width: number,
  height: number,
  drawFrame: (time: number) => void,
  rawAudioBuffer: AudioBuffer | null,
  onProgress: (progress: number) => void,
): Promise<Blob> => {
  let audioBuffer = rawAudioBuffer;

  // 1. Fully Sanitize and Prep Audio Buffer (The fix for Speed/Encoding Errors)
  if (audioBuffer) {
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        let val = data[i];
        if (!Number.isFinite(val)) data[i] = 0;
        else if (val > 1.0) data[i] = 1.0;
        else if (val < -1.0) data[i] = -1.0;
      }
    }

    const targetSampleRate = 48000;
    const targetChannels = 2; 
    const offlineCtx = new window.OfflineAudioContext(
      targetChannels,
      Math.ceil(audioBuffer.length * (targetSampleRate / audioBuffer.sampleRate)),
      targetSampleRate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    audioBuffer = await offlineCtx.startRendering();
  }

  const encWidth = width & ~1;
  const encHeight = height & ~1;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    video: {
      codec: "avc",
      width: encWidth,
      height: encHeight,
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

  const videoConfig: VideoEncoderConfig = {
    codec: "avc1.4d002a",
    width: encWidth,
    height: encHeight,
    bitrate: 5_000_000,
    framerate: fps,
    avc: { format: "avc" },
  };

  const videoSupport = await window.VideoEncoder.isConfigSupported(videoConfig);
  if (!videoSupport.supported) {
    videoConfig.codec = "avc1.42E028";
  }

  videoEncoder.configure(videoConfig);

  let audioEncoder: any = null;
  let audioError: any = null;

  let finalAudioBuffer = audioBuffer;
  if (audioBuffer) {
    const offlineCtx = new OfflineAudioContext(
      2,
      audioBuffer.duration * 48000,
      48000
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    finalAudioBuffer = await offlineCtx.startRendering();
  }

  if (finalAudioBuffer) {
    audioEncoder = new window.AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta as any),
      error: (e) => {
        console.error("Audio encoding error", e);
        audioError = e;
      },
    });

    const audioConfig: AudioEncoderConfig = {
      codec: "mp4a.40.2",
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    };

    const audioSupport = await window.AudioEncoder.isConfigSupported(audioConfig);
    if (!audioSupport.supported) {
      audioConfig.codec = "mp4a.40.5"; 
    }
    audioEncoder.configure(audioConfig);
  }

  const totalFrames = Math.ceil(duration * fps);

  // Audio state
  let audioOffset = 0;
  const sampleRate = finalAudioBuffer ? finalAudioBuffer.sampleRate : 48000;
  const channels = finalAudioBuffer ? finalAudioBuffer.numberOfChannels : 2;
  const length = finalAudioBuffer ? finalAudioBuffer.length : 0;
  
  // Use exactly 1 second of frames per chunk so timestamp calculations 
  // produce perfectly round integers to avoid AAC WebCodecs bugs
  const CHUNK_FRAMES = sampleRate; 

  for (let i = 0; i < totalFrames; i++) {
    if (videoError) throw videoError;
    if (audioError) throw audioError;

    const time = i / fps;

    // 1. Encode Audio up to this time
    if (audioEncoder && finalAudioBuffer) {
      while (
        audioOffset < length &&
        audioOffset / sampleRate <= time + 1 / fps
      ) {
        if (audioEncoder.state !== "configured") {
          throw new Error(`Audio Encoder is closed: ${audioError?.message || "Unknown error"}`);
        }

        // Backpressure validation
        while (audioEncoder.encodeQueueSize > 50) {
          await new Promise((r) => setTimeout(r, 10));
          if (audioError) throw audioError;
        }

        const end = Math.min(audioOffset + CHUNK_FRAMES, length);
        const actualFrames = end - audioOffset;

        const f32Arrays = [];
        for (let c = 0; c < channels; c++) {
          f32Arrays.push(finalAudioBuffer.getChannelData(c).slice(audioOffset, end));
        }

        const combined = new Float32Array(actualFrames * channels);
        for(let c = 0; c < channels; c++) {
          combined.set(f32Arrays[c], c * actualFrames);
        }

        const audioData = new window.AudioData({
          format: "f32-planar",
          sampleRate,
          numberOfFrames: actualFrames,
          numberOfChannels: channels,
          timestamp: Math.round((audioOffset / sampleRate) * 1_000_000),
          data: combined,
        });

        audioEncoder.encode(audioData);
        audioData.close();
        audioOffset += actualFrames;
      }
    }

    // 2. Encode Video Frame
    if (videoEncoder.state !== "configured") {
      throw new Error(`Video Encoder is closed: ${videoError?.message || "Unknown error"}`);
    }

    while (videoEncoder.encodeQueueSize > 30) {
      await new Promise((r) => setTimeout(r, 10)); 
      if (videoError) throw videoError;
    }

    drawFrame(time);

    const frame = new window.VideoFrame(canvas, {
      timestamp: Math.round((i * 1_000_000) / fps),
    });

    const keyFrame = i % fps === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    if (i % 5 === 0) {
      onProgress(i / totalFrames);
      await new Promise((r) => setTimeout(r, 0)); // yield
    }
  }

  // 3. Final Drain for remaining audio
  if (audioEncoder && audioBuffer && audioOffset < length) {
    while (audioOffset < length) {
      if (audioError) throw audioError;

      while (audioEncoder.encodeQueueSize > 50) {
        await new Promise((r) => setTimeout(r, 10));
        if (audioError) throw audioError;
      }

      const end = Math.min(audioOffset + CHUNK_FRAMES, length);
      const actualFrames = end - audioOffset;

      const f32Arrays = [];
      for (let c = 0; c < channels; c++) {
        f32Arrays.push(audioBuffer.getChannelData(c).slice(audioOffset, end));
      }

      const combined = new Float32Array(actualFrames * channels);
      for(let c = 0; c < channels; c++) {
        combined.set(f32Arrays[c], c * actualFrames);
      }

      const audioData = new window.AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: actualFrames,
        numberOfChannels: channels,
        timestamp: Math.round((audioOffset / sampleRate) * 1_000_000),
        data: combined,
      });

      audioEncoder.encode(audioData);
      audioData.close();
      audioOffset += actualFrames;
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
