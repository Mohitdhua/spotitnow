import type { ComponentType } from 'react';
import type { DesignerTimerProps, DesignerTimerStyleId } from '../../utils/timerPackShared';
import { BadgePopTimer } from './BadgePopTimer';
import { CircularCountdownRingTimer } from './CircularCountdownRingTimer';
import { DualRingProTimer } from './DualRingProTimer';
import { FuseBurnTimer } from './FuseBurnTimer';
import { HollowTextDrainTimer } from './HollowTextDrainTimer';
import { MagnifyingGlassTimer } from './MagnifyingGlassTimer';
import { PillProgressTimer } from './PillProgressTimer';
import { RadarSweepTimer } from './RadarSweepTimer';
import { SegmentedTimer } from './SegmentedTimer';
import { WarningModeTimer } from './WarningModeTimer';

export const DESIGNER_TIMER_COMPONENTS: Record<DesignerTimerStyleId, ComponentType<DesignerTimerProps>> = {
  countdown_ring: CircularCountdownRingTimer,
  hollow_drain: HollowTextDrainTimer,
  pill_progress: PillProgressTimer,
  magnify_timer: MagnifyingGlassTimer,
  radar_sweep: RadarSweepTimer,
  fuse_burn: FuseBurnTimer,
  badge_pop: BadgePopTimer,
  dual_ring_pro: DualRingProTimer,
  segmented_timer: SegmentedTimer,
  warning_mode: WarningModeTimer
};

export {
  BadgePopTimer,
  CircularCountdownRingTimer,
  DualRingProTimer,
  FuseBurnTimer,
  HollowTextDrainTimer,
  MagnifyingGlassTimer,
  PillProgressTimer,
  RadarSweepTimer,
  SegmentedTimer,
  WarningModeTimer
};
