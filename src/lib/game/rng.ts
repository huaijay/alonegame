/** mulberry32：轻量可复现随机数生成器 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 掷一次骰子（1-6） */
export function rollDice(rng: () => number): number {
  return 1 + Math.floor(rng() * 6);
}
