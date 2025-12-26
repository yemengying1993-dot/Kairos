
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Plus, ArrowRight, Clock, Zap, Lock, X, Wind, Sparkles, Trash2, Calendar, Target, 
  ArrowLeft, Sun, Moon, Timer, Check, Coffee, BatteryCharging, Info, 
  Play, Pause, Volume2, CheckCircle2, Star, MessageSquare,
  CloudRain, Coffee as CoffeeIcon, Waves, Music, BellRing, Settings2, Edit3,
  ChevronLeft, Mic, MicOff, BarChart3, History, Award, TrendingUp, Loader2, MousePointer2
} from 'lucide-react';
import { AppState, EnergyLevel, Task, DailyRecord } from './types';
import { getDynamicSchedule } from './services/geminiService';
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

const App: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedDate] = useState(getLocalDateString(new Date()));
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

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
    if (lastOnboardingWeek !== currentWeek.toString()) return 'onboarding';
    return 'checkin';
  });

  const [onboardingStep, setOnboardingStep] = useState<'hours' | 'fixed' | 'wishes'>('hours');
  const [activeHours, setActiveHours] = useState(() => loadStored('kairos_active_hours', { start: '08:00', end: '23:00' }));
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);

  const [fixedTasks, setFixedTasks] = useState<Task[]>(() => loadStored('kairos_fixed_tasks', [
    { 
      id: 'f-0', 
      title: '营养早餐', 
      duration: 30, 
      energyCost: 'low', 
      isHardBlock: true, 
      startTime: '09:00', 
      endTime: '09:30', 
      recurringDays: [0, 1, 2, 3, 4, 5, 6] 
    },
    { 
      id: 'f-1', 
      title: '普拉提课', 
      duration: 120, 
      energyCost: 'medium', 
      isHardBlock: true, 
      startTime: '12:00', 
      endTime: '14:00', 
      recurringDays: [1, 3, 5] 
    }
  ]));
  const [wishes, setWishes] = useState<Task[]>(() => loadStored('kairos_wishes', [
    { id: 'w-1', title: '理财学习', duration: 45, energyCost: 'high', isHardBlock: false, isWish: true },
    { id: 'w-2', title: '创意写作', duration: 60, energyCost: 'high', isHardBlock: false, isWish: true }
  ]));

  const [isAddingOnboardingItem, setIsAddingOnboardingItem] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');
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
    if (tasks.length > 0 && energy) {
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

  // 计算当前正在进行的任务及其剩余时间
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
      const remaining = endMinutes - nowMinutes;
      return { ...task, remainingMinutes: Math.max(1, remaining) };
    }
    return null;
  }, [tasks, currentTime]);

  const handleCheckIn = async (score: EnergyLevel) => {
    setLoading(true);
    setEnergy(score);
    try {
      const dateObj = new Date(selectedDate);
      const dayIndex = dateObj.getDay();
      const relevantFixed = fixedTasks.filter(t => t.recurringDays?.includes(dayIndex));
      const scheduled = await getDynamicSchedule(score, [...relevantFixed, ...wishes], activeHours);
      if (scheduled && Array.isArray(scheduled)) {
        const newTasks = scheduled.map((t: any) => ({
          ...t, 
          isCompleted: false,
          energyCost: t.energyCost || 'medium'
        }));
        setTasks(newTasks);
        setState('dashboard');
      }
    } catch (e) {
      const dateObj = new Date(selectedDate);
      const dayIndex = dateObj.getDay();
      const relevantFixed = fixedTasks.filter(t => t.recurringDays?.includes(dayIndex));
      setTasks(relevantFixed.map(t => ({ ...t, isCompleted: false })));
      setState('dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleDashboardTaskEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setNewItemTitle(task.title);
    setNewItemStart(task.startTime || '09:00');
    setNewItemDuration(task.duration);
    setNewItemEnergy(task.energyCost);
  }, []);

  const saveDashboardTask = () => {
    if (!newItemTitle.trim()) return;
    const updatedTask: Task = {
      ...editingTask!,
      title: newItemTitle,
      startTime: newItemStart,
      duration: newItemDuration,
      energyCost: newItemEnergy
    };
    if (editingTask?.id === 'new') {
      updatedTask.id = Math.random().toString(36).substr(2, 9);
      setTasks(prev => [...prev, updatedTask].sort((a,b) => (a.startTime||'').localeCompare(b.startTime||'')));
    } else {
      setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t).sort((a,b) => (a.startTime||'').localeCompare(b.startTime||'')));
    }
    setEditingTask(null);
  };

  const deleteDashboardTask = (id: string) => {
    if (confirm('确定删除此任务？')) {
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const startMonkMode = useCallback((taskId: string) => {
    setFocusedTaskId(taskId);
    setState('monk-mode');
  }, []);

  const completeFocusTask = useCallback(() => {
    setTasks(prev => {
        if (!focusedTaskId) return prev;
        return prev.map(t => t.id === focusedTaskId ? { ...t, isCompleted: true } : t);
    });
    setState('transition');
  }, [focusedTaskId]);

  const finishOnboarding = () => {
    localStorage.setItem('kairos_week_done', getWeekNumber(new Date()).toString());
    setState('checkin');
  };

  const calculateDuration = (start: string, end: string) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    return diff > 0 ? diff : 60;
  };

  const renderMonkMode = () => {
    const task = tasks.find(t => t.id === focusedTaskId);
    // 使用计算出的实际剩余分钟数，如果无法计算则退回到 duration
    let monkDuration = task?.duration || 25;
    if (task && task.id === activeTask?.id) {
      monkDuration = activeTask.remainingMinutes;
    }
    
    return (
      <div className="min-h-screen bg-soul-deep flex flex-col items-center justify-center p-6 space-y-12 animate-in fade-in duration-1000">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 text-soul-glow animate-pulse">
            <Lock size={20} />
            <span className="text-xs font-black uppercase tracking-[0.5em]">深度专注模式</span>
          </div>
          <h2 className="text-4xl sm:text-6xl font-black text-white italic tracking-tighter">{task?.title || '专注当下'}</h2>
        </div>
        <TaskCountdown duration={monkDuration} onComplete={completeFocusTask} />
        <div className="flex flex-col items-center gap-8">
          <p className="text-soul-muted/40 italic text-base sm:text-lg max-w-md text-center">此时此刻，全世界只有你和这项任务。关闭所有干扰，回归纯粹。</p>
          <div className="flex gap-4">
            <button onClick={completeFocusTask} className="px-8 sm:px-12 py-4 sm:py-6 bg-white text-soul-deep rounded-[2rem] sm:rounded-[2.5rem] font-black text-lg sm:text-xl shadow-glow active:scale-95 transition-all flex items-center gap-3 hover:bg-soul-glow"><Check size={24} /> 我已完成</button>
            <button onClick={() => setState('dashboard')} className="px-6 sm:px-8 py-4 sm:py-6 soul-glass border-white/10 rounded-[2rem] sm:rounded-[2.5rem] text-white/40 font-bold hover:text-white transition-all text-sm sm:text-base">提前结束</button>
          </div>
        </div>
      </div>
    );
  };

  const renderTransition = () => (
    <div className="min-h-screen bg-soul-deep flex flex-col items-center justify-center p-8 space-y-16 animate-in fade-in duration-700">
       <div className="relative">
          <div className="w-48 h-48 sm:w-64 sm:h-64 rounded-full border-4 border-soul-glow/20 flex items-center justify-center animate-pulse-slow"><Wind className="text-soul-glow animate-float" size={60} /></div>
          <div className="absolute inset-0 rounded-full border-4 border-t-soul-glow border-r-transparent border-b-transparent border-l-transparent animate-spin duration-[4000ms]" />
       </div>
       <div className="text-center space-y-6">
          <h2 className="text-4xl sm:text-5xl font-black text-white italic">强制转场：离线留白</h2>
          <p className="text-soul-muted text-lg sm:text-xl max-w-lg leading-relaxed">别急着拿起手机。深呼吸 5 次。<br/>让刚才的专注慢慢沉淀，给大脑一个温和的落地。</p>
       </div>
       <button onClick={() => setState('dashboard')} className="px-12 py-4 sm:px-16 sm:py-6 soul-glass border-soul-glow/20 text-soul-glow rounded-full font-black text-lg sm:text-xl shadow-glow animate-in fade-in [animation-delay:3s]">回归流转</button>
    </div>
  );

  const renderDashboard = () => (
    <div className="min-h-screen pb-24 animate-in fade-in duration-500">
      <div className="pt-6 sm:pt-10 px-6 sm:px-8 sticky top-0 bg-[#0B1026]/95 backdrop-blur-3xl z-40 border-b border-white/5 pb-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="text-left">
            <h1 className="text-3xl sm:text-4xl font-black soul-gradient-text tracking-tighter italic leading-none">Kairos</h1>
            <div className="flex items-center gap-2 mt-1 text-[8px] sm:text-[10px] font-black uppercase tracking-[0.3em] text-soul-glow opacity-80">
              <span className="flex items-center gap-1"><Calendar size={10} /> {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
            </div>
          </div>
          <div className="flex gap-2">
             <button onClick={() => setState('report')} title="每周结案总结" className="px-4 py-2.5 soul-glass rounded-xl flex items-center gap-2 text-[10px] font-black text-soul-amber border border-soul-amber/20 hover:bg-soul-amber/10 transition-all"><BarChart3 size={16} /><span className="hidden sm:inline">每周总结</span></button>
             <button onClick={() => setState('review')} title="每日晚间结案" className="px-4 py-2.5 soul-glass rounded-xl flex items-center gap-2 text-[10px] font-black text-soul-muted hover:text-white transition-all border border-white/10"><CheckCircle2 size={16} /><span className="hidden sm:inline">每日总结</span></button>
             <button onClick={() => setState('checkin')} className="w-10 h-10 soul-glass rounded-xl flex items-center justify-center text-soul-glow border border-soul-glow/20 hover:bg-soul-glow/10 transition-all"><Zap size={18} /></button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-4">
           <EnergyCurve energy={energy || 3} />
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-6 px-6 sm:px-8 space-y-10">
        {activeTask && (
          <div onClick={() => startMonkMode(activeTask.id)} className="group cursor-pointer p-0.5 soul-glass rounded-[2.5rem] border-soul-glow/30 shadow-glow animate-in zoom-in-95 active:scale-95 transition-all">
             <div className="bg-soul-glow/5 p-8 rounded-[2.4rem] flex flex-col sm:flex-row justify-between items-center gap-6 sm:gap-10">
                <div className="text-center sm:text-left space-y-3">
                   <div className="flex items-center justify-center sm:justify-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] font-black text-soul-glow uppercase tracking-[0.3em]">正在流转中</span>
                   </div>
                   <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight italic tracking-tight">{activeTask.title}</h2>
                   <div className="flex items-center justify-center sm:justify-start gap-4">
                      <p className="text-white/40 text-xs font-bold flex items-center gap-1.5 italic"><Clock size={14} /> {activeTask.startTime}</p>
                      <p className="text-white/40 text-xs font-bold flex items-center gap-1.5 italic"><Timer size={14} /> 剩 {activeTask.remainingMinutes} 分钟</p>
                   </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                   <div className="w-16 h-16 rounded-full bg-soul-glow flex items-center justify-center text-soul-deep shadow-glow group-hover:scale-110 transition-transform"><Play size={24} fill="currentColor" className="ml-1" /></div>
                   <span className="text-[8px] font-black uppercase text-soul-glow opacity-60">开启专注</span>
                </div>
             </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-2xl font-black text-white flex items-center gap-3 italic tracking-tighter"><Clock className="text-soul-glow" size={24}/> 今日时间流</h3>
             <button onClick={() => handleDashboardTaskEdit({ id: 'new', title: '', duration: 30, energyCost: 'medium', isHardBlock: false, startTime: '09:00' } as Task)} className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/50 text-[10px] font-black uppercase tracking-widest transition-all"><Plus size={14} /> 临时任务</button>
          </div>

          {tasks.length === 0 ? (
            <div className="py-20 text-center space-y-6 animate-in fade-in">
               <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto text-white/10"><History size={32} /></div>
               <p className="text-white/30 text-lg italic font-medium">尚未同步今日能量流转</p>
               <button onClick={() => setState('checkin')} className="px-10 py-4 bg-soul-glow text-soul-deep rounded-xl font-black shadow-glow active:scale-95 transition-all text-base">即刻同步</button>
            </div>
          ) : (
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
                         <div className="flex justify-between items-start">
                            <div className="space-y-0.5">
                               <p className={`text-[8px] sm:text-[10px] font-black uppercase tracking-[0.15em] ${isActive ? 'text-soul-glow' : 'text-white/30'}`}>{task.startTime} · {task.duration}M</p>
                               <h3 className={`text-xl sm:text-2xl font-black tracking-tight leading-tight ${task.isCompleted ? 'line-through text-white/20' : 'text-white/90'}`}>{task.title}</h3>
                            </div>
                            <span className={`text-[7px] px-2 py-0.5 rounded-full border font-black uppercase tracking-widest ${task.energyCost === 'high' ? 'text-red-400 border-red-400/20' : task.energyCost === 'medium' ? 'text-soul-amber border-soul-amber/20' : 'text-emerald-400 border-emerald-400/20'}`}>{task.energyCost === 'high' ? '高耗' : task.energyCost === 'medium' ? '常规' : '轻量'}</span>
                         </div>
                         <div className="flex justify-between items-center pt-1">
                            <div className="flex gap-2 text-[8px] font-black uppercase tracking-widest">
                               {isActive && <span className="text-soul-glow animate-pulse">进行中</span>}
                               {task.isCompleted && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> 已完成</span>}
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3">
                               {!task.isCompleted && <button onClick={(e) => { e.stopPropagation(); deleteDashboardTask(task.id); }} className="p-2 text-white/20 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>}
                               <button onClick={(e) => { e.stopPropagation(); setTasks(p => p.map(t=>t.id===task.id?{...t, isCompleted:!t.isCompleted}:t)); }} className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border flex items-center justify-center transition-all ${task.isCompleted ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : 'border-white/10 text-transparent hover:border-emerald-500/40'}`}><Check size={18} /></button>
                            </div>
                         </div>
                      </div>
                   </div>
                 );
               })}
            </div>
          )}
        </div>
      </div>

      {editingTask && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-soul-deep/95 backdrop-blur-2xl" onClick={() => setEditingTask(null)} />
          <div className="relative w-full max-w-lg soul-glass p-8 rounded-[2.5rem] border-white/10 shadow-glow-lg space-y-8 animate-in zoom-in-95">
             <div className="flex justify-between items-center"><h3 className="text-2xl font-black text-white italic tracking-tight">调整流转瞬间</h3><button onClick={() => setEditingTask(null)} className="p-2 text-white/30 hover:text-white transition-all"><X size={24} /></button></div>
             <div className="space-y-6">
                <div className="space-y-2"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">任务名称</span><input autoFocus value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-black text-xl outline-none focus:border-soul-glow" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">开始</span><input type="time" value={newItemStart} onChange={(e) => setNewItemStart(e.target.value)} className="w-full soul-glass rounded-2xl p-4 font-black text-xl text-center border-white/10" /></div>
                  <div className="space-y-2"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-1">时长(分)</span><input type="number" value={newItemDuration} onChange={(e) => setNewItemDuration(parseInt(e.target.value)||30)} className="w-full soul-glass rounded-2xl p-4 font-black text-xl text-center border-white/10" /></div>
                </div>
                <div className="grid grid-cols-3 gap-2">{(['low', 'medium', 'high'] as const).map(level => (<button key={level} onClick={() => setNewItemEnergy(level)} className={`py-3 rounded-xl border text-[10px] font-black transition-all ${newItemEnergy === level ? 'bg-soul-glow text-soul-deep border-soul-glow shadow-glow' : 'text-white/30 border-white/10'}`}>{level === 'low' ? '轻量' : level === 'medium' ? '常规' : '高耗'}</button>))}</div>
             </div>
             <button onClick={saveDashboardTask} className="w-full py-5 bg-soul-glow text-soul-deep rounded-[1.5rem] font-black text-lg shadow-glow active:scale-95 transition-all">保存流转计划</button>
          </div>
        </div>
      )}

      <button onClick={() => setIsChatOpen(true)} className="fixed bottom-6 right-6 w-16 h-16 sm:w-20 sm:h-20 soul-glass text-soul-glow rounded-full shadow-glow-lg flex items-center justify-center z-50 animate-float border border-soul-glow/20 active:scale-90 transition-all"><MessageSquare size={28} /></button>
      <AIChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} energy={energy} tasks={tasks} onAddFixed={(t) => setFixedTasks(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2,9), isHardBlock: true } as Task])} onAddWish={(t) => setWishes(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2,9), isWish: true } as Task])} onModifyHours={(h) => setActiveHours(prev => ({...prev, ...h}))} onModifyToday={(t) => setTasks(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2,9), isCompleted: false } as Task].sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||'')))} />
    </div>
  );

  const renderOnboarding = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-10 animate-in fade-in duration-700 text-center">
      <div className="space-y-4">
        <h1 className="text-6xl sm:text-7xl font-black soul-gradient-text tracking-tighter italic leading-none">Kairos</h1>
        <p className="text-soul-muted font-black tracking-[0.4em] text-[10px] uppercase">本周基准校准</p>
      </div>
      <div className="soul-glass p-8 sm:p-10 rounded-[2.5rem] w-full max-w-lg space-y-8 relative overflow-hidden shadow-2xl border-white/10">
        <div className="flex justify-between items-center px-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">{onboardingStep === 'hours' ? "起止窗口" : onboardingStep === 'fixed' ? "固定日程" : "愿望池"}</h2>
          <div className="flex gap-1">
            <div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'hours' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} />
            <div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'fixed' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} />
            <div className={`h-1 rounded-full transition-all duration-500 ${onboardingStep === 'wishes' ? 'bg-soul-glow w-5' : 'bg-white/10 w-2'}`} />
          </div>
        </div>
        {onboardingStep === 'hours' && (
          <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-right-10">
            <label className="soul-glass p-5 rounded-[1.5rem] space-y-2 block cursor-pointer"><span className="text-[8px] font-black uppercase text-soul-glow/50 flex items-center justify-center gap-1.5"><Sun size={10}/> 苏醒</span><input type="time" value={activeHours.start} onChange={(e) => setActiveHours(p => ({ ...p, start: e.target.value }))} className="text-2xl text-center w-full font-black" /></label>
            <label className="soul-glass p-5 rounded-[1.5rem] space-y-2 block cursor-pointer"><span className="text-[8px] font-black uppercase text-soul-muted/50 flex items-center justify-center gap-1.5"><Moon size={10}/> 歇息</span><input type="time" value={activeHours.end} onChange={(e) => setActiveHours(p => ({ ...p, end: e.target.value }))} className="text-2xl text-center w-full font-black" /></label>
          </div>
        )}
        {onboardingStep !== 'hours' && (
          <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar animate-in slide-in-from-right-10">
            {(onboardingStep === 'fixed' ? fixedTasks : wishes).map((task) => (
              <div key={task.id} className="flex flex-col p-4 soul-glass rounded-xl border-white/5 text-left group gap-1.5">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <p className="font-bold text-white/90 text-sm">{task.title}</p>
                    <p className="text-[10px] text-white/30">
                      {task.isHardBlock ? (
                        <span className="flex items-center gap-1.5">
                          <Calendar size={10} className="text-soul-glow/50" />
                          {task.recurringDays?.length === 7 ? '每天' : `周${task.recurringDays?.map(d => WEEK_DAYS[d]).join('')}`}
                          <span className="mx-1 opacity-30">|</span>
                          <Clock size={10} className="text-soul-glow/50" />
                          {task.startTime} - {task.endTime}
                        </span>
                      ) : `${task.duration}M`}
                    </p>
                  </div>
                  <button onClick={() => onboardingStep === 'fixed' ? setFixedTasks(p => p.filter(t=>t.id!==task.id)) : setWishes(p => p.filter(t=>t.id!==task.id))} className="text-white/10 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!isAddingOnboardingItem ? (
              <button onClick={() => setIsAddingOnboardingItem(true)} className="w-full py-6 bg-white/5 border-2 border-dashed border-white/10 rounded-[1.5rem] text-white/20 flex items-center justify-center gap-2 hover:text-soul-glow transition-all font-bold text-sm"><Plus size={20} /> 添加基准</button>
            ) : (
              <div className="p-6 soul-glass rounded-[2rem] space-y-5 text-left border-soul-glow/20 animate-in zoom-in-95">
                <input autoFocus value={newItemTitle} onChange={(e) => setNewItemTitle(e.target.value)} placeholder="名称..." className="w-full bg-white/5 rounded-xl px-4 py-3 text-white outline-none border border-white/10 font-bold text-sm" />
                <div className="grid grid-cols-3 gap-1.5">{(['low', 'medium', 'high'] as const).map(level => (<button key={level} onClick={() => setNewItemEnergy(level)} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${newItemEnergy === level ? 'bg-soul-glow text-soul-deep border-soul-glow' : 'text-white/30 border-white/10'}`}>{level === 'low' ? '低能' : level === 'medium' ? '中能' : '高能'}</button>))}</div>
                {onboardingStep === 'fixed' ? (
                  <>
                    <div className="flex justify-between gap-1">{[0,1,2,3,4,5,6].map(d => (<button key={d} onClick={() => setNewItemDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d].sort())} className={`w-7 h-7 rounded-full text-[8px] font-black border transition-all ${newItemDays.includes(d) ? 'bg-soul-glow text-soul-deep border-soul-glow' : 'text-white/20 border-white/10'}`}>{WEEK_DAYS[d]}</button>))}</div>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="time" value={newItemStart} onChange={(e) => setNewItemStart(e.target.value)} className="soul-glass rounded-xl p-2.5 text-center text-sm" />
                      <input type="time" value={newItemEnd} onChange={(e) => setNewItemEnd(e.target.value)} className="soul-glass rounded-xl p-2.5 text-center text-sm" />
                    </div>
                  </>
                ) : (<input type="number" value={newItemDuration} onChange={(e) => setNewItemDuration(parseInt(e.target.value)||30)} className="w-full soul-glass rounded-xl p-3 text-sm" placeholder="时长(分)" />)}
                <div className="flex gap-2">
                  <button onClick={() => {
                    if(!newItemTitle.trim()) return;
                    const isFixed = onboardingStep === 'fixed';
                    const newTask: Task = { 
                      id: Math.random().toString(36).substr(2, 9), 
                      title: newItemTitle, 
                      duration: isFixed ? calculateDuration(newItemStart, newItemEnd) : newItemDuration, 
                      energyCost: newItemEnergy, 
                      isHardBlock: isFixed, 
                      isWish: !isFixed, 
                      startTime: isFixed ? newItemStart : undefined, 
                      endTime: isFixed ? newItemEnd : undefined,
                      recurringDays: isFixed ? [...newItemDays] : [0, 1, 2, 3, 4, 5, 6]
                    };
                    if (isFixed) setFixedTasks(prev => [...prev, newTask]);
                    else setWishes(prev => [...prev, newTask]);
                    setIsAddingOnboardingItem(false); 
                    setNewItemTitle('');
                  }} className="flex-1 py-3 bg-soul-glow text-soul-deep rounded-xl font-black text-sm">确定</button>
                  <button onClick={() => setIsAddingOnboardingItem(false)} className="px-4 py-3 text-white/30 font-bold text-sm">取消</button>
                </div>
              </div>
            )}
          </div>
        )}
        <button onClick={() => {
            if (onboardingStep === 'hours') setOnboardingStep('fixed');
            else if (onboardingStep === 'fixed') setOnboardingStep('wishes');
            else finishOnboarding();
          }} className="w-full py-5 bg-white text-soul-deep rounded-[1.8rem] font-black flex items-center justify-center gap-2 shadow-2xl hover:bg-soul-glow transition-all text-lg">{onboardingStep === 'wishes' ? "完成设定" : "继续"} <ArrowRight size={20} /></button>
      </div>
    </div>
  );

  const renderCheckin = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-12 text-center animate-in fade-in relative overflow-hidden">
        {tasks.length > 0 && <button onClick={() => setState('dashboard')} className="absolute top-10 left-10 px-6 py-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all flex items-center gap-2 font-black border-white/10 shadow-xl"><ArrowLeft size={18} /> 返回</button>}
        <div className="space-y-4 max-w-lg">
           <h2 className="text-5xl sm:text-7xl font-black text-white italic tracking-tighter leading-none">能量同步</h2>
           <p className="text-xl sm:text-2xl text-soul-muted italic font-medium">此刻你的“电量”是多少？</p>
        </div>
        {loading ? (
          <div className="flex flex-col items-center gap-6 py-10">
            <div className="w-20 h-20 soul-glass rounded-full flex items-center justify-center border-soul-glow/40 shadow-glow animate-spin"><Loader2 className="text-soul-glow" size={40} /></div>
            <p className="text-soul-glow font-black tracking-[0.3em] uppercase text-xs animate-pulse">Kairos 正在调度...</p>
          </div>
        ) : (
          <div className="flex gap-4 sm:gap-8 flex-wrap justify-center">
            {[1, 2, 3, 4, 5].map((level) => (
              <button key={level} onClick={() => handleCheckIn(level as EnergyLevel)} className="w-16 sm:w-28 h-40 sm:h-64 rounded-[2.5rem] sm:rounded-[4.5rem] soul-glass border-white/10 flex flex-col items-center justify-center gap-6 sm:gap-12 hover:border-soul-glow hover:scale-110 active:scale-95 transition-all group shadow-2xl">
                <span className="text-3xl sm:text-6xl font-black group-hover:text-soul-glow">{level}</span>
                <div className="flex flex-col gap-2 sm:gap-4">{[...Array(level)].map((_, i) => <div key={i} className="w-2 sm:w-3.5 h-2 sm:h-3.5 rounded-full bg-soul-glow shadow-glow" />)}</div>
              </button>
            ))}
          </div>
        )}
    </div>
  );

  const renderReview = () => {
    const completedCount = tasks.filter(t => t.isCompleted).length;
    const totalCount = tasks.length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-10 text-center animate-in fade-in relative overflow-y-auto">
        <button onClick={() => setState('dashboard')} className="absolute top-10 left-10 px-6 py-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all flex items-center gap-2 font-black border-white/10"><ArrowLeft size={18} /> 返回</button>
        <div className="soul-glass p-8 sm:p-12 rounded-[2.5rem] border-white/10 max-w-xl w-full space-y-10 shadow-glow-lg my-12">
            <div className="space-y-3">
              <div className="inline-block px-4 py-1.5 soul-glass rounded-full text-soul-glow text-[10px] font-black uppercase tracking-widest border border-soul-glow/30 shadow-glow">每日总结</div>
              <h2 className="text-4xl sm:text-5xl font-black italic tracking-tighter leading-none">晚间结案</h2>
              <p className="text-soul-muted italic text-base sm:text-lg">今日能量流转：{completionRate}% 达成</p>
            </div>

            {/* 今日流转清单 */}
            <div className="space-y-4 text-left max-h-[30vh] overflow-y-auto pr-2 custom-scrollbar">
               <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] px-2">流转清单</span>
               {tasks.map(t => (
                 <div key={t.id} className="flex items-center justify-between p-4 soul-glass rounded-2xl border-white/5">
                   <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.isCompleted ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/20'}`}>
                        {t.isCompleted ? <Check size={16} /> : <X size={16} />}
                      </div>
                      <span className={`font-bold text-sm ${t.isCompleted ? 'text-white/80' : 'text-white/30 italic'}`}>{t.title}</span>
                   </div>
                   <span className="text-[10px] text-white/20 font-mono">{t.startTime}</span>
                 </div>
               ))}
            </div>

            <div className="space-y-4 text-left">
               <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] px-2">明日的一个愿景</span>
               <input placeholder="写下明日的一个关键指向..." className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white font-black text-lg focus:border-soul-glow/50 outline-none transition-all" />
            </div>

            <button onClick={() => setState('dashboard')} className="w-full py-6 bg-soul-glow text-soul-deep rounded-[1.8rem] sm:rounded-[3rem] font-black text-xl sm:text-2xl shadow-glow active:scale-95 transition-all">锁定今日状态</button>
        </div>
      </div>
    );
  };

  const renderReport = () => (
    <div className="fixed inset-0 z-[500] bg-soul-deep overflow-y-auto p-6 animate-in fade-in duration-500">
       <div className="max-w-2xl mx-auto py-8 space-y-8">
          <div className="flex justify-between items-center px-2">
            <button onClick={() => setState('dashboard')} className="p-3 soul-glass rounded-xl text-white/50 hover:text-white transition-all"><ChevronLeft size={20}/></button>
            <h2 className="text-2xl sm:text-3xl font-black italic">每周总结结案</h2>
            <div className="w-10 h-10" />
          </div>
          <div className="soul-glass p-8 rounded-[2rem] border-white/5 shadow-2xl space-y-6">
             <div className="grid grid-cols-2 gap-4">
                <div className="soul-glass p-6 rounded-2xl"><p className="text-[8px] font-black text-soul-glow uppercase tracking-widest">能量完成率</p><p className="text-3xl sm:text-5xl font-black mt-1">85%</p></div>
                <div className="soul-glass p-6 rounded-2xl"><p className="text-[8px] font-black text-soul-muted uppercase tracking-widest">深度专注时长</p><p className="text-3xl sm:text-5xl font-black mt-1">12h</p></div>
             </div>
             <div className="p-5 bg-white/[0.02] rounded-xl border border-white/5">
               <p className="text-soul-muted/80 italic leading-relaxed text-sm">“本周你在‘固定日程’上表现出色。普拉提达成率100%。愿望池的学习任务在周三有所松懈，建议下周增加该时段的‘转场缓冲’。”</p>
             </div>
          </div>
          <button onClick={() => setState('dashboard')} className="w-full py-5 bg-white text-soul-deep rounded-2xl font-black text-lg shadow-xl hover:bg-soul-glow transition-all">收下结案反馈</button>
       </div>
    </div>
  );

  if (state === 'onboarding') return renderOnboarding();
  if (state === 'dashboard') return renderDashboard();
  if (state === 'monk-mode') return renderMonkMode();
  if (state === 'transition') return renderTransition();
  if (state === 'checkin') return renderCheckin();
  if (state === 'review') return renderReview();
  if (state === 'report') return renderReport();

  return null;
};

export default App;
