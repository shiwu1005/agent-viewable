import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * 逐帧渲染（录视频用）。
 *
 * R3F 在 frameloop="never" 时，advance(t) 会把 clock.elapsedTime 直接设成 t（单位：秒），
 * 所以外面可以按固定步长推进，不受机器实际帧率影响。
 *
 * 另外场景里很多时间用的是 Date.now()（小人出生/结束、气泡过期），
 * 这里一并换成虚拟时钟，保证整套动画同步。
 */
export function CaptureDriver() {
  const advance = useThree((s) => s.advance);
  const clock = useThree((s) => s.clock);

  useEffect(() => {
    const realNow = Date.now.bind(Date);
    let vt = clock.elapsedTime || 0; // 秒
    const base = realNow();

    (window as unknown as Record<string, unknown>).__cap = {
      vt: () => vt,
      step(dtMs: number) {
        vt += dtMs / 1000;
        advance(vt, true);
      },
      grab(type = "image/jpeg", quality = 0.85) {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        return c.toDataURL(type, quality);
      },
      size() {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        return { w: c.width, h: c.height };
      },
    };

    // 场景内部用 Date.now() 计时，跟着虚拟时钟走
    const DateShim = Date as unknown as { now: () => number };
    DateShim.now = () => base + vt * 1000;

    return () => {
      DateShim.now = realNow;
    };
  }, [advance, clock]);

  return null;
}
