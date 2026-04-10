# 实时中日互译工具

一个面向个人使用的低延迟网页版实时翻译工具，目标是让“原文尽快冒字、译文尽快跟上”。当前仓库已完成阶段 5：项目脚手架、Realtime 会话建立、原文实时字幕链路、基于 final 片段的流式翻译链路，以及稳定片段触发与有限窗口修正。

## 当前进度

- 已完成：Next.js + React + TypeScript 初始化
- 已完成：基础页面壳、状态栏、按钮 UI
- 已完成：语言配置模块与场景配置模块
- 已完成：服务端环境变量集中读取
- 已完成：`POST /api/realtime/session`
- 已完成：`POST /api/translate/stream`
- 已完成：`GET /api/health`
- 已完成：前端开始流程、麦克风权限请求、Realtime WebRTC 基础连接
- 已完成：Realtime partial / final transcript 原文实时显示
- 已完成：final 原文片段驱动的流式译文显示与 segment 归档
- 已完成：稳定片段提前触发翻译
- 已完成：recent-window 有限修正策略
- 已完成：`.env.example` 与 README 初版
- 未完成：更高级的 stabilizer 调优、完整 glossary 系统、部署打磨

## 目标体验

- 浏览器请求麦克风权限后实时采集音频
- 页面持续显示原文 partial / final transcript
- 翻译结果以流式形式尽快跟上
- 支持中文 -> 日语、日语 -> 中文
- 代码结构预留多语言与术语库扩展能力

## 技术路线

- 前端：Next.js App Router + React + TypeScript
- 后端：Next.js Route Handlers（Node.js + TypeScript）
- Realtime 转写：后续阶段接入 OpenAI Realtime transcription
- 翻译：Responses API + stream
- 连接原则：浏览器不直接持有标准 OpenAI API key，只向本项目后端获取临时会话信息

## 当前目录结构

```text
app/
components/
config/
lib/
  languages/
  scenarios/
types/
public/
```

## 当前已实现内容

### 1. 基础页面壳

- 顶部标题、状态栏和控制区
- 语言方向选择器
- 场景选择器
- 开始 / 停止 / 清空按钮
- 原文实时区域、译文实时区域、最终定稿区域、错误区域、开发快照区域

### 2. Realtime 会话建立

- 服务端新增 `POST /api/realtime/session`
- 服务端使用 `OPENAI_API_KEY` 向 OpenAI 创建 Realtime 临时凭证
- 浏览器点击开始后会先请求麦克风，再请求本项目后端会话接口
- 会话返回后，浏览器通过 WebRTC 向 OpenAI 建立基础连接
- 页面会显示应用状态、连接状态、麦克风权限状态、错误信息和调试快照
- 当前阶段已支持原文 realtime transcript、稳定片段提前触发的译文流，以及 final 到来后的有限窗口修正

### 3. 语言扩展结构

当前代码里已经预留以下语言配置：

- `zh-CN`
- `ja-JP`
- `en-US`
- `ko-KR`

每个语言都包含：

- `label`
- `code`
- `locale`
- `speechRecognitionHint`
- `translationDisplayName`
- `enabled`

当前 UI 只开放：

- 中文 -> 日语
- 日语 -> 中文

### 4. 场景模式结构

当前代码里已经预留以下场景：

- 通用
- 购物
- 看病就医
- 银行业务
- 和孩子沟通

每个场景都包含：

- `id`
- `label`
- `description`
- `tone`
- `rules`
- `glossaryHints`
- `enabled`

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

当前阶段已经会实际调用 OpenAI 创建 Realtime 会话与流式翻译，因此本地运行前需要准备可用的服务端 API key。

阶段 5 至少需要填写：

```env
OPENAI_API_KEY=your_server_side_key
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
```

### 3. 启动开发服务器

```bash
npm run dev
```

默认访问：

- [http://localhost:3000](http://localhost:3000)

说明：

- `localhost` 可以直接申请麦克风权限
- 如果从局域网或公网域名访问，通常需要 HTTPS 才能正常拿到浏览器麦克风权限

### 4. 基础检查

```bash
npm run lint
npm run typecheck
```

## 环境变量

- `OPENAI_API_KEY`: OpenAI 服务端密钥，仅后端使用
- `OPENAI_REALTIME_TRANSCRIPTION_MODEL`: Realtime 转写模型名
- `OPENAI_TRANSLATION_MODEL`: 翻译模型名
- `APP_BASE_URL`: 应用对外访问地址，本地默认 `http://localhost:3000`
- `NODE_ENV`: 运行环境
- `DEFAULT_SOURCE_LANGUAGE`: 默认源语言
- `DEFAULT_TARGET_LANGUAGE`: 默认目标语言
- `DEFAULT_SCENARIO`: 默认场景
- `GLOSSARY_ENABLED`: 是否启用术语提示开关
- `DEBUG_PERF_LOGS`: 是否开启性能调试日志

## 说明

- 当前已接入麦克风权限请求、Realtime 临时会话创建、WebRTC 基础连接、原文实时字幕、稳定片段触发翻译，以及 final 到来后的有限窗口修正
- 当前修正策略仍是保守版本，只自动处理最近 1 到 2 个 segment
- 当前仍不是最终生产版调度策略
- 这些内容会严格按阶段 6 继续实现

## 下一阶段

阶段 6 会开始完成：

- 错误处理与手机端适配继续打磨
- README 与部署说明补全
- Cloudflare Tunnel 示例补齐

## 手工验收清单（阶段 5）

- 页面能正常打开
- 能切换语言方向
- 能切换场景
- 点击开始后能请求麦克风权限
- 服务端已配置 `OPENAI_API_KEY` 时，能进入 Realtime 会话创建和连接流程
- 能看到状态栏、按钮和三个文本区域
- 失败时能在错误区看到明确原因
- 开发环境下能看到基础配置快照
- `.env.example` 完整可复制
