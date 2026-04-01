import { canEncodeVideo } from 'mediabunny';
import type { VideoSettings } from '../types';

type WorkerVideoCodec = 'avc' | 'av1';
type HardwareAccelerationPreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

interface AvcLevelInfo {
  maxMacroblocks: number;
  maxBitrate: number;
  level: number;
}

interface AvcProfileVariant {
  profileIndication: number;
  profileCompatibility: number;
}

interface H264Candidate {
  bitrate: number;
  fullCodecString?: string;
  hardwareAcceleration?: HardwareAccelerationPreference;
}

interface ResolveVideoEncodingPlanOptions {
  exportCodec: VideoSettings['exportCodec'];
  width: number;
  height: number;
  bitrate: number;
  preserveAlpha?: boolean;
}

export interface ResolvedVideoEncodingPlan {
  codec: WorkerVideoCodec;
  bitrate: number;
  bitrateMode: 'constant';
  latencyMode: 'quality';
  contentHint: 'detail';
  alpha: 'discard' | 'keep';
  fullCodecString?: string;
  hardwareAcceleration?: HardwareAccelerationPreference;
}

const AVC_LEVEL_TABLE: AvcLevelInfo[] = [
  { maxMacroblocks: 99, maxBitrate: 64_000, level: 0x0a },
  { maxMacroblocks: 396, maxBitrate: 192_000, level: 0x0b },
  { maxMacroblocks: 396, maxBitrate: 384_000, level: 0x0c },
  { maxMacroblocks: 396, maxBitrate: 768_000, level: 0x0d },
  { maxMacroblocks: 396, maxBitrate: 2_000_000, level: 0x14 },
  { maxMacroblocks: 792, maxBitrate: 4_000_000, level: 0x15 },
  { maxMacroblocks: 1_620, maxBitrate: 4_000_000, level: 0x16 },
  { maxMacroblocks: 1_620, maxBitrate: 10_000_000, level: 0x1e },
  { maxMacroblocks: 3_600, maxBitrate: 14_000_000, level: 0x1f },
  { maxMacroblocks: 5_120, maxBitrate: 20_000_000, level: 0x20 },
  { maxMacroblocks: 8_192, maxBitrate: 20_000_000, level: 0x28 },
  { maxMacroblocks: 8_192, maxBitrate: 50_000_000, level: 0x29 },
  { maxMacroblocks: 8_704, maxBitrate: 50_000_000, level: 0x2a },
  { maxMacroblocks: 22_080, maxBitrate: 135_000_000, level: 0x32 },
  { maxMacroblocks: 36_864, maxBitrate: 240_000_000, level: 0x33 },
  { maxMacroblocks: 36_864, maxBitrate: 240_000_000, level: 0x34 },
  { maxMacroblocks: 139_264, maxBitrate: 240_000_000, level: 0x3c },
  { maxMacroblocks: 139_264, maxBitrate: 480_000_000, level: 0x3d },
  { maxMacroblocks: 139_264, maxBitrate: 800_000_000, level: 0x3e }
];

const H264_PROFILE_VARIANTS: AvcProfileVariant[] = [
  { profileIndication: 0x4d, profileCompatibility: 0x40 },
  { profileIndication: 0x42, profileCompatibility: 0xe0 },
  { profileIndication: 0x64, profileCompatibility: 0x00 }
];

const H264_ACCELERATION_PREFERENCES: HardwareAccelerationPreference[] = [
  'no-preference',
  'prefer-hardware',
  'prefer-software'
];

const BASE_VIDEO_PLAN: Pick<
  ResolvedVideoEncodingPlan,
  'bitrateMode' | 'latencyMode' | 'contentHint'
> = {
  bitrateMode: 'constant',
  latencyMode: 'quality',
  contentHint: 'detail'
};

const getLastItem = <T>(values: T[]) => values[values.length - 1];

const buildAvcCodecString = (
  width: number,
  height: number,
  bitrate: number,
  profile: AvcProfileVariant
) => {
  const totalMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const levelInfo =
    AVC_LEVEL_TABLE.find((entry) => totalMacroblocks <= entry.maxMacroblocks && bitrate <= entry.maxBitrate) ??
    getLastItem(AVC_LEVEL_TABLE);
  const levelHex = levelInfo.level.toString(16).padStart(2, '0');
  const profileHex = profile.profileIndication.toString(16).padStart(2, '0');
  const compatibilityHex = profile.profileCompatibility.toString(16).padStart(2, '0');
  return `avc1.${profileHex}${compatibilityHex}${levelHex}`;
};

