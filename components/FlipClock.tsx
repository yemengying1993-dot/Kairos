
import React, { useState, useEffect } from 'react';

const FlipClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const format = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className="flex space-x-6 items-center justify-center font-mono text-8xl md:text-[10rem]">
      <div className="soul-glass px-8 py-12 rounded-[2.5rem] text-[#7DF9FF] shadow-[0_0_40px_rgba(125,249,255,0.1)]">
        {format(time.getHours())}
      </div>
      <div className="text-[#7DF9FF]/30 animate-pulse">:</div>
      <div className="soul-glass px-8 py-12 rounded-[2.5rem] text-[#7DF9FF] shadow-[0_0_40px_rgba(125,249,255,0.1)]">
        {format(time.getMinutes())}
      </div>
    </div>
  );
};

export default FlipClock;
