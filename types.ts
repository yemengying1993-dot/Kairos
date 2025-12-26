
export type EnergyLevel = 1 | 2 | 3 | 4 | 5;

export interface Task {
  id: string;
  title: string;
  duration: number; // minutes
  energyCost: 'high' | 'medium' | 'low';
  isHardBlock: boolean;
  isWish?: boolean;
  isCompleted?: boolean;
  startTime?: string; // HH:mm
  endTime?: string;   // HH:mm
  recurringDays?: number[]; // 0-6 for Sun-Sat
}

export type AppState = 'onboarding' | 'checkin' | 'dashboard' | 'monk-mode' | 'transition' | 'review' | 'intercept' | 'report';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD
  energy: EnergyLevel;
  tasks: Task[];
}
