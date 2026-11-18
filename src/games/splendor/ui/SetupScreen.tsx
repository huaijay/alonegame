import { useState } from 'react';
import { DEVELOPMENT_CARDS } from '../engine/cards';
import { classicRulesFor, RULE_LIMITS } from '../engine/config';
import { AI_LEVELS, DEFAULT_AI_STRENGTH } from '../engine/ai/levels';
import type { AiStrength, GameConfig, GameRules } from '../engine/types';
import { DevelopmentCardView } from './DevelopmentCardView';
import { GemToken } from './GemToken';

interface SetupScreenProps {
  onStart: (config: GameConfig) => void;
}

/** 将可选的变体规则排成紧凑两列；经典值依人数变化。 */
const ADVANCED_FIELDS: { key: keyof GameRules; label: string; unit: string; hint: string }[] = [
  { key: 'tokenLimit', label: '持有筹码上限', unit: '枚', hint: '超过上限，回合结束自动退回多余筹码。' },
  { key: 'reserveLimit', label: '最多预留卡牌', unit: '张', hint: '每位玩家最多锁定的发展卡数量。' },
  { key: 'marketSize', label: '每阶公开卡牌', unit: '张', hint: '每阶市场展示的可购买或预留卡片。' },
  { key: 'nobleCount', label: '贵族出场数量', unit: '位', hint: '经典规则为玩家人数 + 1。' },
  { key: 'gemSupply', label: '每色普通宝石', unit: '枚', hint: '五种普通宝石的初始数量均设为此值。' },
  { key: 'goldSupply', label: '黄金通配筹码', unit: '枚', hint: '黄金只能通过预留牌获得，耗尽仍可预留。' },
  { key: 'doubleTakeMinimum', label: '双取所需库存', unit: '枚', hint: '银行同色至少有这么多枚，才可领取两枚。' },
];

interface RuleSettingProps {
  item: (typeof ADVANCED_FIELDS)[number];
  value: number;
  classic: number;
  onChange: (value: number) => void;
}

/** 可选择具体数值的规则控件：展示当前值及经典版参考值。 */
function RuleSetting({ item, value, classic, onChange }: RuleSettingProps) {
  const [min, max] = RULE_LIMITS[item.key];
  return (
    <div className="sp-rule-setting">
      <label htmlFor={'sp-rule-' + item.key}>{item.label}</label>
      <div className="sp-rule-setting-row">
        <select id={'sp-rule-' + item.key} value={value}
          onChange={(event) => onChange(Number(event.target.value))}>
          {Array.from({ length: max - min + 1 }, (_, offset) => min + offset).map((number) => (
            <option key={number} value={number}>{number} {item.unit}</option>
          ))}
        </select>
        <span>经典 {classic} {item.unit}</span>
      </div>
      <small>{item.hint}</small>
    </div>
  );
}

/**
 * 璀璨宝石开局页：选择玩家数量、对局模式、游戏难度与本局规则。
 * @param props 开局回调，接收所选难度与完整对局配置
 * @returns 支持键盘操作的开局配置界面
 */
