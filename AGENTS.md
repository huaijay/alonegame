# AGENTS.md — 项目开发规范

> 游戏合集 · AI 自动对弈可视化。所有在本仓库工作的 Agent 与开发者必须遵循本规范。

## 1. 技术栈与硬性约束

| 项 | 约定 |
|---|---|
| 构建框架 | **Vite**（禁止使用 Next.js，本项目无 SEO 需求） |
| 前端 | React 19 + TypeScript 5.9，组件一律函数式组件写法（禁止 class 组件） |
| 包管理 | pnpm |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite` 插件）+ 全局 `src/index.css` 主题变量 |
| 开发端口 | `5273` |
| 类型安全 | **禁用 `any`**；API 与复杂逻辑必须定义完整 TS 类型 |
| Node 测试 | `node:test` + `scripts/ts-loader.mjs` 加载 TS 源码 |

## 2. 目录结构与分层

```
src/
├── app/                  # 应用外壳：主题切换、hash 路由、游戏大厅
│   ├── App.tsx           #   壳组件：深浅主题、#/id 路由、返回大厅
│   └── registry.ts       #   GAMES 注册表：新游戏在此追加一条即可接入大厅
├── games/
│   └── <game-id>/        # 每个游戏一个自包含目录（当前：ludo；计划：azul 等）
│       ├── <GameId>Game.tsx   # 入口组件：配置页 ⇄ 对局页切换
│       ├── engine/            # ★ 纯逻辑层：禁止 import React / DOM / window
│       │   ├── types.ts       #   状态与动作类型（GameState / Move / MoveStep…）
│       │   ├── board.ts       #   棋盘几何与坐标（纯数据，不含规则）
│       │   ├── rules.ts       #   规则核心：createInitialState / getLegalMoves / applyMove
│       │   ├── rng.ts         #   可复现随机源（mulberry32，seed 驱动）
│       │   ├── ai/            #   决策层：evaluate.ts（评估）+ 搜索（expectimax 等）
│       │   ├── session.ts     #   对局编排：驱动回合流转、生成日志/回放/AI 展示数据
│       │   ├── simulate.ts    #   快速批量模拟（供统计与 AI 基准）
│       │   └── stats.ts       #   胜率统计
│       └── ui/                # 展示层：只消费 engine 的快照与视图数据
├── index.css             # 全局主题（深浅两套 CSS 变量）
└── main.tsx
tests/<game-id>/          # node:test 测试与 AI 夹具（.mjs，经 ts-loader 引用 TS 源码）
scripts/                  # ts-loader、AI 基准脚本（bench-ai / bench-budgets）
```

### 分层铁律

1. **engine 纯净性**：`engine/` 下不得出现 React、DOM、`window`、`localStorage` 等；同一套引擎必须能直接被 Node 测试与 UI 消费。
2. **状态不可变**：所有规则函数返回新对象（参考 `rules.ts` 的 `applyMove`），不做原地修改。
3. **随机必须可复现**：任何随机性只能通过 `rng.ts` 的 `createRng(config.seed)` 取得，禁止裸用 `Math.random()`——这是回放、测试、AI 基准可复现的根基。
4. **AI 与 UI 共用规则核心**：合法性判断、落点计算只实现一份（如 `landingPosition`），AI 搜索与逐段动画消费同一结果，杜绝两套口径。
5. **UI 只读快照**：`session.ts` 对外暴露只读 `SessionSnapshot` 与视图数据（日志、回放帧、AI 候选），UI 不直接改写对局状态。

## 3. 新游戏接入流程（checklist）

以花砖物语（azul）为例，任何新游戏按以下步骤接入：

1. 建 `src/games/<id>/`，目录名 = 注册 id = 路由 hash（小写字母/数字/连字符）。
2. 先写 `engine/`：`types` → `rules`（初始状态 + 合法动作 + 应用动作）→ `rng` 接入 → `ai/`（评估函数 + 搜索）→ `session`（编排 + 日志 + 回放帧）→ `stats`/`simulate`。
3. 为规则核心补测试：新建 `tests/<id>/*.test.mjs`，通过 `scripts/ts-loader.mjs` 引用 TS 源码；关键落点/结算用 JSON 夹具固化。
4. 再写 `ui/`：SetupScreen（配置）+ GameStage（对局）+ 侧栏三件套（EventLog / StatsPanel / AiPanel）+ ControlBar（暂停/继续/重开）+ ReplayBar（回放）。
5. 在 `src/app/registry.ts` 的 `GAMES` 追加一条（id、name、eyebrow、description、badges、component）。
6. 验证：`pnpm typecheck`、`pnpm test`、`pnpm build`，浏览器确认深浅两套主题下的完整对局流程。

> 候选动作建议全部显式建模（如飞行棋的 `Move`），AI 输出与玩家操作走同一类型，便于回放与统计复用。

## 4. 编码规范

### 注释（中文）

- **函数级**：导出函数必须写 JSDoc，依次说明功能、参数、返回值（参考 `rules.ts` 风格）。
- **行级 why**：复杂逻辑、Magic Number 上方必须用中文注释解释"为什么"，而非复述行为（参考 `rules.ts` 中"机库内飞机等价，只需一个起飞候选"的写法）。
- 纯声明性的 interface 字段可用简短行注释，不逐字复述类型名。

### 逻辑与工程

- **架构优先**：修 bug 必须从根源与架构层面解决，禁止补丁式分支叠加；方案有更优解时先提案讨论再实施。
- **合并相似逻辑**：相似功能代码抽为工具函数，并在文件头或包级写清用途，便于查找复用。
- **错误处理**：不得用 `_` 或空 catch 吞错误；确需忽略时写注释说明原因（参考 `App.tsx` 对 localStorage 的处理）。
- **日志密度**：对局日志按事件粒度输出（掷骰/移动/吃子/归位/胜利），既不刷屏也不缺关键节点。
- **禁止防御式编程**：不为不可能发生的场景写校验；只在系统边界（用户输入、外部数据）做校验。

## 5. UI 与视觉规范

- **主题**：所有界面必须同时适配深色 / 浅色两套主题，颜色一律走 `index.css` 的 CSS 变量，禁止硬编码色值。
- **棋盘完整性**：棋盘视觉元素（地块、棋子、装饰、流向指示）需完整刻画，配色明亮精美；素材优先通过网络检索或文生图获取。
- **对局页侧栏**：面板顺序固定为 **事件日志 → 胜率统计 → AI 决策**，AI 决策卡片置于最底部（其高度变化不得推挤上方面板）；侧栏顶部不放置标题文字，折叠按钮单独靠右。
- **动效**：当前行动方对应的棋盘元素用**呼吸脉冲**高亮（替代固定自发光）；骰子、移动、吃子等关键事件需有可感知的过渡动画。
- **布局策略**：棋盘区域优先占用空间，辅助区域（机库/边栏）尽量紧凑。

## 6. 命令速查

```bash
pnpm dev          # 开发服务（端口 5273）
pnpm typecheck    # tsc --noEmit（提交前必跑）
pnpm test         # node:test 全量测试（经 ts-loader 加载 TS）
pnpm build        # 类型检查 + 产物构建
pnpm bench:ai     # AI 决策基准（耗时/节点数）
```

## 7. 完成定义（DoD）

一次改动算完成，必须同时满足：

1. `pnpm typecheck` 通过，无 `any` 引入；
2. 受影响的 `tests/` 用例通过，规则改动同步更新夹具；
3. 浏览器中深、浅主题下完整走通至少一局；
4. 新增/修改的导出函数带中文 JSDoc。
