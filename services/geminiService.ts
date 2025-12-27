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
    description: "删除一个任务。可以删除今日计划中的任务、固定日程或愿望池中的任务。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "要删除的任务标题（支持模糊匹配）" }
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
- 今日能量评分：${energy}/5 (1=极其疲惫, 5=精力充沛)
- 原始任务池：${JSON.stringify(baseTasks)}

# 核心调度原则 (核心逻辑)

1. **固定任务（锚点）绝对锁定**：
   - 对于 \`isHardBlock: true\` 的任务，**必须**保留原始的 startTime。严禁移动时间。
   - 标题必须与输入保持 100% 一致。

2. **精简且温暖的描述 (Concise Description)**：
   - **每一项任务**都必须提供 \`description\`。
   - 描述要**简洁、精炼**，用一两句话提供温暖的行动建议或鼓励。
   - **严禁**使用“调度意图”、“行动提示”等生硬的分段标签，直接书写内容。

3. **标题严格一致性**：
   - 原始任务池任务的标题（title）**严禁**修改、扩充或添加后缀。

4. **禁止虚构任务**：
   - 严禁添加输入中不存在的任务（如午餐等）。唯一允许添加的是“能量留白”。

5. **能量调度**：
   - 禁止安排连续超过 2 个 'high' 任务。
   - 必要时强制插入 15 分钟的“能量留白”。

# 约束
- 格式：JSON 数组。
- 时间 HH:mm 格式，严禁任务重叠。
- 确保涵盖所有 \`isHardBlock: true\` 的固定任务。
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
            description: { type: Type.STRING, description: "精简温暖的任务建议，无需标签" },
            duration: { type: Type.NUMBER },
            energyCost: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
            isHardBlock: { type: Type.BOOLEAN },
            startTime: { type: Type.STRING }
          },
          required: ["id", "title", "description", "duration", "energyCost", "isHardBlock", "startTime"]
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
1. 如果用户说“我想在2点做某事”或“帮我加个临时任务”，请使用 \`modify_today_plan\`。
2. 如果用户说“帮我删掉某某任务”，请使用 \`remove_task\`。
3. 如果用户说“我以后每天都要...”，请使用 \`add_fixed_task\`。
操作成功后，请简洁地告知用户。
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