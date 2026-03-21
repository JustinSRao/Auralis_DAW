import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMixerStore } from '../../stores/mixerStore';
import { ipcGetMixerState } from '../../lib/ipc';
import ChannelStrip from './ChannelStrip';
import MasterStrip from './MasterStrip';

interface ChannelLevelEvent {
  channel_id: string;
  peak_l: number;
  peak_r: number;
}

interface MasterLevelPayload {
  peak_l: number;
  peak_r: number;
}

export default function MixerView() {
  const { hydrate, applyChannelLevel, applyMasterLevel } = useMixerStore();
  const channelIds = useMixerStore((s) => Object.keys(s.channels));

  // Hydrate mixer state on mount
  useEffect(() => {
    ipcGetMixerState().then(hydrate).catch(console.error);
  }, [hydrate]);

  // Listen for level events
  useEffect(() => {
    const unlisten1 = listen<ChannelLevelEvent>('channel_level_changed', (e) => {
      applyChannelLevel(e.payload.channel_id, e.payload.peak_l, e.payload.peak_r);
    });
    const unlisten2 = listen<MasterLevelPayload>('master_level_changed', (e) => {
      applyMasterLevel(e.payload.peak_l, e.payload.peak_r);
    });
    return () => {
      void unlisten1.then((f) => f());
      void unlisten2.then((f) => f());
    };
  }, [applyChannelLevel, applyMasterLevel]);

  return (
    <div className="flex h-full bg-gray-900 border-t border-gray-700 overflow-x-auto overflow-y-hidden">
      <div className="flex items-stretch">
        {channelIds.map((id) => (
          <ChannelStrip key={id} channelId={id} />
        ))}
        <MasterStrip />
      </div>
    </div>
  );
}
