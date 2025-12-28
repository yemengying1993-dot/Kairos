
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Task, EnergyLevel, ChatMessage } from "../types";

// The Google GenAI SDK MUST be initialized using process.env.API_KEY as per guidelines.
// This key is assumed to be pre-configured and valid in the execution environment.

const controlScheduleTools: FunctionDeclaration[] = [
  {
    name: "add_fixed_task",
    description: "添加一个新的周循环固定日程（锚点任务）。适用于用户想要长期、每天或每周重复的习惯。",
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
    description: "将任务加入愿望池（非固定时间的长期目标）。适用于用户想做但没定好具体时间的事。",
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
    description: "直接修改用户今天的实时时间规划（临时插入、修改或覆盖今日的某个时段）。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "任务标题" },
        startTime: { type: Type.STRING, description: "开始时间 HH:mm" },
        duration: { type: Type.NUMBER, description: "持续分钟" },
        energyCost: { type: Type.STRING, enum: ["low", "medium", "high"] },
        description: { type: Type.STRING, description: "任务的温馨提示" }
      },
      required: ["title", "startTime", "duration"]
    }
  },
  {
    name: "remove_task",
    description: "删除一个任务。请务必使用任务流中出现的准确标题。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "要删除的任务标题。请参考‘今日任务流’中的名称。" }
      },
      required: ["title"]
    }
  }
];

export const getDynamicSchedule = async (
  energy: EnergyLevel, 
  baseTasks: Task[], 
  activeWindow: { start: string; end: string }
) => {
  // Always use process.env.API_KEY directly to initialize.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const prompt = `
# Role (角色) 
你是个名叫 Kairos 的生活流专家，专为 ADHD 和失眠倾向用户设计高效且舒适的每日流转清单。

# 任务目标
利用提供的原始任务池，生成一份从 ${activeWindow.start} 到 ${activeWindow.end} 的【无缝执行清单】。

# 核心约束 (最高优先级)
1. **锚点任务绝对固定 (Fixed Anchor Lock)**：凡是 \`isHardBlock: true\` 且带有 \`startTime\` 的任务，你禁止修改其开始时间。
2. **标题镜像原则 (Title Integrity)**：用户提供的任务标题，你必须原文照搬，严禁修改。
3. **AI 填充项语言风格与描述 (Filler Tasks)**：使用专业、体面的标题（如：正念冥想、肢体拉伸、水分补给、深呼吸放松），并在 \`description\` 字段中提供该任务相关的具体建议。

# 输入上下文
- 能量评分：${energy}/5
- 原始任务池：${JSON.stringify(baseTasks)}

# 输出
- 格式：JSON 数组。
`;

  try {
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
              isWish: { type: Type.BOOLEAN },
              startTime: { type: Type.STRING }
            },
            required: ["id", "title", "description", "duration", "energyCost", "isHardBlock", "isWish", "startTime"]
          }
        }
      }
    });

    const fullText = response.text;
    return JSON.parse(fullText || "[]");
  } catch (e) {
    console.error("Schedule Generation Error:", e);
    return [];
  }
};

export const getWeeklyInsight = async (stats: { completionRate: number, focusMinutes: number, topTasks: string[] }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const prompt = `你是个名叫 Kairos 的能量管理专家。为 ADHD 用户提供温馨总结：完成率 ${stats.completionRate}%, 专注 ${Math.round(stats.focusMinutes/60)}h, 常做 ${stats.topTasks.join(', ')}。多鼓励，禁医学词。`;
  
  try {
    const response = await ai.models.generateContent({ 
      model: 'gemini-3-flash-preview', 
      contents: prompt 
    });
    return response.text || "回顾本周，每一个专注的瞬间都值得被铭记。继续保持你的节奏。";
  } catch (e) {
    console.error("Insight Error:", e);
    return "回顾本周，每一个专注的瞬间都值得被铭记。继续保持你的节奏。";
  }
};

export const chatWithAssistant = async (
  message: string, 
  history: ChatMessage[], 
  context: { energy: EnergyLevel | null; tasks: Task[] }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const contextSummary = `
用户当前能量: ${context.energy || '未同步'}/5
今日任务流: ${context.tasks.map(t => `${t.startTime} ${t.title}`).join(', ')}
`;

  const systemInstruction = `你名叫 Kairos，一位体面且高效的生活助手。
注意：
1. 绝对不要改动用户自己输入的任务标题。
2. 你自己生成的填充任务应清晰、体面（如“肢体拉伸”、“正念冥想”），并给出具体的执行建议。
3. 绝对尊重固定任务的时间点。
4. 所有的修改必须通过工具执行。
${contextSummary}
`;

  const chatHistory = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  try {
    const chat = ai.chats.create({ 
      model: 'gemini-3-flash-preview', 
      history: chatHistory,
      config: { 
        systemInstruction,
        tools: [{ functionDeclarations: controlScheduleTools }]
      } 
    });

    const response = await chat.sendMessage({ message });
    return { text: response.text, functionCalls: response.functionCalls };
  } catch (e) {
    console.error("Chat Error:", e);
    return { text: "抱歉，我的思绪暂时有些断连。请确认您的 API Key 是否配置正确。", functionCalls: [] };
  }
};