export function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = useState<2 | 3 | 4>(3);
  const [human, setHuman] = useState(false);
  const [strength, setStrength] = useState<AiStrength>(DEFAULT_AI_STRENGTH);
  const [delay, setDelay] = useState(1000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ruleOverrides, setRuleOverrides] = useState<Partial<GameRules>>({});
  const classic = classicRulesFor(count);
  const rules: GameRules = { ...classic, ...ruleOverrides };
  const editedCount = (Object.keys(classic) as (keyof GameRules)[])
    .filter((key) => rules[key] !== classic[key]).length;
  const updateRule = (key: keyof GameRules, value: number) => {
    setRuleOverrides((previous) => ({ ...previous, [key]: value }));
  };
  const sample = [DEVELOPMENT_CARDS[8], DEVELOPMENT_CARDS[43], DEVELOPMENT_CARDS[74]];

  const begin = () => {
    onStart({
      playerCount: count,
      aiStrength: strength,
      // 亲自入局固定为玩家 1；先手顺序由对局随机决定。
      humanSeat: human ? 0 : null,
      turnDelayMs: delay,
      rules,
      seed: Date.now() >>> 0,
    });
  };

  return (
    <div className="splendor sp-setup">
      <header className="sp-setup-header">
        <div className="sp-crest" aria-hidden="true"><span>✦</span><span>◆</span><span>✦</span></div>
        <p className="sp-eyebrow">THE RENAISSANCE JEWEL EXCHANGE</p>
        <h1>璀璨<span>宝石</span></h1>
        <p className="sp-setup-subtitle">一场关于财富、声望与远见的文艺复兴竞逐。</p>
        <div className="sp-ornament" aria-hidden="true">◈ ─── ✧ ─── ◈</div>
      </header>
      <div className="sp-setup-layout">
        <section className="sp-paper sp-form-panel">
          <div className="sp-panel-heading">
            <span className="sp-eyebrow">01 / YOUR TABLE</span>
            <h2>创建对局</h2>
            <p>选择 2–4 位玩家；可全程观赛，或亲自入局与 AI 同台竞逐。</p>
          </div>
          <div className="sp-field">
            <div className="sp-field-title"><span>玩家数量</span><b>{count} 位</b></div>
            <div className="sp-choice-grid">
              {([2, 3, 4] as const).map((num) => (
                <button type="button" key={num} data-active={count === num} onClick={() => setCount(num)}>
                  <strong>{String(num).padStart(2, '0')}</strong><span>位玩家</span>
                </button>
              ))}
            </div>
          </div>
          <div className="sp-field">
            <div className="sp-field-title"><span>对局模式</span><b>{human ? '参与' : '观赛'}</b></div>
            <div className="sp-mode-choices">
              <button type="button" data-active={!human} onClick={() => setHuman(false)}>
                <b>✦　AI 自动对弈</b>
                <small>所有玩家自动交易，可暂停、单步与回放</small>
              </button>
              <button type="button" data-active={human} onClick={() => setHuman(true)}>
                <b>♛　亲自入局</b>
                <small>你扮演玩家 1，其余由 AI 驱动</small>
              </button>
            </div>
          </div>
          <fieldset className="sp-strength-field">
            <legend>游戏难度</legend>
            <div className="sp-strength-choices">
              {AI_LEVELS.map((level) => (
                <label key={level.id} className="sp-strength-option" data-active={strength === level.id}>
                  <input type="radio" name="sp-ai-strength" value={level.id}
                    checked={strength === level.id} onChange={() => setStrength(level.id)}
                    aria-labelledby={'sp-strength-' + level.id + '-label'}
                    aria-describedby={'sp-strength-' + level.id + '-description'} />
                  <span className="sp-strength-body">
                    <span className="sp-strength-heading">
                      <strong id={'sp-strength-' + level.id + '-label'}>{level.label}</strong>
                      {level.id === DEFAULT_AI_STRENGTH ? <small>推荐</small> : null}
                    </span>
                    <span id={'sp-strength-' + level.id + '-description'}
                      className="sp-strength-description">{level.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="sp-field-hint">应用于本局全部 AI 玩家，重开保留。较高档位会多花一些时间规划。</p>
          </fieldset>
          <div className="sp-field sp-win-field">
            <div className="sp-field-title"><span>获胜声望目标</span><b>{rules.victoryPoints} 分</b></div>
            <input type="range" min={RULE_LIMITS.victoryPoints[0]} max={RULE_LIMITS.victoryPoints[1]}
              step={1} value={rules.victoryPoints}
              onChange={(event) => updateRule('victoryPoints', Number(event.target.value))}
              aria-label="获胜声望目标" />
            <div className="sp-score-presets">
              {[10, 15, 20, 25, 30].map((score) => (
                <button type="button" key={score} data-active={rules.victoryPoints === score}
                  onClick={() => updateRule('victoryPoints', score)}>
                  {score} 分{score === 15 ? ' · 经典' : ''}
                </button>
              ))}
            </div>
            <p className="sp-field-hint">范围 5–30 分；达到目标的回合结束后仍让其他玩家完成本轮。</p>
          </div>
          <div className="sp-advanced">
            <button type="button" className="sp-advanced-toggle"
              aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
              <span>⚙　高级规则 <small>7 项可调 · 非官方变体</small></span>
              <span className="sp-advanced-status">{editedCount ? `已修改 ${editedCount} 项` : '经典默认'}　{advancedOpen ? '⌃' : '⌄'}</span>
            </button>
            {advancedOpen ? (
              <div className="sp-advanced-body">
                <p className="sp-advanced-hint">所有自定义规则仅作用于新开的这一局，默认数值与经典版一致。</p>
                <div className="sp-advanced-grid">
                  {ADVANCED_FIELDS.map((item) => (
                    <RuleSetting key={item.key} item={item} value={rules[item.key]}
                      classic={classic[item.key]} onChange={(value) => updateRule(item.key, value)} />
                  ))}
                </div>
                <button type="button" className="sp-rules-reset" onClick={() => setRuleOverrides({})}>
                  ↺ 恢复全部经典规则
                </button>
              </div>
            ) : null}
          </div>
          <div className="sp-field">
            <div className="sp-field-title"><span>行动间隔</span><b>{(delay / 1000).toFixed(1)} 秒</b></div>
            <input type="range" min={250} max={2000} step={250} value={delay}
              onChange={(event) => setDelay(Number(event.target.value))} aria-label="行动间隔" />
            <p className="sp-field-hint">游戏开始后仍可调快速度或单步观察。</p>
          </div>
          <button type="button" className="sp-primary-button sp-start-button" onClick={begin}>
            进入珠宝交易所 <span>→</span>
          </button>
        </section>
        <section className="sp-paper sp-howto">
          <div className="sp-panel-heading">
            <span className="sp-eyebrow">02 / HOW TO PLAY</span>
            <h2>新手规则 · 三分钟上手</h2>
            <p>目标是率先赢得 {rules.victoryPoints} 声望：从矿山采集宝石，投资发展卡，赢得贵族青睐。</p>
          </div>
          <div className="sp-preview-cards">
            {sample.map((card) => <DevelopmentCardView key={card.id} card={card} />)}
          </div>
          <div className="sp-preview-tokens">
            <span>珍宝储备</span>
            {(['white', 'blue', 'green', 'red', 'black', 'gold'] as const).map((color) => (
              <GemToken key={color} color={color} size="sm" />
            ))}
          </div>
          <div className="sp-howto-steps">
            <div className="sp-howto-step">
              <div className="sp-howto-visual" aria-hidden="true">
                <GemToken color="white" size="sm" /><GemToken color="blue" size="sm" /><GemToken color="green" size="sm" />
                <span className="sp-howto-or">或</span>
                <GemToken color="red" size="sm" /><GemToken color="red" size="sm" />
              </div>
              <div className="sp-howto-copy"><strong>01 · 采集宝石</strong>
                <p>每回合可拿三种不同颜色，或取两枚同色（银行至少剩 {rules.doubleTakeMinimum} 枚）。</p></div>
            </div>
            <div className="sp-howto-step">
              <div className="sp-howto-visual" aria-hidden="true">
                <GemToken color="green" size="sm" /><span className="sp-howto-arrow">→</span>
                <span className="sp-howto-card"><i>◆</i><b>VP</b></span>
              </div>
              <div className="sp-howto-copy"><strong>02 · 投资发展</strong>
                <p>宝石可购买发展卡，发展卡提供永久同色折扣与声望。</p></div>
            </div>
            <div className="sp-howto-step">
              <div className="sp-howto-visual" aria-hidden="true">
                <GemToken color="gold" size="sm" /><span className="sp-howto-arrow">→</span>
                <span className="sp-howto-reserve">预留</span>
              </div>
              <div className="sp-howto-copy"><strong>03 · 预留卡牌</strong>
                <p>最多持有 {rules.reserveLimit} 张；只差 1 枚筹码买入时才能锁定公开牌，锁定即得一枚黄金。</p></div>
            </div>
            <div className="sp-howto-step">
              <div className="sp-howto-visual sp-howto-visual-noble" aria-hidden="true">
                <span className="sp-howto-crown">♛</span><span className="sp-howto-plus">+3</span>
              </div>
              <div className="sp-howto-copy"><strong>04 · 贵族到访</strong>
                <p>本局有 {rules.nobleCount} 位贵族，永久折扣满足条件时每回合最多拜访一位，每位 3 分。</p></div>
            </div>
            <div className="sp-howto-step">
              <div className="sp-howto-visual sp-howto-visual-score" aria-hidden="true">
                <b>{rules.victoryPoints}</b><span>VP</span>
              </div>
              <div className="sp-howto-copy"><strong>05 · 最后结算</strong>
                <p>有人达到 {rules.victoryPoints} 分后打完当前轮；同分比谁买的卡更少。</p></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
