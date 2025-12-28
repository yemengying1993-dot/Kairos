
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Plus, ArrowRight, Clock, Zap, Lock, X, Wind, Trash2, Calendar, 
  ArrowLeft, Timer, Check, CheckCircle2, MessageSquare,
  Play, ChevronLeft, Loader2, BarChart3, Sun, Moon, History as HistoryIcon,
  BarChart as BarChart3Icon, Settings, RefreshCw, Star, MapPin, AlertTriangle
} from 'lucide-react';
import { AppState, EnergyLevel, Task, DailyRecord } from './types';
import { getDynamicSchedule, getWeeklyInsight } from './services/geminiService';
import EnergyCurve from './components/EnergyCurve';
import AIChatDrawer from './components/AIChatDrawer';
import TaskCountdown from './components/TaskCountdown';

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

const getLocalDateString = (date: Date) => {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getWeekNumber = (date: Date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// 辅助函数：清理超过 7 天的过期缓存
const performCacheCleanup = () => {
  const keys = Object.keys(localStorage);
  const today = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  keys.forEach(key => {
    if (key.startsWith('kairos_day_')) {
      const dateStr = key.replace('kairos_day_', '');
      const recordDate = new Date(dateStr);
      // 如果日期解析成功且超过 7 天，则删除
      if (!isNaN(recordDate.getTime()) && (today.getTime() - recordDate.getTime() > SEVEN_DAYS_MS)) {
        console.log(`[Kairos] Purging old cache: ${key}`);
        localStorage.removeItem(key);
      }
    }
  });
};

// 辅助函数：播放专注完成音效
const playCompletionSound = () => {
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.6);
    
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.warn("Audio playback failed", e);
  }
};

