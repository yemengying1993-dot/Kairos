
import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Sparkles, User, Mic, MicOff } from 'lucide-react';
import { ChatMessage, EnergyLevel, Task } from '../types';
import { chatWithAssistant } from '../services/geminiService';

interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  energy: EnergyLevel | null;
  tasks: Task[];
  onAddFixed: (task: Partial<Task>) => void;
  onAddWish: (task: Partial<Task>) => void;
  onModifyHours: (hours: { start?: string, end?: string }) => void;
  onModifyToday: (task: Partial<Task>) => void;
}

const AIChatDrawer: React.FC<AIChatDrawerProps> = ({ 
  isOpen, onClose, energy, tasks, onAddFixed, onAddWish, onModifyHours, onModifyToday 
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      role: 'model', 
      text: energy && energy <= 2 
        ? "看你今天精神不太好，别太勉强。我们把计划调轻松点，先从最简单的一件事开始做起吧？" 
        : "嗨！我是你的计划小助手 Kairos。你可以直接说话告诉我你想添加什么日程，或者修改几点睡觉。", 
      timestamp: Date.now() 
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'zh-CN';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleSend = async (forcedInput?: string) => {
    const textToSend = forcedInput || input;
    if (!textToSend.trim() || isTyping) return;

    const userMsg: ChatMessage = { role: 'user', text: textToSend, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await chatWithAssistant(textToSend, messages, { energy, tasks });
      
      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          const args = fc.args as any;
          if (fc.name === 'add_fixed_task') {
            onAddFixed(args);
            setMessages(prev => [...prev, { role: 'model', text: `✅ 已为你添加固定日程：${args.title}`, timestamp: Date.now() }]);
          } else if (fc.name === 'add_wish_task') {
            onAddWish(args);
            setMessages(prev => [...prev, { role: 'model', text: `🌟 已将 "${args.title}" 加入愿望池`, timestamp: Date.now() }]);
          } else if (fc.name === 'modify_active_window') {
            onModifyHours(args);
            setMessages(prev => [...prev, { role: 'model', text: `⏰ 作息已调整：${args.start || ''} - ${args.end || ''}`, timestamp: Date.now() }]);
          } else if (fc.name === 'modify_today_plan') {
            onModifyToday(args);
            setMessages(prev => [...prev, { role: 'model', text: `⚡️ 明白，已为你临时添加任务：${args.title} @ ${args.startTime}`, timestamp: Date.now() }]);
          }
        }
      }

      if (response.text) {
        setMessages(prev => [...prev, { role: 'model', text: response.text, timestamp: Date.now() }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'model', text: "哎呀，连接断开了。不过我依然在这里支持你。", timestamp: Date.now() }]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:p-6">
      <div className="absolute inset-0 bg-[#0B1026]/40 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-xl soul-glass rounded-t-[3rem] sm:rounded-[3rem] flex flex-col h-[85vh] overflow-hidden border-white/10 animate-in slide-in-from-bottom-full duration-500">
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#7DF9FF] flex items-center justify-center text-[#0B1026]"><Sparkles size={24} /></div>
            <div>
              <h3 className="font-black text-white text-lg tracking-tight">能量助手</h3>
              <p className="text-[10px] text-[#7DF9FF] font-black uppercase tracking-widest">实时调度中</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 text-white/40"><X size={24} /></button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-white text-[#0B1026] font-bold' : 'soul-glass border-white/10 text-white/90'}`}>{msg.text}</div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="soul-glass border-white/5 p-5 rounded-3xl flex gap-1 items-center">
                <div className="w-1 h-1 bg-[#7DF9FF] rounded-full animate-bounce" /><div className="w-1 h-1 bg-[#7DF9FF] rounded-full animate-bounce [animation-delay:0.2s]" /><div className="w-1 h-1 bg-[#7DF9FF] rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
        </div>

        <div className="p-8 bg-white/[0.02] border-t border-white/5">
          <div className="flex gap-4">
            <button onClick={toggleListening} className={`p-4 rounded-2xl transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'soul-glass text-[#7DF9FF] border-white/10'}`}>
              {isListening ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={isListening ? "正在倾听..." : "想聊点什么..."} className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:ring-2 focus:ring-[#7DF9FF]/30" />
            <button onClick={() => handleSend()} disabled={!input.trim() || isTyping} className="p-4 bg-[#7DF9FF] text-[#0B1026] rounded-2xl disabled:opacity-20"><Send size={24} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatDrawer;
