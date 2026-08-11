import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AUTO_MODEL, AUTO_MODEL_INFO, modelShortName, type ModelCatalog, type ModelInfo } from "@/lib/zenbox";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Cpu, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

/** Dispatched (window event) to open the model picker from anywhere — the
 *  mobile composer's model pill uses it. */
export const MODEL_PICKER_EVENT = "zenbox.open-model-picker";

export function ModelPicker({
  catalog,
  loading,
  value,
  onChange,
  onRefresh,
}: {
  catalog: ModelCatalog | null;
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Open from external triggers (composer model pill) via window event.
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(MODEL_PICKER_EVENT, openIt);
    return () => window.removeEventListener(MODEL_PICKER_EVENT, openIt);
  }, []);

  const current =
    value === AUTO_MODEL
      ? AUTO_MODEL_INFO
      : catalog
        ? [...catalog.free, ...catalog.rest, ...catalog.zen].find((m) => m.id === value)
        : undefined;

  const filterModels = (list: ModelInfo[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  };

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const free = filterModels(catalog?.free ?? []);
  const rest = filterModels(catalog?.rest ?? []);
  const zen = filterModels(catalog?.zen ?? []);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="model-picker-trigger"
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-56 justify-start gap-2 border border-border/70 px-2.5 text-xs font-medium"
          >
            <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
            {/* Full label on large screens only — icon-only on tablets so the
                header never overflows into the settings/avatar icons. */}
            <span className="hidden truncate xl:inline">{current ? current.name : modelShortName(value)}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title="Refresh model list"
          onClick={onRefresh}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
        <PopoverContent align="end" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search 200+ models…" value={query} onValueChange={setQuery} />
            <CommandList className="max-h-80">
              <CommandEmpty>No models match “{query}”.</CommandEmpty>
              <CommandGroup heading="Smart pick">
                <CommandItem value={AUTO_MODEL} onSelect={() => pick(AUTO_MODEL)} className="cursor-pointer">
                  <Check className={cn("mr-2 size-3.5", value === AUTO_MODEL ? "opacity-100" : "opacity-0")} />
                  <Sparkles className="mr-1 size-3.5 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px]">Auto — best model for the job</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      code → Big Pickle · image/chat → DeepSeek V4 Flash
                    </span>
                  </div>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Free models">
                {free.map((m) => (
                  <CommandItem key={m.id} value={m.id} onSelect={pick} className="cursor-pointer">
                    <Check className={cn("mr-2 size-3.5", value === m.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px]">{m.name}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{m.id}</span>
                    </div>
                  </CommandItem>
                ))}
                {free.length === 0 && (
                  <CommandItem disabled className="text-xs text-muted-foreground">
                    No free models found.
                  </CommandItem>
                )}
              </CommandGroup>
              {zen.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="OpenCode Zen">
                    {zen.map((m) => (
                      <CommandItem key={m.id} value={m.id} onSelect={pick} className="cursor-pointer">
                        <Check className={cn("mr-2 size-3.5", value === m.id ? "opacity-100" : "opacity-0")} />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px]">{m.name}</span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground">{m.id}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
              {rest.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="All models">
                    {rest.map((m) => (
                      <CommandItem key={m.id} value={m.id} onSelect={pick} className="cursor-pointer">
                        <Check className={cn("mr-2 size-3.5", value === m.id ? "opacity-100" : "opacity-0")} />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px]">{m.name}</span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground">{m.id}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
          <div className="border-t border-border/70 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
            {catalog?.hasZenKey
              ? "Big Pickle runs free on the OpenCode Zen gateway — 200K context, no credits."
              : "Big Pickle needs a free OpenCode Zen key — add one in Settings (gear icon) to unlock it."}
            {" "}·{" "}
            {catalog?.hasKey
              ? "Live catalog from OpenRouter — free models are marked."
              : "OpenRouter models: add a key in Settings to unlock every free model."}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