const App: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedDate] = useState(getLocalDateString(new Date()));
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showBaselineSettings, setShowBaselineSettings] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const loadStored = <T,>(key: string, fallback: T): T => {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  };

  const [state, setState] = useState<AppState>(() => {
    const lastOnboardingWeek = localStorage.getItem('kairos_week_done');
    const currentWeek = getWeekNumber(new Date());
    
    // 如果是新的一周，执行缓存清理
    if (lastOnboardingWeek !== currentWeek.toString()) {
      performCacheCleanup();
      return 'onboarding';
    }
    
    const today = getLocalDateString(new Date());
    const saved = localStorage.getItem(`kairos_day_${today}`);
    if (saved) {
      try {
        const parsed: DailyRecord = JSON.parse(saved);
        if (parsed.energy && parsed.tasks && parsed.tasks.length > 0) {
          return 'dashboard';
        }
      } catch (e) {
        console.error("Failed to parse today's record during init");
      }
    }
    
    return 'checkin';
  });

  const [onboardingStep, setOnboardingStep] = useState<'hours' | 'fixed' | 'wishes'>('hours');
  const [activeHours, setActiveHours] = useState(() => loadStored('kairos_active_hours', { start: '08:00', end: '23:00' }));
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);

  const [weeklyStats, setWeeklyStats] = useState({ completionRate: 0, focusHours: 0, insight: '' });
  const [loadingReport, setLoadingReport] = useState(false);

  const [fixedTasks, setFixedTasks] = useState<Task[]>(() => loadStored('kairos_fixed_tasks', [
    { id: 'f-0', title: '营养早餐', duration: 30, energyCost: 'low', isHardBlock: true, startTime: '09:00', endTime: '09:30', recurringDays: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'f-p', title: '普拉提私教课', duration: 120, energyCost: 'high', isHardBlock: true, startTime: '12:00', endTime: '14:00', recurringDays: [1, 3, 5] },
    { id: 'f-2', title: '营养晚餐', duration: 60, energyCost: 'low', isHardBlock: true, startTime: '16:30', endTime: '17:30', recurringDays: [0, 1, 2, 3, 4, 5, 6] }
  ]));

  const [wishes, setWishes] = useState<Task[]>(() => loadStored('kairos_wishes', [
    { id: 'w-1', title: '投资学习', duration: 90, energyCost: 'high', isHardBlock: false, isWish: true },
    { id: 'w-2', title: '外语学习', duration: 90, energyCost: 'high', isHardBlock: false, isWish: true },
    { id: 'w-3', title: '创意写作', duration: 60, energyCost: 'high', isHardBlock: false, isWish: true },
    { id: 'w-4', title: '兴趣探索', duration: 90, energyCost: 'medium', isHardBlock: false, isWish: true },
    { id: 'w-5', title: '看书', duration: 90, energyCost: 'low', isHardBlock: false, isWish: true }
  ]));

  const [lastSyncedBaseline, setLastSyncedBaseline] = useState<string>(() => loadStored('kairos_last_synced_baseline', ''));

  const [isAddingOnboardingItem, setIsAddingOnboardingItem] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemEnergy, setNewItemEnergy] = useState<'high' | 'medium' | 'low'>('medium');
  const [newItemStart, setNewItemStart] = useState('09:00');
  const [newItemEnd, setNewItemEnd] = useState('10:00');
  const [newItemDuration, setNewItemDuration] = useState(60);
  const [newItemDays, setNewItemDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [loading, setLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(`kairos_day_${selectedDate}`);
    if (saved) {
      const parsed: DailyRecord = JSON.parse(saved);
      setTasks(parsed.tasks);
      setEnergy(parsed.energy);
    } else {
      setTasks([]);
      setEnergy(null);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (energy !== null) {
      const record: DailyRecord = { date: selectedDate, energy, tasks };
      localStorage.setItem(`kairos_day_${selectedDate}`, JSON.stringify(record));
    }
  }, [tasks, energy, selectedDate]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('kairos_fixed_tasks', JSON.stringify(fixedTasks));
    localStorage.setItem('kairos_wishes', JSON.stringify(wishes));
    localStorage.setItem('kairos_active_hours', JSON.stringify(activeHours));
  }, [fixedTasks, wishes, activeHours]);

  const currentBaselineHash = useMemo(() => {
    return JSON.stringify({ activeHours, fixedTasks, wishes });
  }, [activeHours, fixedTasks, wishes]);

  const isBaselineDirty = useMemo(() => {
    return currentBaselineHash !== lastSyncedBaseline;
  }, [currentBaselineHash, lastSyncedBaseline]);

  const activeTask = useMemo(() => {
    if (tasks.length === 0) return null;
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    const task = tasks.find(t => {
      if (!t.startTime) return false;
      const [h, m] = t.startTime.split(':').map(Number);
      const startMinutes = h * 60 + m;
      const endMinutes = startMinutes + t.duration;
      return nowMinutes >= startMinutes && nowMinutes < endMinutes && !t.isCompleted;
    });
    if (task) {
      const [h, m] = task.startTime!.split(':').map(Number);
      const endMinutes = (h * 60 + m) + task.duration;
      const remainingSeconds = (endMinutes * 60) - (currentTime.getHours() * 3600 + currentTime.getMinutes() * 60 + currentTime.getSeconds());
      return { ...task, remainingMinutes: Math.max(1, Math.ceil(remainingSeconds / 60)), remainingSeconds: Math.max(1, remainingSeconds) };
    }
    return null;
  }, [tasks, currentTime]);

  const calculateWeeklyReport = async () => {
    setLoadingReport(true);
    setState('report');
    let totalTasks = 0, completedTasks = 0, focusMinutes = 0;
    const taskFrequency: Record<string, number> = {};

    // 严格回溯过去 7 天
    for (let i = 0; i < 7; i++) {
      const d = new Date(); 
      d.setDate(d.getDate() - i);
      const dateKey = `kairos_day_${getLocalDateString(d)}`;
      const saved = localStorage.getItem(dateKey);
      
      if (saved) {
        try {
          const record: DailyRecord = JSON.parse(saved);
          record.tasks.forEach(t => { 
            totalTasks++; 
            if (t.isCompleted) { 
              completedTasks++; 
              focusMinutes += t.duration; 
              taskFrequency[t.title] = (taskFrequency[t.title] || 0) + 1; 
            } 
          });
        } catch (e) {
          console.error("Failed to parse history record", dateKey);
        }
      }
    }
    
    const rate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const topTasks = Object.entries(taskFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(e => e[0]);

    try {
      const insight = await getWeeklyInsight({ completionRate: rate, focusMinutes, topTasks });
      setWeeklyStats({ 
        completionRate: rate, 
        focusHours: Math.round(focusMinutes / 60), 
        insight 
      });
    } catch (e) {
      setWeeklyStats({ 
        completionRate: rate, 
        focusHours: Math.round(focusMinutes / 60), 
        insight: "回顾本周，每一个专注的瞬间都值得被铭记。继续保持你的节奏。" 
      });
    } finally {
      setLoadingReport(false);
    }
  };

  const handleCheckIn = async (score: EnergyLevel) => {
    setLoading(true);
    setEnergy(score);
    try {
      const scheduled = await getDynamicSchedule(score, [...fixedTasks.filter(t => t.recurringDays?.includes(new Date().getDay())), ...wishes], activeHours);
      if (scheduled && Array.isArray(scheduled)) {
        setTasks(scheduled.map((t: any) => ({ 
          ...t, 
          isCompleted: false, 
          energyCost: t.energyCost || 'medium',
          description: t.description || '' 
        })));
        setLastSyncedBaseline(currentBaselineHash);
        localStorage.setItem('kairos_last_synced_baseline', JSON.stringify(currentBaselineHash));
        setState('dashboard');
      }
    } catch (e) {
      setTasks(fixedTasks.filter(t => t.recurringDays?.includes(new Date().getDay())).map(t => ({ ...t, isCompleted: false })));
      setState('dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleDashboardTaskEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setNewItemTitle(task.title);
    setNewItemDescription(task.description || '');
    setNewItemStart(task.startTime || '09:00');
    setNewItemDuration(task.duration);
    setNewItemEnergy(task.energyCost);
  }, []);

  const saveDashboardTask = () => {
    if (!newItemTitle.trim()) return;
    const updatedTask: Task = { ...editingTask!, title: newItemTitle, description: newItemDescription, startTime: newItemStart, duration: newItemDuration, energyCost: newItemEnergy };
    if (editingTask?.id === 'new') {
      updatedTask.id = Math.random().toString(36).substr(2, 9);
      setTasks(prev => [...prev, updatedTask].sort((a,b) => (a.startTime||'').localeCompare(b.startTime||'')));
    } else {
      setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t).sort((a,b) => (a.startTime||'').localeCompare(b.startTime||'')));
    }
    setEditingTask(null);
  };

  const startMonkMode = useCallback((taskId: string) => {
    setFocusedTaskId(taskId);
    setShowCompleteConfirm(false);
    setState('monk-mode');
  }, []);

  const completeFocusTask = useCallback(() => {
    setTasks(prev => focusedTaskId ? prev.map(t => t.id === focusedTaskId ? { ...t, isCompleted: true } : t) : prev);
    setShowCompleteConfirm(false);
    playCompletionSound();
    setState('transition');
  }, [focusedTaskId]);

  const handleRemoveTask = useCallback((title: string) => {
    const cleanTitle = title.trim().toLowerCase();
    const filterFn = (t: Task) => !t.title.toLowerCase().includes(cleanTitle);
    setTasks(prev => prev.filter(filterFn));
    setFixedTasks(prev => prev.filter(filterFn));
    setWishes(prev => prev.filter(filterFn));
  }, []);

  // 重新设置基准的逻辑
  const performBaselineReset = () => {
    setState('onboarding');
    setOnboardingStep('hours');
    setShowBaselineSettings(false);
    setShowResetConfirm(false);
  };

  const renderTypeBadge = (task: Task) => {
    if (task.isHardBlock) {
      return (
        <span className="flex items-center gap-1 shrink-0 h-5 min-w-[48px] px-1.5 rounded-full border border-soul-glow/20 bg-soul-glow/5 text-soul-glow text-[8px] font-black uppercase tracking-wider">
          <MapPin size={8} className="fill-soul-glow/20" /> 锚点
        </span>
      );
    }
    if (task.isWish) {
      return (
        <span className="flex items-center gap-1 shrink-0 h-5 min-w-[48px] px-1.5 rounded-full border border-soul-amber/20 bg-soul-amber/5 text-soul-amber text-[8px] font-black uppercase tracking-wider">
          <Star size={8} className="fill-soul-amber/20" /> 愿望
        </span>
      );
    }
    return null;
  };

  const renderEnergyBadge = (cost: 'high' | 'medium' | 'low', isTransparent = false) => {
    const config = {
      high: { label: '高耗', color: 'text-red-400 border-red-400/20 bg-red-400/5' },
      medium: { label: '常规', color: 'text-soul-amber border-soul-amber/20 bg-soul-amber/5' },
      low: { label: '轻量', color: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5' }
    };
    const { label, color } = config[cost] || config.medium;
    return (
      <span className={`flex items-center justify-center shrink-0 h-5 min-w-[38px] px-1.5 rounded-full border text-[8px] font-black uppercase tracking-wider transition-all ${isTransparent ? 'bg-transparent' : color}`}>
        {label}
      </span>
    );
  };

  const renderMonkMode = () => {
    const task = tasks.find(t => t.id === focusedTaskId);
    let initialSeconds = (task?.duration || 25) * 60;
    if (task && task.id === activeTask?.id) initialSeconds = activeTask.remainingSeconds;
    
    return (
      <div className="min-h-screen bg-soul-deep flex flex-col items-center justify-center p-6 space-y-12 animate-in fade-in duration-1000 relative">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 text-soul-glow animate-pulse"><Lock size={20} /><span className="text-xs font-black uppercase tracking-[0.5em]">深度专注模式</span></div>
          <h2 className="text-4xl sm:text-6xl font-black text-white italic tracking-tighter">{task?.title || '专注当下'}</h2>
        </div>
        
        <TaskCountdown 
          key={focusedTaskId} 
          initialSeconds={initialSeconds} 
          onComplete={completeFocusTask}
        />

        <div className="flex flex-col items-center gap-8">
          <p className="text-soul-muted/40 italic text-base sm:text-lg max-w-md text-center">此时此刻，全世界只有你和这项任务。</p>
          <div className="flex gap-4">
            <button onClick={completeFocusTask} className="px-8 sm:px-12 py-4 sm:py-6 bg-white text-soul-deep rounded-[2rem] font-black text-lg sm:text-xl shadow-glow active:scale-95 transition-all flex items-center gap-3"><Check size={24} /> 我已完成</button>
            <button onClick={() => setState('dashboard')} className="px-6 sm:px-8 py-4 sm:py-6 soul-glass border-white/10 rounded-[2rem] text-white/40 font-bold hover:text-white transition-all text-sm sm:text-base">提前结束</button>
          </div>
        </div>

        {showCompleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="absolute inset-0 bg-soul-deep/80 backdrop-blur-xl" onClick={() => setShowCompleteConfirm(false)} />
            <div className="relative w-full max-sm soul-glass p-10 rounded-[3rem] border-white/10 shadow-glow-lg text-center space-y-8">
               <div className="w-20 h-20 rounded-full bg-soul-glow/10 flex items-center justify-center mx-auto text-soul-glow border border-soul-glow/20 mb-2">
                 <Wind size={40} className="animate-float" />
               </div>
               <div className="space-y-3">
                 <h3 className="text-2xl font-black text-white italic tracking-tight">真的要结束专注么？</h3>
                 <p className="text-soul-muted/60 text-sm leading-relaxed italic">让流转的瞬间再多停留一会儿，还是准备好开启下一个阶段？</p>
               </div>
               <div className="flex flex-col gap-3">
                 <button onClick={completeFocusTask} className="w-full py-5 bg-white text-soul-deep rounded-2xl font-black text-lg shadow-glow active:scale-95 transition-all">确认完成</button>
                 <button onClick={() => setShowCompleteConfirm(false)} className="w-full py-5 soul-glass border-white/5 text-white/40 rounded-2xl font-bold text-sm hover:text-white transition-all">继续专注</button>
               </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="min-h-screen pb-24 animate-in fade-in duration-500">
      <div className="pt-6 sm:pt-10 px-6 sm:px-8 sticky top-0 bg-[#0B1026]/95 backdrop-blur-3xl z-40 border-b border-white/5 pb-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="text-left">
            <h1 className="text-3xl sm:text-4xl font-black soul-gradient-text tracking-tighter italic leading-none">Kairos</h1>
            <div className="flex items-center gap-2 mt-1 text-[8px] font-black uppercase tracking-[0.3em] text-soul-glow opacity-80">
              <span className="flex items-center gap-1"><Calendar size={10} /> {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
            </div>
          </div>
          <div className="flex gap-2">
             <button onClick={() => setShowBaselineSettings(true)} className="w-10 h-10 soul-glass rounded-xl flex items-center justify-center text-white/40 border border-white/10 hover:bg-white/5 transition-all"><Settings size={18} /></button>
             <button onClick={calculateWeeklyReport} className="px-4 py-2.5 soul-glass rounded-xl flex items-center gap-2 text-[10px] font-black text-soul-amber border border-soul-amber/20 hover:bg-soul-amber/10 transition-all"><BarChart3 size={16} /><span className="hidden sm:inline">每周总结</span></button>
             <button onClick={() => setState('review')} className="px-4 py-2.5 soul-glass rounded-xl flex items-center gap-2 text-[10px] font-black text-soul-muted hover:text-white transition-all border border-white/10"><CheckCircle2 size={16} /><span className="hidden sm:inline">今日复盘</span></button>
             <button onClick={() => setState('checkin')} className="w-10 h-10 soul-glass rounded-xl flex items-center justify-center text-soul-glow border border-soul-glow/20 hover:bg-soul-glow/10 transition-all"><Zap size={18} /></button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-4">
           <EnergyCurve energy={energy || 3} />
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-6 px-6 sm:px-8 space-y-10">
        {isBaselineDirty && energy && (
          <div className="p-5 soul-glass rounded-3xl border-soul-amber/40 bg-soul-amber/5 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in zoom-in-95">
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-soul-amber/20 flex items-center justify-center text-soul-amber"><RefreshCw size={20} className="animate-spin-slow" /></div>
                <div>
                   <h4 className="text-white font-bold text-sm">检测到每周基准已修改</h4>
                   <p className="text-soul-muted/60 text-[10px]">是否将最新修改同步到今日计划？</p>
                </div>
             </div>
             <button onClick={() => handleCheckIn(energy)} className="px-6 py-2.5 bg-soul-amber text-soul-deep rounded-xl font-black text-xs shadow-glow-amber active:scale-95 transition-all">立即同步</button>
          </div>
        )}

        {activeTask && (
          <div onClick={() => startMonkMode(activeTask.id)} className="group cursor-pointer p-0.5 soul-glass rounded-[2.5rem] border-soul-glow/30 shadow-glow animate-in zoom-in-95 active:scale-95 transition-all">
             <div className="bg-soul-glow/5 p-8 rounded-[2.4rem] flex flex-col sm:flex-row justify-between items-center gap-6 sm:gap-10">
                <div className="text-center sm:text-left space-y-3 flex-1">
                   <div className="flex items-center justify-between">
                      <div className="flex items-center justify-center sm:justify-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><span className="text-[10px] font-black text-soul-glow uppercase tracking-[0.3em]">正在流转中</span>
                      </div>
                      <div className="flex gap-1.5 sm:hidden">
                        {renderTypeBadge(activeTask)}
                        {renderEnergyBadge(activeTask.energyCost)}
                      </div>
                   </div>
                   <div className="flex justify-between items-start">
                     <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight italic tracking-tight">{activeTask.title}</h2>
                     <div className="hidden sm:flex gap-1.5">
                        {renderTypeBadge(activeTask)}
                        {renderEnergyBadge(activeTask.energyCost)}
                     </div>
                   </div>
                   {activeTask.description && <p className="text-white/60 text-xs italic line-clamp-2 max-w-sm">{activeTask.description}</p>}
                   <div className="flex items-center justify-center sm:justify-start gap-4">
                      <p className="text-white/40 text-xs font-bold flex items-center gap-1.5 italic"><Clock size={14} /> {activeTask.startTime}</p>
                      <p className="text-white/40 text-xs font-bold flex items-center gap-1.5 italic"><Timer size={14} /> 剩 {activeTask.remainingMinutes} 分钟</p>
                   </div>
                </div>
                <div className="flex flex-col items-center gap-2 shrink-0">
                   <div className="w-16 h-16 rounded-full bg-soul-glow flex items-center justify-center text-soul-deep shadow-glow group-hover:scale-110 transition-transform"><Play size={24} fill="currentColor" className="ml-1" /></div>
                </div>
             </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-2xl font-black text-white flex items-center gap-3 italic tracking-tighter"><Clock className="text-soul-glow" size={24}/> 今日时间流</h3>
             <button onClick={() => handleDashboardTaskEdit({ id: 'new', title: '', duration: 30, energyCost: 'medium', isHardBlock: false, startTime: '09:00' } as Task)} className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/50 text-[10px] font-black uppercase tracking-widest transition-all"><Plus size={14} /> 临时任务</button>
          </div>
          <div className="flex flex-col space-y-0 relative">
             <div className="absolute left-[23px] sm:left-[31px] top-6 bottom-6 w-0.5 bg-gradient-to-b from-soul-glow/40 via-white/5 to-transparent z-0" />
             {tasks.map((task) => {
               const isActive = activeTask?.id === task.id;
               return (
                 <div key={task.id} className="flex gap-6 sm:gap-10 group relative z-10 py-4 sm:py-6">
                    <div className="flex flex-col items-center pt-1.5">
                      <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-2xl sm:rounded-3xl flex items-center justify-center transition-all ${task.isCompleted ? 'bg-emerald-500/20 border-emerald-500/30' : isActive ? 'bg-soul-glow shadow-glow scale-110' : 'soul-glass border-white/10'}`}>
                        <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${task.isCompleted ? 'bg-emerald-400' : isActive ? 'bg-soul-deep' : 'bg-white/20'}`} />
                      </div>
                    </div>
                    <div onClick={() => !task.isCompleted && (isActive ? startMonkMode(task.id) : handleDashboardTaskEdit(task))} className={`flex-1 p-5 sm:p-7 rounded-[2rem] border transition-all flex flex-col gap-3 text-left cursor-pointer ${task.isCompleted ? 'bg-white/[0.01] border-white/5 opacity-30 scale-[0.98]' : isActive ? 'soul-glass border-soul-glow/40 shadow-glow-lg -translate-y-0.5' : 'soul-glass border-white/5 hover:border-white/20'}`}>
                       <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 flex-1">
                             <p className={`text-[8px] sm:text-[10px] font-black uppercase tracking-[0.15em] ${isActive ? 'text-soul-glow' : 'text-white/30'}`}>{task.startTime} · {task.duration}M</p>
                             <h3 className={`text-xl sm:text-2xl font-black tracking-tight leading-tight ${task.isCompleted ? 'line-through text-white/20' : 'text-white/90'}`}>{task.title}</h3>
                             {task.description && !task.isCompleted && (
                               <p className="text-[10px] sm:text-[11px] text-white/50 italic leading-relaxed mt-1 max-w-[90%]">{task.description}</p>
                             )}
                          </div>
                          <div className="flex gap-1.5 items-center">
                            {renderTypeBadge(task)}
                            {renderEnergyBadge(task.energyCost, task.isCompleted)}
                          </div>
                       </div>
                       <div className="flex justify-between items-center pt-1">
                          <div className="flex gap-2 text-[8px] font-black uppercase tracking-widest">
                             {isActive && <span className="text-soul-glow animate-pulse">进行中</span>}
                             {task.isCompleted && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> 已完成</span>}
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3">
                             {!task.isCompleted && <button onClick={(e) => { e.stopPropagation(); if(confirm('删除此任务？')) setTasks(p => p.filter(t=>t.id!==task.id)); }} className="p-2 text-white/20 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>}
                             <button onClick={(e) => { e.stopPropagation(); setTasks(p => p.map(t=>t.id===task.id?{...t, isCompleted:!t.isCompleted}:t)); }} className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border flex items-center justify-center transition-all ${task.isCompleted ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : 'border-white/10 text-transparent hover:border-emerald-500/40'}`}><Check size={18} /></button>
                          </div>
                       </div>
                    </div>
                 </div>
               );
             })}
          </div>
        </div>
      </div>

      {editingTask && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-soul-deep/95 backdrop-blur-2xl" onClick={() => setEditingTask(null)} />
          <div className="relative w-full max-sm soul-glass p-8 rounded-[2.5rem] border-white/10 shadow-glow-lg space-y-8 animate-in zoom-in-95">
             <div className="flex justify-between items-center"><h3 className="text-2xl font-black text-white italic tracking-tight">调整流转瞬间</h3><button onClick={() => setEditingTask(null)} className="p-2 text-white/30 hover:text-white transition-all"><X size={24} /></button></div>
             <div className="space-y-6 max-h-[60vh] overflow-y-auto px-1 custom-scrollbar">
                <div className="space-y-2"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">任务名称</span><input autoFocus value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-black text-xl outline-none focus:border-soul-glow" /></div>
                <div className="space-y-2"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">描述/建议</span><textarea value={newItemDescription} onChange={(e) => setNewItemDescription(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-white/80 font-medium text-sm outline-none focus:border-soul-glow resize-none" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">开始</span>
                    <div className="soul-glass rounded-2xl h-12 flex items-center justify-center border-white/10 overflow-hidden relative max-w-[120px]"><input type="time" value={newItemStart} onChange={(e) => setNewItemStart(e.target.value)} className="text-center font-black text-base w-full h-full bg-transparent px-2" /></div>
                  </div>
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">时长(分)</span>
                    <div className="soul-glass rounded-2xl h-12 flex items-center justify-center border-white/10 overflow-hidden max-w-[120px]"><input type="number" value={newItemDuration} onChange={(e) => setNewItemDuration(parseInt(e.target.value)||30)} className="text-center font-black text-base w-full h-full bg-transparent px-2 outline-none text-white" /></div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">{(['low', 'medium', 'high'] as const).map(level => (<button key={level} onClick={() => setNewItemEnergy(level)} className={`py-3 rounded-xl border text-[10px] font-black transition-all ${newItemEnergy === level ? 'bg-soul-glow text-soul-deep border-soul-glow shadow-glow' : 'text-white/30 border-white/10'}`}>{level === 'low' ? '轻量' : level === 'medium' ? '常规' : '高耗'}</button>))}</div>
             </div>
             <button onClick={saveDashboardTask} className="w-full py-5 bg-soul-glow text-soul-deep rounded-[1.5rem] font-black text-lg shadow-glow active:scale-95 transition-all">保存流转计划</button>
          </div>
        </div>
      )}

      {showBaselineSettings && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-soul-deep/95 backdrop-blur-2xl" onClick={() => setShowBaselineSettings(false)} />
          <div className="relative w-full max-lg soul-glass p-8 rounded-[2.5rem] border-white/10 shadow-glow-lg flex flex-col h-[80vh] animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-8">
                <div>
                   <h3 className="text-2xl font-black text-white italic tracking-tight">每周基准设定</h3>
                   <p className="text-soul-muted/40 text-[10px] uppercase tracking-widest font-black">调整你的长期生命流</p>
                </div>
                <button onClick={() => setShowBaselineSettings(false)} className="p-2 text-white/30 hover:text-white transition-all"><X size={24} /></button>
             </div>
             
             <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-10">
                <section className="space-y-4">
                   <h4 className="text-[10px] font-black text-soul-glow uppercase tracking-widest px-1">活跃时间窗</h4>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="soul-glass p-5 rounded-2xl flex flex-col items-center justify-center relative h-20">
                         <span className="text-[8px] font-black text-white/20 absolute top-3 left-4 uppercase">苏醒</span>
                         <input type="time" value={activeHours.start} onChange={(e) => setActiveHours(p => ({ ...p, start: e.target.value }))} className="text-xl font-black text-center w-full" />
                      </div>
                      <div className="soul-glass p-5 rounded-2xl flex flex-col items-center justify-center relative h-20">
                         <span className="text-[8px] font-black text-white/20 absolute top-3 left-4 uppercase">歇息</span>
                         <input type="time" value={activeHours.end} onChange={(e) => setActiveHours(p => ({ ...p, end: e.target.value }))} className="text-xl font-black text-center w-full" />
                      </div>
                   </div>
                </section>

                <section className="space-y-4">
                   <div className="flex justify-between items-center px-1">
                      <h4 className="text-[10px] font-black text-soul-glow uppercase tracking-widest">固定锚点</h4>
                      <button onClick={() => { setOnboardingStep('fixed'); setIsAddingOnboardingItem(true); }} className="text-white/20 hover:text-soul-glow transition-all"><Plus size={16} /></button>
                   </div>
                   <div className="space-y-3">
                      {fixedTasks.map(task => (
                        <div key={task.id} className="p-4 soul-glass rounded-2xl border-white/5 flex justify-between items-center">
                           <div className="space-y-1">
                              <p className="font-bold text-sm text-white/90">{task.title}</p>
                              <p className="text-[10px] text-white/30 flex items-center gap-2"><Clock size={10}/> {task.startTime} - {task.endTime}</p>
                           </div>
                           <button onClick={() => setFixedTasks(p => p.filter(t => t.id !== task.id))} className="p-2 text-white/10 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                        </div>
                      ))}
                   </div>
                </section>

                <section className="space-y-4">
                   <div className="flex justify-between items-center px-1">
                      <h4 className="text-[10px] font-black text-soul-glow uppercase tracking-widest">愿望清单</h4>
                      <button onClick={() => { setOnboardingStep('wishes'); setIsAddingOnboardingItem(true); }} className="text-white/20 hover:text-soul-glow transition-all"><Plus size={16} /></button>
                   </div>
                   <div className="space-y-3">
                      {wishes.map(task => (
                        <div key={task.id} className="p-4 soul-glass rounded-2xl border-white/5 flex justify-between items-center">
                           <div className="space-y-1">
                              <p className="font-bold text-sm text-white/90">{task.title}</p>
                              <p className="text-[10px] text-white/30 flex items-center gap-2"><Timer size={10}/> {task.duration}M</p>
                           </div>
                           <button onClick={() => setWishes(p => p.filter(t => t.id !== task.id))} className="p-2 text-white/10 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                        </div>
                      ))}
                   </div>
                </section>

                {/* 增加重新设置按钮 */}
                <section className="pt-6 border-t border-white/5 mt-4">
                   <button 
                     onClick={() => setShowResetConfirm(true)}
                     className="w-full py-4 flex items-center justify-center gap-2 text-red-400/60 hover:text-red-400 hover:bg-red-400/5 rounded-2xl transition-all border border-red-400/10 text-xs font-bold uppercase tracking-widest"
                   >
                     <RefreshCw size={14} /> 重新开始本周校准流程
                   </button>
                </section>
             </div>

             <div className="pt-8 border-t border-white/5 mt-6">
                <button onClick={() => setShowBaselineSettings(false)} className="w-full py-5 bg-white text-soul-deep rounded-2xl font-black text-lg shadow-glow active:scale-95 transition-all">关闭设定</button>
             </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-300">
           <div className="absolute inset-0 bg-soul-deep/80 backdrop-blur-xl" onClick={() => setShowResetConfirm(false)} />
           <div className="relative w-full max-sm soul-glass p-10 rounded-[3rem] border-white/10 shadow-glow-lg text-center space-y-8">
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-400 border border-red-400/20 mb-2">
                <AlertTriangle size={40} className="animate-pulse" />
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black text-white italic tracking-tight">确认重新开始？</h3>
                <p className="text-soul-muted/60 text-sm leading-relaxed italic">这会引导你重新校准活跃时间、固定日程和愿望清单。今日已有的执行记录不会被删除。</p>
              </div>
              <div className="flex flex-col gap-3">
                <button onClick={performBaselineReset} className="w-full py-5 bg-red-500 text-white rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">确定重新设置</button>
                <button onClick={() => setShowResetConfirm(false)} className="w-full py-5 soul-glass border-white/5 text-white/40 rounded-2xl font-bold text-sm hover:text-white transition-all">返回</button>
              </div>
           </div>
        </div>
      )}

      {isAddingOnboardingItem && (
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-6">
           <div className="absolute inset-0 bg-soul-deep/80 backdrop-blur-xl" onClick={() => setIsAddingOnboardingItem(false)} />
           <div className="relative w-full max-sm soul-glass p-8 rounded-[2.5rem] border-white/10 shadow-glow-lg space-y-6 animate-in zoom-in-95">
              <h3 className="text-xl font-black text-white italic">添加基准项</h3>
              <input autoFocus value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} placeholder="名称..." className="w-full bg-white/5 rounded-xl px-4 py-3 text-white outline-none border border-white/10 font-bold text-sm" />
              <div className="grid grid-cols-3 gap-1.5">{(['low', 'medium', 'high'] as const).map(level => (<button key={level} onClick={() => setNewItemEnergy(level)} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${newItemEnergy === level ? 'bg-soul-glow text-soul-deep border-soul-glow shadow-glow' : 'text-white/30 border-white/10'}`}>{level === 'low' ? '轻量' : level === 'medium' ? '常规' : '高耗'}</button>))}</div>
              {onboardingStep === 'fixed' ? (
                <div className="grid grid-cols-2 gap-3"><div className="soul-glass rounded-xl h-10 flex items-center justify-center border-white/5 overflow-hidden"><input type="time" value={newItemStart} onChange={(e) => setNewItemStart(e.target.value)} className="text-center text-xs h-full w-full bg-transparent" /></div><div className="soul-glass rounded-xl h-10 flex items-center justify-center border-white/5 overflow-hidden"><input type="time" value={newItemEnd} onChange={(e) => setNewItemEnd(e.target.value)} className="text-center text-xs h-full w-full bg-transparent" /></div></div>
              ) : (<input type="number" value={newItemDuration} onChange={(e) => setNewItemDuration(parseInt(e.target.value)||30)} className="w-full soul-glass rounded-xl p-3 text-sm text-center font-black" placeholder="时长(分)" />)}
              <div className="flex gap-2"><button onClick={() => {if(!newItemTitle.trim()) return; const isFixed = onboardingStep === 'fixed'; const newTask: Task = { id: Math.random().toString(36).substr(2, 9), title: newItemTitle, duration: isFixed ? (([h1,m1],[h2,m2])=> (Number(h2)*60+Number(m2))-(Number(h1)*60+Number(m1)))(newItemStart.split(':'),newItemEnd.split(':')) : newItemDuration, energyCost: newItemEnergy, isHardBlock: isFixed, isWish: !isFixed, startTime: isFixed ? newItemStart : undefined, endTime: isFixed ? newItemEnd : undefined, recurringDays: isFixed ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6] }; if (isFixed) setFixedTasks(prev => [...prev, newTask]); else setWishes(prev => [...prev, newTask]); setIsAddingOnboardingItem(false); setNewItemTitle('');}} className="flex-1 py-3 bg-soul-glow text-soul-deep rounded-xl font-black text-sm">确定</button><button onClick={() => setIsAddingOnboardingItem(false)} className="px-4 py-3 text-white/30 font-bold text-sm">取消</button></div>
           </div>
        </div>
      )}

      <button onClick={() => setIsChatOpen(true)} className="fixed bottom-6 right-6 w-16 h-16 sm:w-20 sm:h-20 soul-glass text-soul-glow rounded-full shadow-glow-lg flex items-center justify-center z-50 animate-float border border-soul-glow/20 active:scale-90 transition-all"><MessageSquare size={28} /></button>
      <AIChatDrawer 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        energy={energy} 
        tasks={tasks} 
        onAddFixed={(t) => setFixedTasks(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2,9), isHardBlock: true } as Task])} 
        onAddWish={(t) => setWishes(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2,9), isWish: true } as Task])} 
        onModifyHours={(h) => setActiveHours(prev => ({...prev, ...h}))} 
        onModifyToday={(t) => setTasks(prev => {
          const newTask: Task = {
            id: Math.random().toString(36).substr(2, 9),
            title: t.title || '新任务',
            duration: t.duration || 30,
            energyCost: t.energyCost || 'medium',
            isHardBlock: false,
            isWish: false,
            startTime: t.startTime || '09:00',
            isCompleted: false,
            description: t.description || '今天突然想要做的小确幸。',
          };
          return [...prev, newTask].sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
        })}
        onRemoveTask={handleRemoveTask}
      />
    </div>
  );

  const renderReport = () => (
    <div className="fixed inset-0 z-[500] bg-soul-deep overflow-y-auto p-6 animate-in fade-in duration-500">
       <div className="max-w-2xl mx-auto py-8 space-y-8">
          <div className="flex justify-between items-center px-2">
            <button onClick={() => setState('dashboard')} className="p-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all"><ChevronLeft size={20}/></button>
            <h2 className="text-2xl sm:text-3xl font-black italic">每周总结</h2>
            <div className="w-10 h-10" />
          </div>
          {loadingReport ? (
            <div className="flex flex-col items-center justify-center py-40 gap-6">
              <div className="w-16 h-16 border-4 border-soul-glow border-t-transparent rounded-full animate-spin" />
              <p className="text-soul-glow font-black uppercase tracking-widest text-xs animate-pulse">正在回顾你的流转瞬间...</p>
            </div>
          ) : (
            <>
              <div className="soul-glass p-8 rounded-[2rem] border-white/5 shadow-2xl space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="soul-glass p-6 rounded-2xl"><p className="text-[8px] font-black text-soul-glow uppercase tracking-widest">任务完成率</p><p className="text-3xl sm:text-5xl font-black mt-1">{weeklyStats.completionRate}%</p></div>
                    <div className="soul-glass p-6 rounded-2xl"><p className="text-[8px] font-black text-soul-muted uppercase tracking-widest">总专注时长</p><p className="text-3xl sm:text-5xl font-black mt-1">{weeklyStats.focusHours}h</p></div>
                 </div>
                 <div className="p-6 bg-white/[0.02] rounded-2xl border border-white/5 space-y-4">
                   <p className="text-xs font-black uppercase text-soul-glow/50 tracking-widest">Kairos 的灵魂建议</p>
                   <p className="text-soul-muted/80 italic leading-relaxed text-base">{weeklyStats.insight || "还没积累足够的流转瞬间。下周我们一起努力吧。"}</p>
                 </div>
              </div>
              <button onClick={() => setState('dashboard')} className="w-full py-5 bg-white text-soul-deep rounded-2xl font-black text-lg shadow-xl hover:bg-soul-glow transition-all">收下建议</button>
            </>
          )}
       </div>
    </div>
  );

  const renderOnboarding = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-10 animate-in fade-in duration-700 text-center">
      <div className="space-y-4"><h1 className="text-6xl sm:text-7xl font-black soul-gradient-text tracking-tighter italic leading-none">Kairos</h1><p className="text-soul-muted font-black tracking-[0.4em] text-[10px] uppercase">本周基准校准</p></div>
      <div className="soul-glass p-8 sm:p-10 rounded-[2.5rem] w-full max-lg space-y-8 relative overflow-hidden shadow-2xl border-white/10">
        <div className="flex justify-between items-center px-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">{onboardingStep === 'hours' ? "起止窗口" : onboardingStep === 'fixed' ? "固定日程" : "愿望池"}</h2>
          <div className="flex gap-1"><div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'hours' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} /><div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'fixed' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} /><div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'wishes' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} /></div>
        </div>
        {onboardingStep === 'hours' && (
          <div className="grid grid-cols-2 gap-4">
            <label className="soul-glass p-5 rounded-[1.5rem] h-20 flex flex-col items-center justify-center cursor-pointer"><span className="text-[8px] font-black uppercase text-soul-glow/50 flex items-center justify-center gap-1.5"><Sun size={10}/> 苏醒</span><input type="time" value={activeHours.start} onChange={(e) => setActiveHours(p => ({ ...p, start: e.target.value }))} className="text-xl text-center w-full font-black bg-transparent" /></label>
            <label className="soul-glass p-5 rounded-[1.5rem] h-20 flex flex-col items-center justify-center cursor-pointer"><span className="text-[8px] font-black uppercase text-soul-muted/50 flex items-center justify-center gap-1.5"><Moon size={10}/> 歇息</span><input type="time" value={activeHours.end} onChange={(e) => setActiveHours(p => ({ ...p, end: e.target.value }))} className="text-xl text-center w-full font-black bg-transparent" /></label>
          </div>
        )}
        {onboardingStep !== 'hours' && (
          <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar animate-in slide-in-from-right-10">
            {(onboardingStep === 'fixed' ? fixedTasks : wishes).map((task) => (
              <div key={task.id} className="flex flex-col p-4 soul-glass rounded-xl border-white/5 text-left group gap-1.5"><div className="flex justify-between items-start"><div className="space-y-1"><p className="font-bold text-white/90 text-sm">{task.title}</p><p className="text-[10px] text-white/30">{task.isHardBlock ? (<span className="flex items-center gap-1.5"><Calendar size={10} className="text-soul-glow/50" />{task.recurringDays?.length === 7 ? '每天' : `周${task.recurringDays?.map(d => WEEK_DAYS[d]).join('')}`}<span className="mx-1 opacity-30">|</span><Clock size={10} className="text-soul-glow/50" />{task.startTime} - {task.endTime}</span>) : `${task.duration}M`}</p></div><button onClick={() => onboardingStep === 'fixed' ? setFixedTasks(p => p.filter(t=>t.id!==task.id)) : setWishes(p => p.filter(t=>t.id!==task.id))} className="text-white/10 hover:text-red-400 transition-colors"><Trash2 size={16} /></button></div></div>
            ))}
            {!isAddingOnboardingItem ? (
              <button onClick={() => setIsAddingOnboardingItem(true)} className="w-full py-6 bg-white/5 border-2 border-dashed border-white/10 rounded-[1.5rem] text-white/20 flex items-center justify-center gap-2 hover:text-soul-glow transition-all font-bold text-sm text-center"><Plus size={20} /> 添加基准</button>
            ) : (
              <div className="p-6 soul-glass rounded-[2rem] space-y-5 text-left border-soul-glow/20 animate-in zoom-in-95">
                <input autoFocus value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} placeholder="名称..." className="w-full bg-white/5 rounded-xl px-4 py-3 text-white outline-none border border-white/10 font-bold text-sm" />
                <div className="grid grid-cols-3 gap-1.5">{(['low', 'medium', 'high'] as const).map(level => (<button key={level} onClick={() => setNewItemEnergy(level)} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${newItemEnergy === level ? 'bg-soul-glow text-soul-deep border-soul-glow shadow-glow' : 'text-white/30 border-white/10'}`}>{level === 'low' ? '轻量' : level === 'medium' ? '常规' : '高耗'}</button>))}</div>
                {onboardingStep === 'fixed' ? (
                  <div className="grid grid-cols-2 gap-3"><div className="soul-glass rounded-xl h-10 flex items-center justify-center border-white/5 overflow-hidden"><input type="time" value={newItemStart} onChange={(e) => setNewItemStart(e.target.value)} className="text-center text-xs h-full w-full bg-transparent" /></div><div className="soul-glass rounded-xl h-10 flex items-center justify-center border-white/5 overflow-hidden"><input type="time" value={newItemEnd} onChange={(e) => setNewItemEnd(e.target.value)} className="text-center text-xs h-full w-full bg-transparent" /></div></div>
                ) : (<input type="number" value={newItemDuration} onChange={(e) => setNewItemDuration(parseInt(e.target.value)||30)} className="w-full soul-glass rounded-xl p-3 text-sm" placeholder="时长(分)" />)}
                <div className="flex gap-2"><button onClick={() => {if(!newItemTitle.trim()) return; const isFixed = onboardingStep === 'fixed'; const newTask: Task = { id: Math.random().toString(36).substr(2, 9), title: newItemTitle, duration: isFixed ? (([h1,m1],[h2,m2])=> (Number(h2)*60+Number(m2))-(Number(h1)*60+Number(m1)))(newItemStart.split(':'),newItemEnd.split(':')) : newItemDuration, energyCost: newItemEnergy, isHardBlock: isFixed, isWish: !isFixed, startTime: isFixed ? newItemStart : undefined, endTime: isFixed ? newItemEnd : undefined, recurringDays: isFixed ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6] }; if (isFixed) setFixedTasks(prev => [...prev, newTask]); else setWishes(prev => [...prev, newTask]); setIsAddingOnboardingItem(false); setNewItemTitle('');}} className="flex-1 py-3 bg-soul-glow text-soul-deep rounded-xl font-black text-sm">确定</button><button onClick={() => setIsAddingOnboardingItem(false)} className="px-4 py-3 text-white/30 font-bold text-sm">取消</button></div>
              </div>
            )}
          </div>
        )}
        <button onClick={() => {if (onboardingStep === 'hours') setOnboardingStep('fixed'); else if (onboardingStep === 'fixed') setOnboardingStep('wishes'); else {localStorage.setItem('kairos_week_done', getWeekNumber(new Date()).toString()); setState('checkin');}}} className="w-full py-5 bg-white text-soul-deep rounded-[1.8rem] font-black flex items-center justify-center gap-2 shadow-2xl hover:bg-soul-glow transition-all text-lg">{onboardingStep === 'wishes' ? "完成设定" : "继续"} <ArrowRight size={20} /></button>
      </div>
    </div>
  );

  const renderCheckin = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-12 text-center animate-in fade-in relative overflow-hidden">
        {tasks.length > 0 && <button onClick={() => setState('dashboard')} className="absolute top-10 left-10 px-6 py-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all flex items-center gap-2 font-black border-white/10 shadow-xl"><ArrowLeft size={18} /> 返回</button>}
        <div className="space-y-4 max-w-lg"><h2 className="text-5xl sm:text-7xl font-black text-white italic tracking-tighter leading-none">能量同步</h2><p className="text-xl sm:text-2xl text-soul-muted italic font-medium">此刻你的“电量”是多少？</p></div>
        {loading ? (<div className="flex flex-col items-center gap-6 py-10"><div className="w-20 h-20 soul-glass rounded-full flex items-center justify-center border-soul-glow/40 shadow-glow animate-spin"><Loader2 className="text-soul-glow" size={40} /></div><p className="text-soul-glow font-black tracking-[0.3em] uppercase text-xs animate-pulse">Kairos 正在调度...</p></div>) : (<div className="flex gap-4 sm:gap-8 flex-wrap justify-center">{[1, 2, 3, 4, 5].map((level) => (<button key={level} onClick={() => handleCheckIn(level as EnergyLevel)} className="w-16 sm:w-28 h-40 sm:h-64 rounded-[2.5rem] sm:rounded-[4.5rem] soul-glass border-white/10 flex flex-col items-center justify-center gap-6 sm:gap-12 hover:border-soul-glow hover:scale-110 active:scale-95 transition-all group shadow-2xl"><span className="text-3xl sm:text-6xl font-black group-hover:text-soul-glow">{level}</span><div className="flex flex-col gap-2 sm:gap-4">{[...Array(level)].map((_, i) => <div key={i} className="w-2 sm:w-3.5 h-2 sm:h-3.5 rounded-full bg-soul-glow shadow-glow" />)}</div></button>))}</div>)}
    </div>
  );

  const renderReview = () => {
    const dailyCompletedCount = tasks.filter(t => t.isCompleted).length;
    const dailyTotalCount = tasks.length;
    const dailyRate = dailyTotalCount > 0 ? Math.round((dailyCompletedCount / dailyTotalCount) * 100) : 0;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-10 text-center animate-in fade-in relative overflow-y-auto">
        <button onClick={() => setState('dashboard')} className="absolute top-10 left-10 px-6 py-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all flex items-center gap-2 font-black border-white/10"><ArrowLeft size={18} /> 返回</button>
        <div className="soul-glass p-8 sm:p-12 rounded-[2.5rem] border-white/10 max-w-xl w-full space-y-10 shadow-glow-lg my-12">
            <div className="space-y-3">
              <div className="inline-block px-4 py-1.5 soul-glass rounded-full text-soul-glow text-[10px] font-black uppercase tracking-widest border border-soul-glow/30 shadow-glow">今日复盘</div>
              <h2 className="text-4xl sm:text-5xl font-black italic tracking-tighter leading-none">今日复盘</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="soul-glass p-5 rounded-2xl border-white/5 bg-white/[0.02]">
                  <p className="text-[8px] font-black text-soul-glow uppercase tracking-widest mb-1">今日完成率</p>
                  <p className="text-4xl font-black italic tracking-tighter">{dailyRate}%</p>
               </div>
               <div className="soul-glass p-5 rounded-2xl border-white/5 bg-white/[0.02]">
                  <p className="text-[8px] font-black text-soul-muted uppercase tracking-widest mb-1">任务统计</p>
                  <p className="text-4xl font-black italic tracking-tighter">{dailyCompletedCount}/{dailyTotalCount}</p>
               </div>
            </div>

            <div className="space-y-4 text-left max-h-[30vh] overflow-y-auto pr-2 custom-scrollbar">
               <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] px-2">流转清单</span>
               {tasks.length > 0 ? tasks.map(t => (
                 <div key={t.id} className="flex items-center justify-between p-4 soul-glass rounded-2xl border-white/5">
                   <div className="flex items-center gap-3">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.isCompleted ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/20'}`}>
                       {t.isCompleted ? <Check size={16} /> : <X size={16} />}
                     </div>
                     <span className={`font-bold text-sm ${t.isCompleted ? 'text-white/80' : 'text-white/30 italic'}`}>{t.title}</span>
                   </div>
                   <span className="text-[10px] text-white/20 font-mono">{t.startTime}</span>
                 </div>
               )) : <p className="text-center text-white/10 py-4 italic">暂无任务数据</p>}
            </div>
            <button onClick={() => setState('dashboard')} className="w-full py-6 bg-soul-glow text-soul-deep rounded-[1.8rem] sm:rounded-[3rem] font-black text-xl sm:text-2xl shadow-glow active:scale-95 transition-all">锁定复盘</button>
        </div>
      </div>
    );
  };

  if (state === 'onboarding') return renderOnboarding();
  if (state === 'dashboard') return renderDashboard();
  if (state === 'monk-mode') return renderMonkMode();
  if (state === 'transition') return (
    <div className="min-h-screen bg-soul-deep flex flex-col items-center justify-center p-8 space-y-16 animate-in fade-in duration-700">
       <div className="relative"><div className="w-48 h-48 sm:w-64 sm:h-64 rounded-full border-4 border-soul-glow/20 flex items-center justify-center animate-pulse-slow"><Wind className="text-soul-glow animate-float" size={60} /></div></div>
       <div className="text-center space-y-6"><h2 className="text-4xl sm:text-5xl font-black text-white italic">强制转场：离线留白</h2><p className="text-soul-muted text-lg sm:text-xl max-w-lg leading-relaxed">让刚才的专注慢慢沉淀，给大脑一个温和的落地。</p></div>
       <button onClick={() => setState('dashboard')} className="px-12 py-4 sm:px-16 sm:py-6 soul-glass border-soul-glow/20 text-soul-glow rounded-full font-black text-lg sm:text-xl shadow-glow">回归流转</button>
    </div>
  );
  if (state === 'checkin') return renderCheckin();
  if (state === 'review') return renderReview();
  if (state === 'report') return renderReport();

  return null;
};

export default App;
