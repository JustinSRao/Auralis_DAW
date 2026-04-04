/**
 * KeyBadge — renders a keyboard combo as a styled badge (Sprint 46).
 *
 * Each segment of the combo (split on "+") is rendered in its own
 * key-cap style so "Ctrl+S" looks like [Ctrl] [S].
 * An empty combo renders "(unbound)" in muted style.
 */

interface Props {
  combo: string;
  highlighted?: boolean;
}

export function KeyBadge({ combo, highlighted = false }: Props) {
  if (!combo) {
    return (
      <span className="text-[#555555] text-xs italic">(unbound)</span>
    );
  }

  const parts = combo.split('+');

  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <span key={i}>
          <span
            className={[
              'font-mono text-xs px-1.5 py-0.5 rounded border',
              highlighted
                ? 'bg-[#5b8def]/20 border-[#5b8def] text-[#5b8def]'
                : 'bg-[#333333] border-[#555555] text-[#cccccc]',
            ].join(' ')}
          >
            {part}
          </span>
          {i < parts.length - 1 && (
            <span className="text-[#555555] text-xs mx-0.5">+</span>
          )}
        </span>
      ))}
    </span>
  );
}
