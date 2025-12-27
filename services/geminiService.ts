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
你是个名叫 Kairos 的个人能量调度专家，擅长为执行功能障碍或 ADHD 倾向的人设计“阻力最小”的日程。

# 任务目标
生成一份从 ${activeWindow.start} 到 ${activeWindow.end} 的【无缝能量流日程】。

# 输入数据
- 今日能量评分：${energy}/5 (1=极度疲惫, 5=精力充沛)
- 原始任务池：${JSON.stringify(baseTasks)}

# 核心调度原则
1. **能量与时长对等**：
   - **高能量 (4-5)**：愿望池任务总时长必须满足今日目标。
   - **低能量 (1-2)**：任务可大幅缩短或取消，以休息为主。
2. **能量节奏控速 (Energy Rhythm) - 核心规则**：
   - **不要连续出现超过 2 个高能耗任务**。
   - 每安排 1-2 个“high”能耗任务后，必须穿插一个“low”能耗任务或一个名为“能量留白”的 15 分钟休息。
   - 这对于保持多巴胺平衡和防止手机依赖（因为疲惫而刷手机）至关重要。
3. **任务分块 (Task Chunking)**：
   - 超过 90 分钟的任务应拆分为 30-45 分钟的小块，并利用低能耗间隙进行转场。
4. **描述具体化**：说明为什么这样安排节奏（例如：“通过能量间隙，我们让你的前额叶皮层得到喘息”）。

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