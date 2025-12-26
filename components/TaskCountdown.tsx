
import React, { useState, useEffect, useRef } from 'react';

interface TaskCountdownProps {
  initialSeconds: number;
  onComplete: () => void;
}

const TaskCountdown: React.FC<TaskCountdownProps> = ({ initialSeconds, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(initialSeconds);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (timeLeft <= 0) {
      onCompleteRef.current();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(timer);
          setTimeout(() => onCompleteRef.current(), 500);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []); // Sync only on mount to prevent reset during UI updates

  const format = (totalSeconds: number) => {
    const total = Math.max(0, totalSeconds);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    return {
      m: m.toString().padStart(2, '0'),
      s: s.toString().padStart(2, '0')
    };
  };

  const { m, s } = format(timeLeft);

  return (
    <div className="flex space-x-6 items-center justify-center font-mono text-8xl md:text-[14rem] select-none">
      <div className="flex flex-col items-center gap-4">
        <div className="soul-glass px-10 py-16 rounded-[3rem] text-[#7DF9FF] shadow-[0_0_60px_rgba(125,249,255,0.15)] relative overflow-hidden group">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-white/20" />
          <div className="absolute inset-x-0 bottom-0 h-[1px] bg-black/40" />
          <span className="relative z-10">{m}</span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.5em] text-[#7DF9FF]/40">Minutes</span>
      </div>
      
      <div className="text-[#7DF9FF]/20 animate-pulse pb-12">:</div>
      
      <div className="flex flex-col items-center gap-4">
        <div className="soul-glass px-10 py-16 rounded-[3rem] text-[#7DF9FF] shadow-[0_0_60px_rgba(125,249,255,0.15)] relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-white/20" />
          <div className="absolute inset-x-0 bottom-0 h-[1px] bg-black/40" />
          <span className="relative z-10">{s}</span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.5em] text-[#7DF9FF]/40">Seconds</span>
      </div>
    </div>
  );
};

export default TaskCountdown;
