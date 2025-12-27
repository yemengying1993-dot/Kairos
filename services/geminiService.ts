import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Task, EnergyLevel, ChatMessage } from "../types";

const controlScheduleTools: FunctionDeclaration[] = [
  {
    name: "add_fixed_task",
    description: "添加一个新的周循环固定日程（锚点任务）。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "任务标题" },
        startTime: { type: Type.STRING, description: "开始时间 HH:mm" },
        endTime: { type: Type.STRING, description: "结束时间 HH:mm" },
        energyCost: { type: Type.STRING, enum: ["low", "medium", "high"], description: "能耗等级" },
        recurringDays: { 
          type: Type.ARRAY, 
          items: { type: Type.INTEGER }, 
          description: "重复周期 (0=周日, 1=周一...)" 
        }
      },
      required: ["title", "startTime", "endTime", "energyCost"]
    }
  },
  {
    name: "add_wish_task",
    description: "将任务加入愿望池（非固定时间的长期目标）。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "任务标题" },
        energyCost: { type: Type.STRING, enum: ["low", "medium", "high"] },
        duration: { type: Type.NUMBER, description: "预计时长（分钟）" }
      },
      required: ["title", "energyCost"]
    }
  },
  {
    name: "modify_today_plan",
    description: "直接修改用户今天的实时时间规划（临时插入或修改今日任务）。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "任务标题" },
        startTime: { type: Type.STRING, description: "开始时间 HH:mm" },
        duration: { type: Type.NUMBER, description: "持续分钟" },
        energyCost: { type: Type.STRING, enum: ["low", "medium", "high"] }
      },
      required: ["title", "startTime", "duration"]
    }
  }
];

export const getDynamicSchedule = async (
  energy: EnergyLevel, 
  baseTasks: Task[], 
  activeWindow: { start: string; end: string }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
# Role (角色) 
你是个名叫 Kairos 的个人能量调度专家，专门为有执行功能障碍（疑似ADHD）的人设计“无痛执行”的日程。

# 任务目标
生成一份从 ${activeWindow.start} 到 ${activeWindow.end} 的【无缝能量流日程】。

# 输入数据
- 今日能量评分：${energy}/5 (1=极其疲惫/阻力大, 5=精力充沛/心流状态)
- 原始任务池：${JSON.stringify(baseTasks)}

# 核心调度原则 (核心逻辑)
1. **能量守恒与节奏控速 (Energy Rhythm)**：
   - **绝对禁止**安排连续超过 2 个 'high' 能耗的任务。
   - 如果两个 'high' 能耗任务之间没有其他任务，你**必须强制插入**一个名为“能量留白”的 15 分钟任务（能耗设为 'low'）。
   - 这是为了防止大脑过度疲劳导致执行功能崩溃，减少刷手机的冲动。
2. **动态调整**：
   - 能量 < 3 时：优先安排 'low' 和 'medium' 任务，减少 'high' 任务的时长。
   - 能量 >= 4 时：在固定日程之间密集穿插愿望池中的 'high' 任务，以利用多巴胺高峰。
3. **原子化拆分**：
   - 超过 60 分钟的愿望池任务（如投资、外语），请将其拆分为“第一阶段”、“第二阶段”等，穿插在不同的能量窗口。
4. **描述具体化**：请在 description 中简述调度意图（例如：“考虑到你刚完成了高强度的普拉提，我们需要一段留白让神经递质回升”）。

# 约束
- 格式：JSON 数组。
- 时间 HH:mm，严禁重叠。
- 确保涵盖所有固定任务 (isHardBlock: true)。
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            duration: { type: Type.NUMBER },
            energyCost: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
            isHardBlock: { type: Type.BOOLEAN },
            startTime: { type: Type.STRING }
          },
          required: ["id", "title", "duration", "energyCost", "isHardBlock", "startTime"]
        }
      }
    }
  });

  return JSON.parse(response.text?.trim() || "[]");
};

export const getWeeklyInsight = async (stats: { completionRate: number, focusMinutes: number, topTasks: string[] }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `你是个名叫 Kairos 的能量管理专家。为用户本周表现提供温暖总结：完成率 ${stats.completionRate}%, 专注 ${Math.round(stats.focusMinutes/60)}h, 常做 ${stats.topTasks.join(', ')}。严禁医学词汇。`;
  const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
  return response.text;
};

export const chatWithAssistant = async (
  message: string, 
  history: ChatMessage[], 
  context: { energy: EnergyLevel | null; tasks: Task[] }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const systemInstruction = `你名叫 Kairos，一位温馨的个人能量助手。不要提及医学诊断词汇。保持温暖、包容。`;
  const chat = ai.chats.create({ 
    model: 'gemini-3-flash-preview', 
    config: { 
      systemInstruction,
      tools: [{ functionDeclarations: controlScheduleTools }]
    } 
  });
  const response = await chat.sendMessage({ message });
  return { text: response.text, functionCalls: response.functionCalls };
};