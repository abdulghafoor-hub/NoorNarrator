export function createReverb(
  ctx: AudioContext,
  seconds: number = 1.5,
  decay: number = 2.0,
): ConvolverNode {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * seconds;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const factor = Math.pow(1 - i / length, decay);
    left[i] = (Math.random() * 2 - 1) * factor;
    right[i] = (Math.random() * 2 - 1) * factor;
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  return convolver;
}

export function createSpiritualStudioChain(
  ctx: AudioContext,
  source: AudioNode,
  dest: AudioNode,
) {
  // 1. Equalizer for Voice (Low-end boost)
  const eq = ctx.createBiquadFilter();
  eq.type = "lowshelf";
  eq.frequency.value = 150; // Hz
  eq.gain.value = 4; // Boost bass slightly (dB)

  // 2. Reverb
  const convolver = createReverb(ctx, 1.0, 3.0); // short decay
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.08; // 8% wet mix

  // 3. Dry/Wet Mix
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1.0;

  // Build Graph
  source.connect(eq);

  eq.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(dest);

  eq.connect(dryGain);
  dryGain.connect(dest);

  return { eq, dryGain, reverbGain };
}

export interface VoiceSegment {
  start: number;
  end: number;
}

export function analyzeVoiceActivity(
  buffer: AudioBuffer,
  threshold = 0.02,
  minSilenceS = 0.4,
): VoiceSegment[] {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const minSilenceSamples = sampleRate * minSilenceS;

  let inVoice = false;
  let voiceStart = 0;
  let silenceCounter = 0;
  const segments: VoiceSegment[] = [];

  for (let i = 0; i < channelData.length; i++) {
    if (Math.abs(channelData[i]) > threshold) {
      if (!inVoice) {
        inVoice = true;
        voiceStart = i;
      }
      silenceCounter = 0;
    } else {
      if (inVoice) {
        silenceCounter++;
        if (silenceCounter > minSilenceSamples) {
          inVoice = false;
          segments.push({
            start: voiceStart / sampleRate,
            end: (i - silenceCounter) / sampleRate,
          });
        }
      }
    }
  }

  if (inVoice) {
    segments.push({
      start: voiceStart / sampleRate,
      end: (channelData.length - silenceCounter) / sampleRate,
    });
  }

  return segments;
}

export function applyAudioDucking(
  bgmGain: GainNode,
  baseVolume: number,
  voiceSegments: VoiceSegment[],
  startTime: number,
) {
  const t = bgmGain.context.currentTime;
  // Initialize to full volume before voice starts
  bgmGain.gain.setValueAtTime(baseVolume, t);

  voiceSegments.forEach((seg) => {
    const startT = startTime + seg.start;
    const endT = startTime + seg.end;

    // Ramp down to 10-12% before voice starts
    bgmGain.gain.setTargetAtTime(baseVolume * 0.12, startT - 0.2, 0.1);

    // Ramp back up to Bridge Rule (25%) after voice ends
    bgmGain.gain.setTargetAtTime(baseVolume * 0.25, endT, 0.3);
  });
}
