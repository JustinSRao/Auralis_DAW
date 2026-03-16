/**
 * A single automation row: header + canvas for one parameter lane.
 *
 * Rendered in the Timeline's automation panel for each (patternId, parameterId)
 * lane belonging to a track.
 */

import { useState } from 'react';
import type { AutomationLaneData, AutomationInterp } from '../../lib/ipc';
import { useAutomationStore } from '../../stores/automationStore';
import { AutomationHeader } from './AutomationHeader';
import { AutomationLaneCanvas } from './AutomationLaneCanvas';

interface Props {
  lane: AutomationLaneData;
  /** Total pattern length in ticks. */
  totalTicks: number;
  /** Timeline canvas width in pixels. */
  width: number;
  /** Timeline horizontal scroll offset. */
  scrollLeft: number;
  /** Pixels per bar for tick-to-pixel mapping. */
  pixelsPerBar: number;
  /** Beats per bar from transport time signature. */
  beatsPerBar: number;
}

export function AutomationRow({
  lane,
  totalTicks,
  width,
  scrollLeft,
  pixelsPerBar,
  beatsPerBar,
}: Props) {
  const [activeInterp, setActiveInterp] = useState<AutomationInterp>('Linear');
  const { enableLane, deletePoint } = useAutomationStore.getState();

  function handleToggleEnabled() {
    void enableLane(lane.patternId, lane.parameterId, !lane.enabled);
  }

  function handleDeleteLane() {
    // Delete all points to effectively remove the lane
    for (const pt of [...lane.points]) {
      void deletePoint(lane.patternId, lane.parameterId, pt.tick);
    }
  }

  return (
    <div className="flex flex-col border-b border-[#2a2a2a]" style={{ flexShrink: 0 }}>
      <AutomationHeader
        parameterId={lane.parameterId}
        enabled={lane.enabled}
        activeInterp={activeInterp}
        onToggleEnabled={handleToggleEnabled}
        onInterpChange={setActiveInterp}
        onDeleteLane={handleDeleteLane}
      />
      <AutomationLaneCanvas
        lane={lane}
        totalTicks={totalTicks}
        width={width}
        scrollLeft={scrollLeft}
        pixelsPerBar={pixelsPerBar}
        beatsPerBar={beatsPerBar}
        activeInterp={activeInterp}
      />
    </div>
  );
}
