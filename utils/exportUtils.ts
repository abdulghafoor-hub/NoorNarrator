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

  // Codec discovery to prevent "Encoder creation error"
  let chosenVideoCodec = "";
  let muxerVideoCodec: "avc" | "hevc" | "vp9" | "av1" = "avc";
  
  const videoCodecCandidates = [
    { codec: "avc1.42e01f", muxerCodec: "avc" }, // H.264 Baseline, level 3.1 (Most widely supported)
    { codec: "avc1.4d001f", muxerCodec: "avc" }, // H.264 Main, level 3.1
    { codec: "avc1.4d002a", muxerCodec: "avc" }, // H.264 Main, level 4.2
    { codec: "avc1.64002a", muxerCodec: "avc" }, // H.264 High, level 4.2
    { codec: "avc1.42E028", muxerCodec: "avc" },
    { codec: "vp09.00.10.08", muxerCodec: "vp9" }, // VP9
    { codec: "vp8", muxerCodec: "vp9" },
    { codec: "av01.0.04M.08", muxerCodec: "av1" }, // AV1
  ] as const;

  for (const candidate of videoCodecCandidates) {
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width: encWidth,
      height: encHeight,
      bitrate: 5_000_000,
      framerate: fps,
      ...(candidate.muxerCodec === "avc" ? { avc: { format: "avc" } } : {}),
    };
    try {
      const support = await window.VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        chosenVideoCodec = candidate.codec;
        muxerVideoCodec = candidate.muxerCodec;
        break;
      }
    } catch (e) {
      // Ignore and try next candidate
    }
  }

  if (!chosenVideoCodec) {
    chosenVideoCodec = "avc1.42e01f";
    muxerVideoCodec = "avc";
  }

  let chosenAudioCodec = "";
  let muxerAudioCodec: "aac" | "opus" = "aac";

  const audioCodecCandidates = [
    { codec: "mp4a.40.2", muxerCodec: "aac" }, // AAC-LC
    { codec: "mp4a.40.5", muxerCodec: "aac" }, // HE-AAC
    { codec: "opus", muxerCodec: "opus" },
  ] as const;

  if (audioBuffer) {
    for (const candidate of audioCodecCandidates) {
      const config: AudioEncoderConfig = {
        codec: candidate.codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      };
      try {
        const support = await window.AudioEncoder.isConfigSupported(config);
        if (support.supported) {
          chosenAudioCodec = candidate.codec;
          muxerAudioCodec = candidate.muxerCodec;
          break;
        }
      } catch (e) {
        // Ignore and try next
      }
    }
    if (!chosenAudioCodec) {
      chosenAudioCodec = "mp4a.40.2";
      muxerAudioCodec = "aac";
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    video: {
      codec: muxerVideoCodec,
      width: encWidth,
      height: encHeight,
    },
    audio: audioBuffer
      ? {
          codec: muxerAudioCodec,
          sampleRate: 48000,
          numberOfChannels: 2,
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
    codec: chosenVideoCodec,
    width: encWidth,
    height: encHeight,
    bitrate: 5_000_000,
    framerate: fps,
    ...(muxerVideoCodec === "avc" ? { avc: { format: "avc" } } : {}),
  };

  videoEncoder.configure(videoConfig);

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

    const audioConfig: AudioEncoderConfig = {
      codec: chosenAudioCodec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    };

    audioEncoder.configure(audioConfig);
  }

  const totalFrames = Math.ceil(duration * fps);

  // Audio state
  let audioOffset = 0;
  const sampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
  const channels = audioBuffer ? audioBuffer.numberOfChannels : 2;
  const length = audioBuffer ? audioBuffer.length : 0;
  
  // Use exactly 1 second of frames per chunk so timestamp calculations 
  // produce perfectly round integers to avoid AAC WebCodecs bugs
  const CHUNK_FRAMES = sampleRate; 

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