const resolvePortableH264Bitrate = (width: number, height: number) => {
  const largestDimension = Math.max(width, height);
  if (largestDimension <= 480) return 4_000_000;
  if (largestDimension <= 720) return 8_000_000;
  if (largestDimension <= 1080) return 12_000_000;
  if (largestDimension <= 1440) return 20_000_000;
  return 35_000_000;
};

const buildH264BitrateCandidates = (width: number, height: number, requestedBitrate: number) => {
  const totalMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const bitrateCaps = AVC_LEVEL_TABLE.filter((entry) => totalMacroblocks <= entry.maxMacroblocks)
    .map((entry) => entry.maxBitrate)
    .filter((entry) => entry < requestedBitrate);
  const portableBitrate = resolvePortableH264Bitrate(width, height);
  return Array.from(
    new Set([requestedBitrate, ...bitrateCaps, portableBitrate].filter((entry) => entry >= 500_000))
  ).sort((left, right) => right - left);
};

const buildH264Candidates = (width: number, height: number, requestedBitrate: number) => {
  const candidates: H264Candidate[] = [];
  const seen = new Set<string>();
  const bitrateCandidates = buildH264BitrateCandidates(width, height, requestedBitrate);

  const pushCandidate = (candidate: H264Candidate) => {
    const key = [
      candidate.bitrate,
      candidate.fullCodecString ?? 'auto',
      candidate.hardwareAcceleration ?? 'no-preference'
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  pushCandidate({ bitrate: requestedBitrate });

  for (const hardwareAcceleration of H264_ACCELERATION_PREFERENCES) {
    for (const profile of H264_PROFILE_VARIANTS) {
      pushCandidate({
        bitrate: requestedBitrate,
        fullCodecString: buildAvcCodecString(width, height, requestedBitrate, profile),
        hardwareAcceleration
      });
    }
  }

  for (const bitrate of bitrateCandidates) {
    if (bitrate === requestedBitrate) continue;

    for (const hardwareAcceleration of H264_ACCELERATION_PREFERENCES) {
      for (const profile of H264_PROFILE_VARIANTS) {
        pushCandidate({
          bitrate,
          fullCodecString: buildAvcCodecString(width, height, bitrate, profile),
          hardwareAcceleration
        });
      }
    }

    pushCandidate({ bitrate });
  }

  return candidates;
};

const isCandidateSupported = async (
  codec: WorkerVideoCodec,
  width: number,
  height: number,
  candidate: H264Candidate,
  alpha: 'discard' | 'keep'
) =>
  canEncodeVideo(codec, {
    width,
    height,
    bitrate: candidate.bitrate,
    alpha,
    ...BASE_VIDEO_PLAN,
    ...(candidate.fullCodecString ? { fullCodecString: candidate.fullCodecString } : {}),
    ...(candidate.hardwareAcceleration ? { hardwareAcceleration: candidate.hardwareAcceleration } : {})
  });

export const resolveVideoEncodingPlan = async ({
  exportCodec,
  width,
  height,
  bitrate,
  preserveAlpha = false
}: ResolveVideoEncodingPlanOptions): Promise<ResolvedVideoEncodingPlan | null> => {
  const alpha = exportCodec === 'av1' && preserveAlpha ? 'keep' : 'discard';

  if (exportCodec === 'av1') {
    const supported = await canEncodeVideo('av1', {
      width,
      height,
      bitrate,
      alpha,
      ...BASE_VIDEO_PLAN
    });
    if (!supported) return null;
    return {
      codec: 'av1',
      bitrate,
      alpha,
      ...BASE_VIDEO_PLAN
    };
  }

  const candidates = buildH264Candidates(width, height, bitrate);
  for (const candidate of candidates) {
    const supported = await isCandidateSupported('avc', width, height, candidate, 'discard');
    if (!supported) continue;
    return {
      codec: 'avc',
      bitrate: candidate.bitrate,
      alpha: 'discard',
      ...BASE_VIDEO_PLAN,
      ...(candidate.fullCodecString ? { fullCodecString: candidate.fullCodecString } : {}),
      ...(candidate.hardwareAcceleration ? { hardwareAcceleration: candidate.hardwareAcceleration } : {})
    };
  }

  return null;
};
