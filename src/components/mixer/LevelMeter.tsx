import React from 'react';

interface Props {
  peakL: number;
  peakR: number;
  height?: number;
}

function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

function dbToPercent(db: number): number {
  // Map -60 dBFS → 0%, 0 dBFS → 100%
  return Math.max(0, Math.min(100, (db + 60) / 60 * 100));
}

const LevelMeter = React.memo(function LevelMeter({ peakL, peakR, height = 80 }: Props) {
  const dbL = linearToDb(peakL);
  const dbR = linearToDb(peakR);
  const pctL = dbToPercent(dbL);
  const pctR = dbToPercent(dbR);
  const clipL = peakL > 1.0;
  const clipR = peakR > 1.0;

  return (
    <div className="flex gap-[2px] items-end" style={{ height }}>
      {/* Left channel */}
      <div className="flex flex-col items-center gap-[2px]" style={{ height }}>
        <div
          className={`w-2 h-2 rounded-sm ${clipL ? 'bg-red-500' : 'bg-gray-600'}`}
        />
        <div className="flex-1 w-2 bg-gray-700 rounded-sm overflow-hidden flex flex-col-reverse">
          <div
            className="w-full bg-green-500 transition-none"
            style={{ height: `${pctL}%` }}
          />
        </div>
      </div>
      {/* Right channel */}
      <div className="flex flex-col items-center gap-[2px]" style={{ height }}>
        <div
          className={`w-2 h-2 rounded-sm ${clipR ? 'bg-red-500' : 'bg-gray-600'}`}
        />
        <div className="flex-1 w-2 bg-gray-700 rounded-sm overflow-hidden flex flex-col-reverse">
          <div
            className="w-full bg-green-500 transition-none"
            style={{ height: `${pctR}%` }}
          />
        </div>
      </div>
    </div>
  );
});

export default LevelMeter;
