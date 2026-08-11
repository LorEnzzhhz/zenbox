import { Megaphone, X } from "lucide-react";
import { useState } from "react";

function dismissedKey(id: string) {
  return `zenbox.announce.${id}`;
}

/** Dismissible developer announcement shown under the studio header. Each
 *  announcement is dismissed once, per device. */
export function AnnouncementBanner({ id, text }: { id: string; text: string }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey(id)) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  return (
    <div className="flex items-center gap-2.5 border-b border-border/70 bg-muted/40 px-3 py-2 sm:px-4">
      <Megaphone className="size-3.5 shrink-0 text-foreground/70" />
      <p className="min-w-0 flex-1 truncate text-[12px] leading-5 text-foreground/85">{text}</p>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(dismissedKey(id), "1");
          } catch {
            /* ignore */
          }
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss announcement"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
