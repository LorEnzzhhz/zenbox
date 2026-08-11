import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/** Slow drifting light orbs — pure CSS transforms, cheap on GPU. */
function Aurora({ dark }: { dark: boolean }) {
  const orbs = [
    { size: 430, left: "-12%", top: "-22%", color: "var(--wall-1)", dur: 26, delay: 0 },
    { size: 360, left: "68%", top: "-8%", color: "var(--wall-2)", dur: 32, delay: 2 },
    { size: 300, left: "58%", top: "58%", color: "var(--wall-3)", dur: 24, delay: 1 },
    { size: 260, left: "-6%", top: "66%", color: "var(--wall-4)", dur: 30, delay: 3 },
  ];
  return (
    <div className={dark ? "h-full w-full opacity-40 mix-blend-screen" : "h-full w-full opacity-25 mix-blend-multiply"}>
      {orbs.map((o, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: o.size,
            height: o.size,
            background: o.color,
            filter: "blur(90px)",
            left: o.left,
            top: o.top,
          }}
          animate={{ x: [0, 64, -42, 0], y: [0, 42, -30, 0], scale: [1, 1.12, 0.95, 1] }}
          transition={{ duration: o.dur, repeat: Infinity, ease: "easeInOut", delay: o.delay }}
        />
      ))}
    </div>
  );
}

/** Floating dust particles — a tiny canvas loop, paused while hidden. */
function Particles({ dark }: { dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    };
    resize();

    const dots = Array.from({ length: 64 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
      a: Math.random() * 0.5 + 0.12,
      tw: Math.random() * 0.002 + 0.0005,
    }));
    const rgb = dark ? "255,255,255" : "0,0,0";

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > 1) d.vx *= -1;
        if (d.y < 0 || d.y > 1) d.vy *= -1;
        d.a += d.tw;
        if (d.a > 0.7 || d.a < 0.1) d.tw *= -1;
        ctx.beginPath();
        ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${d.a.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [dark]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

/** Renders the active live wallpaper as the first child of a `relative` page
 *  root. Paints above the page background but below all content, so cards and
 *  text stay fully readable. */
export function LiveWallpaper() {
  const { prefs, resolved } = useTheme();
  if (prefs.wallpaper === "none") return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {prefs.wallpaper === "aurora" ? <Aurora dark={resolved === "dark"} /> : <Particles dark={resolved === "dark"} />}
    </div>
  );
}
