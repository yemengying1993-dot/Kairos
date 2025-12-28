
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Task, EnergyLevel, ChatMessage } from "../types";

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
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
# Role (角色) 
你是个名叫 Kairos 的个人能量调度专家，专门为有执行功能障碍（疑似ADHD）的人设计“无痛执行”的日程。

# 任务目标
生成一份从 ${activeWindow.start} 到 ${activeWindow.end} 的【无缝能量流日程】。

# 输入数据
- 今日能量评分：${energy}/5
- 原始任务池（包含固定日程和愿望清单）：${JSON.stringify(baseTasks)}

# 核心调度原则 (必须严格遵守)

1. **绝对对齐时间窗口 (Window Bounds)**：
   - 第一个任务的 \`startTime\` **必须严格等于** "${activeWindow.start}"。
   - 最后一个任务的【结束时间】（即 \`startTime\` + \`duration\`）**绝对严禁超过** "${activeWindow.end}"。
   - 整个日程表必须精准填满 "${activeWindow.start}" 至 "${activeWindow.end}" 这一时段。

2. **标题与属性绝对忠诚 (Integrity)**：
   - 对于输入数据“原始任务池”中已有的任务，你 **必须** 使用用户提供的原始标题。
   - 必须保留原始任务的 \`isHardBlock\` 和 \`isWish\` 属性值。

3. **强制性温馨描述 (Compulsory Descriptions)**：
   - **核心要求**：必须为【每一个】生成的任务项提供一段温暖、具体、且充满人性关怀的 \`description\`（描述）。
   - 如果是用户任务，请根据任务性质提供执行建议（例如：“既然是高能任务，记得深呼吸三次再开始”）。
   - 如果是 AI 插入的休息项，请描述具体的小动作（例如：“去窗边发呆 2 分钟，感受一下光”、“伸个大大的懒腰”）。
   - 严禁将描述留空或仅重复标题。

4. **高能耗任务隔离**：
   - **禁止连续安排** 2 个 \`energyCost: "high"\` 的任务。
   - 每一个 \`high\` 任务结束后，**必须** 强制插入一个 15 分钟的低能耗休息缓冲项。

5. **创意休息标题 (仅限 AI 插入项)**：
   - 填补空隙时，请起一个温暖、具体的标题。严禁叫“能量留白”或“休息”。示例：“整理一下呼吸”、“喝口温水”、“让大脑离线一会儿”。
   - 这些项的 \`energyCost\` 为 "low"，\`isHardBlock\` 为 false, \`isWish\` 为 false。

6. **无缝衔接**：
   - 确保从 "${activeWindow.start}" 到 "${activeWindow.end}" 的每一分钟都有安排，任务间严禁重叠。

# 约束
- 格式：JSON 数组。
- 时间 HH:mm 格式。
`;

  const stream = await ai.models.generateContentStream({
    model: 'gemini-flash-lite-latest',
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

  let fullText = "";
  for await (const chunk of stream) {
    fullText += chunk.text || "";
  }

  try {
    return JSON.parse(fullText.trim() || "[]");
  } catch (e) {
    console.error("JSON Parsing failed for schedule:", fullText);
    return [];
  }
};

export const getWeeklyInsight = async (stats: { completionRate: number, focusMinutes: number, topTasks: string[] }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `你是个名叫 Kairos 的能量管理专家。为用户本周表现提供温暖总结：完成率 ${stats.completionRate}%, 专注 ${Math.round(stats.focusMinutes/60)}h, 常做 ${stats.topTasks.join(', ')}。严禁医学词汇。`;
  
  const stream = await ai.models.generateContentStream({ 
    model: 'gemini-flash-lite-latest', 
    contents: prompt 
  });

  let fullText = "";
  for await (const chunk of stream) {
    fullText += chunk.text || "";
  }
  
  return fullText;
};

export const chatWithAssistant = async (
  message: string, 
  history: ChatMessage[], 
  context: { energy: EnergyLevel | null; tasks: Task[] }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const contextSummary = `
用户当前能量状态: ${context.energy || '未同步'}/5
今日任务流: ${context.tasks.map(t => `${t.startTime} ${t.title}(${t.isCompleted ? '已完成' : '待办'})`).join(', ')}
`;

  const systemInstruction = `你名叫 Kairos，一位温馨的个人能量助手。
你的目标是帮助用户动态管理今天的日程。
保持温暖、包容、富有同理心的口吻。
${contextSummary}
记住：用户不吃午餐，只吃早晚两顿。

【重要操作指南】：
1. 如果用户想要修改、添加或删除日程，**必须优先使用函数工具**。
2. 调用工具时，请务必生成一个温暖、关怀的 \`description\`（描述）。
3. 删除任务时，请检查上下文中的“今日任务流”，使用最匹配的完整标题调用 \`remove_task\`。
4. 操作完成后，请简短反馈。
`;

  const chatHistory = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const chat = ai.chats.create({ 
    model: 'gemini-flash-lite-latest', 
    history: chatHistory,
    config: { 
      systemInstruction,
      tools: [{ functionDeclarations: controlScheduleTools }]
    } 
  });

  const response = await chat.sendMessage({ message });
  return { text: response.text, functionCalls: response.functionCalls };
};
