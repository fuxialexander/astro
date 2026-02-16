import { Signal, Wifi } from 'lucide-react';

/**
 * Mobile status bar component matching iOS design
 * Only shown on mobile (md:hidden)
 */
export function MobileStatusBar() {
  return (
    <div className="flex h-[54px] items-center justify-between px-6 pt-3.5 md:hidden">
      {/* Left: Time */}
      <div className="text-base font-semibold text-foreground">9:41</div>

      {/* Right: System icons */}
      <div className="flex items-center gap-1.5">
        <Signal className="h-4 w-4 text-foreground" />
        <Wifi className="h-4 w-4 text-foreground" />
        <div className="h-[13px] w-[27px] rounded border-[1.5px] border-foreground" />
      </div>
    </div>
  );
}
