import type { ScenarioConfig, ScenarioId } from "@/types/config";

export const scenarioCatalog: ScenarioConfig[] = [
  {
    id: "general",
    label: "通用",
    description: "忠实、克制、自然的中性口语翻译。",
    tone: "自然中性口语",
    rules: ["忠实翻译", "不解释", "不扩写"],
    glossaryHints: ["优先保持原句信息密度", "不擅自补充背景"],
    enabled: true,
  },
  {
    id: "shopping",
    label: "购物",
    description: "优先照顾价格、尺寸、颜色、库存和退换货表达。",
    tone: "礼貌自然",
    rules: ["不擅自加入销售话术", "尺寸和价格优先精确", "库存和结账表达清楚"],
    glossaryHints: ["价格", "尺寸", "颜色", "库存", "退换货", "结账"],
    enabled: true,
  },
  {
    id: "medical",
    label: "看病就医",
    description: "采用清楚、保守、偏正式的表达，避免过度确定。",
    tone: "清楚保守正式",
    rules: ["症状与部位优先准确", "时间与频率尽量精确", "模糊表述不要翻得过于确定"],
    glossaryHints: ["症状", "部位", "持续时间", "频率", "检查", "药物"],
    enabled: true,
  },
  {
    id: "banking",
    label: "银行业务",
    description: "优先使用手续、账户、证件和金额相关的准确表达。",
    tone: "正式准确",
    rules: ["金额与日期优先精确", "身份与材料描述准确", "手续流程保持正式语气"],
    glossaryHints: ["账户", "开户", "转账", "限额", "证件", "住址证明"],
    enabled: true,
  },
  {
    id: "child_communication",
    label: "和孩子沟通",
    description: "使用温和、简单、容易懂的表达，不要太书面。",
    tone: "温和自然",
    rules: ["尽量用孩子容易懂的表达", "保留原意，不额外说教", "避免生硬书面语"],
    glossaryHints: ["简单表达", "安抚语气", "日常生活词汇"],
    enabled: true,
  },
];

export const DEFAULT_SCENARIO_ID: ScenarioId = "general";

const scenarioIdSet = new Set(scenarioCatalog.map((scenario) => scenario.id));
const scenarioIndex = new Map(scenarioCatalog.map((scenario) => [scenario.id, scenario]));

export function isScenarioId(value: string | undefined): value is ScenarioId {
  return value !== undefined && scenarioIdSet.has(value as ScenarioId);
}

export function getScenarioById(id: ScenarioId) {
  return scenarioIndex.get(id);
}
