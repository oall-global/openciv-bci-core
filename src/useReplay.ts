import { useEffect, useRef, useState } from 'react';
import type { AlphaFrame, Frame, Metadata } from './types';
type Row = { ms: number; event: any };
export type Recording = {
  header: { metadata: Metadata; source: string };
  file: string;
  events: Row[];
  duration: number;
  samples: number;
};
export function useReplay() {
  const [file, setFile] = useState<Recording | null>(null),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [speed, setSpeed] = useState(1),
    [view, setView] = useState<{ frame: Frame | null; alpha: AlphaFrame | null; active: boolean }>({
      frame: null,
      alpha: null,
      active: false,
    });
  const buffer = useRef<number[][]>(Array.from({ length: 16 }, () => [])),
    clock = useRef({ epoch: 0, count: 0 }),
    cursor = useRef(0),
    pos = useRef(0),
    lastFrame = useRef<Row | null>(null),
    lastAlpha = useRef<Row | null>(null);
  function apply(target: number, reset = false, source = file) {
    if (!source) return;
    if (reset) {
      buffer.current = Array.from({ length: 16 }, () => []);
      clock.current = { epoch: clock.current.epoch + 1, count: 0 };
      cursor.current = 0;
      lastFrame.current = null;
      lastAlpha.current = null;
    }
    while (cursor.current < source.events.length && source.events[cursor.current].ms <= target) {
      const row = source.events[cursor.current++],
        e = row.event;
      if (e.type === 'data') {
        clock.current.count += e.timestamps.length;
        lastFrame.current = row;
        if (row.ms >= target - 10000)
          e.samples.forEach((a: number[], i: number) => {
            buffer.current[i].push(...a);
            if (buffer.current[i].length > source.header.metadata.rate * 9)
              buffer.current[i].splice(
                0,
                buffer.current[i].length - source.header.metadata.rate * 9,
              );
          });
      }
      if (e.type === 'alpha') lastAlpha.current = row;
    }
    const f = lastFrame.current,
      a = lastAlpha.current,
      now = Date.now() / 1000;
    setView({
      frame: f ? { ...f.event, at: now } : null,
      alpha: a && target - a.ms < 1500 ? { ...a.event, at: now } : null,
      active: !!f && target - f.ms < 1500,
    });
    pos.current = target;
    setPosition(target);
  }
  useEffect(() => {
    if (!file) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        next = playing ? Math.min(file.duration, pos.current + (now - last) * speed) : pos.current;
      last = now;
      apply(next);
      if (next >= file.duration) setPlaying(false);
    }, 100);
    return () => clearInterval(timer);
  }, [file, playing, speed]);
  function load(value: Recording) {
    setPlaying(false);
    setFile(value);
    apply(0, true, value);
  }
  function seek(value: number) {
    apply(Math.max(0, Math.min(file?.duration ?? 0, value)), true);
  }
  function close() {
    setPlaying(false);
    setFile(null);
    buffer.current = Array.from({ length: 16 }, () => []);
    lastFrame.current = null;
    lastAlpha.current = null;
    setView({ frame: null, alpha: null, active: false });
  }
  return {
    file,
    playing,
    setPlaying,
    position,
    speed,
    setSpeed,
    view,
    buffer,
    clock,
    load,
    seek,
    close,
  };
}
export type Replay = ReturnType<typeof useReplay>;
