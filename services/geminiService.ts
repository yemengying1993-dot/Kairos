
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
你是个名叫 Kairos 的个人能量调度专家。你专门服务于一位有失眠困扰、疑似 ADHD 倾向、且容易无意识刷手机的用户。

# 任务目标
生成一份从 ${activeWindow.start} 到 ${activeWindow.end} 的【无缝能量流日程】。

# 输入数据
- 今日能量评分：${energy}/5 (1=极度疲惫, 5=精力充沛)
- 原始任务池（包含固定锚点和愿望任务）：
${JSON.stringify(baseTasks)}

# 调度原则 (Constraints)
1. 【固定日程优先】：所有 "isHardBlock: true" 的任务必须保留其原始 startTime 和 duration，它们是全天的锚点。
2. 【愿望填充】：在固定日程之间的空白时间段，挑选愿望池 (isWish: true) 中的任务进行填充。
3. 【能量匹配】：
   - high 能耗任务（如深度学习、工作）必须安排在能量评分对应的“黄金时段”。
   - low 能耗任务安排在过渡期。
4. 【灵活休息与自我关怀】：
   - 如果评分低 (1-2)，必须大幅增加“低能耗”休息块，如：冥想、小睡、听轻音乐、5分钟拉伸。
   - 如果评分高 (4-5)，可以安排更密集的愿望任务，但每完成一个高能耗任务，必须插入 10 分钟的“无脑时间”（如刷会儿感兴趣但不沉迷的内容、发呆）。
5. 【ADHD 友好过渡】：
   - 严禁任务切换时没有缓冲区。任务之间建议插入 5-15 分钟的“转场缓冲”。
   - 任务块建议控制在 25-90 分钟之间。

# 输出要求
请返回一个 JSON 数组，必须包含且仅包含以下字段：id, title, duration, energyCost, isHardBlock, startTime。
确保全天时间线逻辑连贯，不重叠，且覆盖全天活跃窗口。
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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

export const chatWithAssistant = async (
  message: string, 
  history: ChatMessage[], 
  context: { energy: EnergyLevel | null; tasks: Task[] }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const systemInstruction = `
你名叫 Kairos，一位温馨、非指责型的个人能量管理专家。
你服务的是有 ADHD 倾向的用户，说话要简练、事实驱动。
你可以调用工具来添加固定日程、修改愿望池、或调整今天的任务。
当前时间：${new Date().toLocaleTimeString()}
当前电量：${context.energy}/5。
今日任务状态：${JSON.stringify(context.tasks.map(t => ({ title: t.title, time: t.startTime, completed: t.isCompleted })))}
`;
  
  const chat = ai.chats.create({ 
    model: 'gemini-3-pro-preview', 
    config: { 
      systemInstruction,
      tools: [{ functionDeclarations: controlScheduleTools }]
    } 
  });
  
  const response = await chat.sendMessage({ message });
  return {
    text: response.text,
    functionCalls: response.functionCalls
  };
};
