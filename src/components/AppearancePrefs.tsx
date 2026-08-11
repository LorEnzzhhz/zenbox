import { Switch } from "@/components/ui/switch";
import { PALETTES, WALLPAPERS, useTheme, type Palette, type Wallpaper } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Brain, CircleDot, Palette as PaletteIcon, Smartphone, Volume2 } from "lucide-react";

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <p className="text-[13px] font-semibold">{children}</p>
    </div>
  );
}

/** Reusable appearance controls: color palette, live wallpaper, sounds, and
 *  the AI-thinking toggle. Shared between the studio Settings dialog and the
 *  Control app's quick settings. */
export function AppearancePrefs() {
  const { prefs, setPrefs } = useTheme();

  return (
    <div className="space-y-5">
      {/* Palette */}
      <div className="space-y-2.5">
        <SectionLabel icon={<PaletteIcon className="size-3.5 text-muted-foreground" />}>Color palette</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTES.map((p) => {
            const active = prefs.palette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPrefs({ palette: p.id as Palette })}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-foreground bg-muted"
                    : "border-border/80 hover:border-foreground/30 hover:bg-muted/40",
                )}
              >
                <span className="flex shrink-0 -space-x-1.5">
                  <span className="size-4 rounded-full border border-border/60" style={{ background: p.swatch[0] }} />
                  <span className="size-4 rounded-full border border-border/60" style={{ background: p.swatch[1] }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{p.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{p.hint}</span>
                </span>
                {active && <span className="size-1.5 shrink-0 rounded-full bg-foreground" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Wallpaper */}
      <div className="space-y-2.5">
        <SectionLabel icon={<CircleDot className="size-3.5 text-muted-foreground" />}>Live wallpaper</SectionLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {WALLPAPERS.map((w) => {
            const active = prefs.wallpaper === w.id;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setPrefs({ wallpaper: w.id as Wallpaper })}
                className={cn(
                  "rounded-sm border px-2 py-2 text-center transition-colors",
                  active
                    ? "border-foreground bg-muted"
                    : "border-border/80 hover:border-foreground/30 hover:bg-muted/40",
                )}
              >
                <span className="block text-xs font-medium">{w.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{w.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sounds */}
      <div className="space-y-2.5">
        <SectionLabel icon={<Volume2 className="size-3.5 text-muted-foreground" />}>Sounds</SectionLabel>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between rounded-sm border border-border/80 px-3 py-2.5">
            <span>
              <span className="block text-xs font-medium">Loading chime</span>
              <span className="block text-[10px] text-muted-foreground">Plays when the app finishes loading</span>
            </span>
            <Switch checked={prefs.bootSound} onCheckedChange={(v) => setPrefs({ bootSound: v })} />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-sm border border-border/80 px-3 py-2.5">
            <span>
              <span className="block text-xs font-medium">Send tick</span>
              <span className="block text-[10px] text-muted-foreground">Tiny click when you send a message</span>
            </span>
            <Switch checked={prefs.sendSound} onCheckedChange={(v) => setPrefs({ sendSound: v })} />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-sm border border-border/80 px-3 py-2.5">
            <span className="flex items-center gap-2">
              <Smartphone className="size-3.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-xs font-medium">Haptics</span>
                <span className="block text-[10px] text-muted-foreground">
                  Subtle vibration on send, replies, and errors (Android)
                </span>
              </span>
            </span>
            <Switch checked={prefs.haptics} onCheckedChange={(v) => setPrefs({ haptics: v })} />
          </label>
        </div>
      </div>

      {/* Thinking */}
      <div className="space-y-2.5">
        <SectionLabel icon={<Brain className="size-3.5 text-muted-foreground" />}>AI thinking</SectionLabel>
        <label className="flex cursor-pointer items-center justify-between rounded-sm border border-border/80 px-3 py-2.5">
          <span>
            <span className="block text-xs font-medium">Show the AI's thinking</span>
            <span className="block text-[10px] text-muted-foreground">
              Live reasoning while it writes, when the model reports it
            </span>
          </span>
          <Switch checked={prefs.showThinking} onCheckedChange={(v) => setPrefs({ showThinking: v })} />
        </label>
      </div>
    </div>
  );
}
