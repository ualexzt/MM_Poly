# Polymarket Rebate-Aware Market Making Strategy — Implementation Spec

**Status:** Draft for implementation  
**Target:** Fully automated paper/shadow/live-ready market-making strategy for Polymarket CLOB V2  
**Primary goal:** Build a conservative, risk-first maker strategy that captures spread and maker-side incentives without accumulating uncontrolled toxic inventory.  
**Non-goal:** This strategy must not predict event outcomes as its primary source of edge.

---

## 1. Core Strategy Summary

The strategy places **post-only passive limit orders** on eligible Polymarket markets. It attempts to earn from:

1. **Spread capture** — buying at bid and selling at ask.
2. **Maker rebates** — earned only when passive maker liquidity is taken.
3. **Liquidity rewards** — earned by keeping qualified two-sided resting liquidity close to the midpoint where reward configuration exists.

The strategy must never chase rebates blindly. All quotes must pass an expected-value and risk filter before being submitted.

Core principle:

```text
Do not optimize for fill count.
Optimize for risk-adjusted maker fills.
```

---

## 2. Required Trading Modes

The implementation must support the following modes:

```yaml
modes:
  paper:
    description: Simulated orders and fills only. No real orders submitted.
    required: true

  shadow:
    description: Calculates real target quotes from live data but does not submit orders.
    required: true

  small_live:
    description: Real post-only orders with strict capital caps.
    required: true

  disabled:
    description: Market scanning and monitoring only. No quote generation.
    required: true
```

Default mode must be:

```yaml
default_mode: paper
```

Live mode must require an explicit config flag:

```yaml
live_trading_enabled: false
```

---

## 3. External Dependencies

The implementation should assume Polymarket CLOB V2 compatibility.

Required integrations:

```yaml
integrations:
  gamma_api:
    purpose:
      - market discovery
      - event metadata
      - market status
      - volume/liquidity fields
      - reward configuration when available

  clob_api:
    purpose:
      - order book snapshots
      - open orders
      - order placement
      - order cancellation
      - order reconciliation

  market_websocket:
    purpose:
      - live best bid/ask updates
      - trades
      - price changes
      - tick-size changes
      - book updates

  user_websocket:
    purpose:
      - own order updates
      - own fill updates
      - position updates if available
```

The coding agent must verify exact SDK method names and payload shapes against the currently installed Polymarket V2 client before final implementation.

---

## 4. Strategy Universe Selection

### 4.1 Hard Market Filters

A market is eligible only if all required hard filters pass.

```yaml
market_filter:
  active: true
  closed: false
  enable_order_book: true
  fees_enabled: true

  midpoint:
    min: 0.15
    max: 0.85

  liquidity:
    min_volume_24h_usd: 10000
    min_liquidity_usd: 5000
    min_best_level_depth_usd: 100
    min_depth_3_levels_usd: 500

  spread:
    min_spread_ticks: 3
    max_spread_cents: 8

  time:
    min_time_to_resolution_minutes: 90
    disable_near_resolution_minutes: 30

  risk:
    max_oracle_ambiguity_score: 0.20
    require_valid_resolution_source: true
```

### 4.2 Preferred Market Properties

These are not mandatory, but should increase market score:

```yaml
preferred_market_properties:
  reward_enabled: true
  stable_orderbook: true
  high_depth_near_touch: true
  historically_low_adverse_selection: true
  midpoint_between_0_25_and_0_75: true
```

### 4.3 Exclusion Rules

Do not quote a market if any of the following are true:

```yaml
exclude_market_when:
  - market_is_closed
  - market_is_paused_or_halted
  - orderbook_missing_or_empty
  - orderbook_stale
  - websocket_disconnected
  - tick_size_unknown
  - min_order_size_unknown
  - resolution_rules_ambiguous
  - known_catalyst_imminent
  - market_close_less_than_disable_window
  - spread_too_tight
  - spread_too_wide_due_to_no_depth
  - inventory_hard_limit_reached
  - recent_toxic_flow_detected
```

---

## 5. Market Scoring

Eligible markets should be ranked before quote generation.

```text
market_score =
    0.25 * volume_score
  + 0.20 * depth_score
  + 0.20 * rebate_potential_score
  + 0.15 * reward_potential_score
  + 0.10 * spread_quality_score
  + 0.10 * low_toxicity_score
```

### 5.1 Score Components

```yaml
score_components:
  volume_score:
    input: volume_24h_usd
    normalization: percentile_or_log_scaled

  depth_score:
    input:
      - best_level_depth_usd
      - depth_3_levels_usd
    normalization: percentile_or_log_scaled

  rebate_potential_score:
    input:
      - estimated_taker_flow
      - fee_rate
      - midpoint
      - expected_rebate_share
    formula_hint: fee_rate * midpoint * (1 - midpoint) * estimated_flow

  reward_potential_score:
    input:
      - reward_pool
      - max_incentive_spread
      - min_incentive_size
      - expected_quote_competitiveness

  spread_quality_score:
    input:
      - spread_ticks
      - realized_volatility
    formula_hint: spread_after_tick_cost / realized_volatility

  low_toxicity_score:
    input:
      - trade_burst_score
      - midpoint_velocity_score
      - large_trade_score
      - book_instability_score
```

---

## 6. Required Internal State Models

### 6.1 Market State

```typescript
export interface MarketState {
  conditionId: string;
  eventId?: string;
  marketSlug?: string;
  question?: string;

  yesTokenId: string;
  noTokenId: string;

  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  feesEnabled: boolean;
  negRisk?: boolean;

  category?: string;
  endDate?: string;
  resolutionSource?: string;

  volume24hUsd: number;
  liquidityUsd: number;

  feeRate?: number;
  makerRebateRate?: number;

  rewardConfig?: RewardConfig | null;

  oracleAmbiguityScore: number;
  knownCatalystAt?: number | null;
}
```

### 6.2 Reward Config

```typescript
export interface RewardConfig {
  enabled: boolean;
  minIncentiveSizeUsd: number;
  maxIncentiveSpreadCents: number;
  rewardPoolUsd?: number | null;
}
```

### 6.3 Order Book State

```typescript
export interface BookLevel {
  price: number;
  size: number;
  sizeUsd: number;
}

export interface BookState {
  tokenId: string;
  conditionId: string;

  bids: BookLevel[];
  asks: BookLevel[];

  bestBid: number | null;
  bestAsk: number | null;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;

  midpoint: number | null;
  spread: number | null;
  spreadTicks: number | null;

  depth1Usd: number;
  depth3Usd: number;

  tickSize: number;
  minOrderSize: number;

  lastTradePrice?: number | null;
  orderbookHash?: string | null;
  lastUpdateMs: number;
}
```

### 6.4 Flow State

```typescript
export interface FlowState {
  conditionId: string;
  tokenId: string;

  trades10s: number;
  trades30s: number;
  trades60s: number;

  takerBuyVolume60sUsd: number;
  takerSellVolume60sUsd: number;
  largeTradeCount60s: number;

  midpointChange10sCents: number;
  midpointChange60sCents: number;

  bookHashChanges10s: number;
  wsDisconnectsLast5m: number;

  lastLargeTradeAtMs?: number | null;
}
```

### 6.5 Inventory State

```typescript
export interface InventoryState {
  conditionId: string;

  pusdAvailable: number;

  yesTokens: number;
  noTokens: number;

  yesExposureUsd: number;
  noExposureUsd: number;
  netYesExposureUsd: number;

  marketExposureUsd: number;
  eventExposureUsd: number;
  strategyExposureUsd: number;

  inventoryPct: number;

  softLimitBreached: boolean;
  hardLimitBreached: boolean;
}
```

### 6.6 Quote Candidate

```typescript
export interface QuoteCandidate {
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';

  price: number;
  size: number;
  sizeUsd: number;

  orderType: 'GTC' | 'GTD';
  postOnly: true;
  expiresAt?: number | null;

  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;

  reason: string;
  riskFlags: string[];
}
```

---

## 7. Fair Price Engine

### 7.1 Goal

The fair price engine estimates a conservative quote center. It must not be a directional prediction engine.

### 7.2 Fair Price Formula

```text
fair =
    0.45 * microprice
  + 0.25 * book_midpoint
  + 0.20 * complement_implied_price
  + 0.10 * last_trade_ema
  + 0.00 * external_signal
```

Default weights:

```yaml
fair_price_weights:
  microprice: 0.45
  midpoint: 0.25
  complement_implied: 0.20
  last_trade_ema: 0.10
  external_signal: 0.00
```

### 7.3 Microprice

```text
microprice =
  (best_ask * bid_size + best_bid * ask_size)
  / (bid_size + ask_size)
```

If either best side is missing, fair price must be invalid.

### 7.4 Complement-Implied Price

For binary markets:

```text
yes_from_no = 1 - no_midpoint
no_from_yes = 1 - yes_midpoint
```

The implementation must compute fair price for both YES and NO tokens, but it must also check cross-consistency:

```text
abs(yes_fair + no_fair - 1.0) <= complement_consistency_tolerance
```

Default:

```yaml
complement_consistency_tolerance_cents: 2.0
```

If complement consistency fails, widen quotes or skip market.

---

## 8. Toxicity Engine

### 8.1 Goal

Detect conditions where passive quotes are likely to be filled immediately before an adverse price move.

### 8.2 Toxicity Score

```text
toxicity_score =
    0.25 * trade_burst_score
  + 0.20 * midpoint_velocity_score
  + 0.20 * orderbook_imbalance_score
  + 0.15 * large_trade_score
  + 0.10 * book_hash_instability_score
  + 0.10 * external_event_score
```

Score must be normalized to `[0, 1]`.

### 8.3 Toxicity Actions

```yaml
toxicity_policy:
  low:
    range: [0.00, 0.25]
    action: quote_normally

  medium:
    range: [0.25, 0.45]
    action: widen_quotes
    widen_by_cents: 0.5

  high:
    range: [0.45, 0.65]
    action: quote_exit_only_or_cancel
    cooldown_seconds: 20

  critical:
    range: [0.65, 1.00]
    action: cancel_all_market_orders
    cooldown_seconds: 60
```

### 8.4 Hard Toxicity Cancels

Cancel all quotes for the market if any rule triggers:

```yaml
hard_toxicity_cancels:
  midpoint_move_10s_cents_gte: 1.5
  midpoint_move_60s_cents_gte: 3.0
  large_trade_usd_gte: 1000
  book_hash_changes_10s_gte: 8
  spread_ticks_lte: 1
  orderbook_stale_ms_gte: 2000
  websocket_disconnected_seconds_gte: 3
```

---

## 9. Inventory Engine

### 9.1 Goal

Prevent uncontrolled directional exposure and shift quotes to reduce accumulated inventory.

### 9.2 Exposure Limits

```yaml
inventory_limits:
  max_market_exposure_usd: 100
  max_event_exposure_usd: 250
  max_total_strategy_exposure_usd: 1000

  soft_limit_pct: 35
  hard_limit_pct: 65
```

### 9.3 Inventory Skew

```text
inventory_skew_cents =
  max_skew_cents * tanh(inventory_pct / skew_sensitivity)
```

Defaults:

```yaml
inventory_skew:
  enabled: true
  max_skew_cents: 3.0
  skew_sensitivity: 0.35
```

### 9.4 Actions by Inventory Level

```yaml
inventory_actions:
  below_soft_limit:
    quote_both_sides: true
    normal_size: true

  above_soft_limit:
    reduce_inventory_increasing_side_size_pct: 50
    prioritize_inventory_reducing_quotes: true
    widen_inventory_increasing_side_cents: 1.0

  above_hard_limit:
    stop_adding_inventory: true
    quote_exit_only: true
    cancel_inventory_increasing_orders: true
    allow_aggressive_rebalance: false
```

### 9.5 Sell-Side Guard

Before submitting a SELL quote, the engine must verify that the wallet has sufficient token inventory.

```text
SELL YES requires yesTokens >= orderSize
SELL NO requires noTokens >= orderSize
```

If insufficient inventory, do not submit the quote.

---

## 10. Quote Engine

### 10.1 Base Half Spread

```text
target_half_spread_cents =
  max(
    tick_size_cents,
    realized_volatility_60s_cents * volatility_multiplier,
    adverse_selection_buffer_cents
  )
```

Defaults:

```yaml
spread:
  min_half_spread_ticks: 1
  base_half_spread_cents: 1.0
  volatility_multiplier: 0.8
  adverse_selection_buffer_cents: 0.5
  toxicity_widening_max_cents: 3.0
  inventory_widening_max_cents: 2.0
  reward_tightening_max_cents: 0.5
```

### 10.2 Reward-Aware Tightening

If reward configuration exists and the market is not toxic:

```text
if reward_enabled and toxicity_score <= 0.25:
  target_half_spread_cents = min(
    target_half_spread_cents,
    max_incentive_spread_cents * 0.85
  )
```

Never tighten below one tick.

### 10.3 Final Quote Prices

```text
raw_bid = fair_price - target_half_spread - inventory_skew_adjustment
raw_ask = fair_price + target_half_spread - inventory_skew_adjustment

bid = round_down_to_tick(raw_bid)
ask = round_up_to_tick(raw_ask)
```

### 10.4 Post-Only Safety

Before submit:

```text
BUY price < current_best_ask
SELL price > current_best_bid
```

If the quote would cross or touch incorrectly, skip it or move it one tick away from crossing.

### 10.5 Placement Policy

Default must be conservative.

```yaml
placement_policy:
  default: join_best

  improve_by_one_tick_when:
    spread_ticks_gte: 5
    toxicity_score_lte: 0.25
    inventory_abs_pct_lte: 30
    quote_still_within_reward_spread: true

  never_improve_when:
    spread_ticks_lte: 2
    midpoint_change_10s_cents_gt: 1.0
    large_trade_seen_30s: true
    inventory_soft_limit_breached: true
```

### 10.6 Quote Size

```yaml
size:
  base_order_size_usd: 10
  max_order_size_usd: 25
  min_size_multiplier_over_exchange_min: 1.2
  respect_reward_min_incentive_size: true
```

Size adjustment:

```text
quote_size = base_order_size_usd
quote_size *= inventory_size_multiplier
quote_size *= toxicity_size_multiplier
quote_size *= market_depth_size_multiplier
```

Rules:

```yaml
size_rules:
  if_toxicity_medium:
    multiplier: 0.5

  if_inventory_soft_limit_breached_on_inventory_increasing_side:
    multiplier: 0.5

  if_depth_3_levels_usd_below_1000:
    multiplier: 0.5

  if_reward_min_size_higher_than_base:
    use_reward_min_only_if_risk_limits_allow: true
```

---

## 11. Order Lifecycle

### 11.1 Main Loop

```text
for each market update:
  1. update market state
  2. update local order book
  3. update flow state
  4. update inventory state
  5. run hard risk checks
  6. if risk check fails: cancel market orders and skip
  7. compute fair price
  8. compute toxicity score
  9. compute inventory skew
  10. generate quote candidates
  11. validate candidates
  12. diff target quotes vs open orders
  13. cancel stale or invalid orders
  14. submit new valid post-only orders
  15. record decision trace
```

### 11.2 Cancel/Replace Rules

The system must not double exposure during replace.

Required behavior:

```text
1. Mark old order as pending_cancel.
2. Send cancel request.
3. Confirm cancel or timeout.
4. Only then submit replacement unless exposure budget allows both.
```

Default:

```yaml
cancel_replace:
  cancel_before_replace: true
  cancel_confirm_timeout_ms: 1500
  allow_overlap_if_exposure_safe: false
```

### 11.3 Stale Order Rules

```yaml
stale_order_policy:
  stale_order_max_age_ms: 2500
  min_quote_lifetime_ms: 500
  max_quote_lifetime_ms: 10000
  cancel_if_fair_price_changed_cents_gte: 1.0
  cancel_if_best_bid_ask_changed_crossing_risk: true
  cancel_if_tick_size_changed: true
```

---

## 12. Execution Engine Requirements

### 12.1 Supported Order Types

For market making:

```yaml
market_making_orders:
  order_type: GTC
  post_only: true
```

Optional for time-bounded quotes:

```yaml
time_bounded_orders:
  order_type: GTD
  post_only: true
  expires_before_known_catalyst_seconds: 60
```

Forbidden in V1 of this strategy:

```yaml
forbidden_initially:
  - aggressive_FAK_rebalancing
  - aggressive_FOK_rebalancing
  - market_taking_for_inventory_repair
```

### 12.2 Order Validation Checklist

Before every submit:

```yaml
validate_order:
  - strategy_mode_allows_trading
  - market_is_eligible
  - local_book_is_fresh
  - token_id_is_valid
  - side_is_valid
  - price_is_within_0_and_1
  - price_matches_tick_size
  - size_gte_exchange_min_order_size
  - size_lte_config_max_order_size
  - post_only_safe
  - exposure_limits_not_exceeded
  - sell_inventory_available_if_sell_order
  - no_pending_cancel_conflict
  - no_kill_switch_active
```

---

## 13. Risk Engine

### 13.1 Global Risk Config

```yaml
global_risk:
  max_total_capital_at_risk_pct: 35
  max_single_market_pct: 3
  max_single_event_pct: 8

  max_daily_drawdown_pct: 2
  max_strategy_drawdown_pct: 5

  max_consecutive_adverse_fills: 4

  cancel_all_on_ws_disconnect_seconds: 3
  cancel_all_on_api_error_rate_pct: 20
  cancel_all_on_tick_size_change: true

  disable_near_resolution_minutes: 30
```

### 13.2 Kill Switches

The implementation must include kill switches:

```yaml
kill_switches:
  ws_disconnected:
    trigger_seconds: 3
    action: cancel_all_strategy_orders

  api_error_rate_high:
    trigger_error_rate_pct: 20
    window_seconds: 60
    action: cancel_all_strategy_orders

  daily_drawdown_exceeded:
    trigger_pct: 2
    action: disable_strategy_until_manual_reset

  consecutive_adverse_fills:
    trigger_count: 4
    action: disable_market_and_cooldown

  tick_size_changed:
    action: cancel_all_market_orders_and_reprice

  market_near_resolution:
    trigger_minutes: 30
    action: cancel_all_market_orders
```

### 13.3 Adverse Fill Detection

A fill is adverse if, within a configured observation window after the fill, midpoint moves against the filled side.

```yaml
adverse_fill_detection:
  observation_window_seconds: 30
  adverse_move_threshold_cents: 1.0
```

Rules:

```text
BUY fill is adverse if midpoint_after_30s < fill_price - threshold
SELL fill is adverse if midpoint_after_30s > fill_price + threshold
```

---

## 14. Accounting and PnL Attribution

The strategy must not report only total PnL. It must attribute PnL by source.

```typescript
export interface StrategyPnlBreakdown {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;

  spreadCapturePnl: number;
  estimatedMakerRebatePnl: number;
  estimatedLiquidityRewardPnl: number;
  adverseSelectionLoss: number;
  inventoryMarkToMarketPnl: number;
  settlementPnl: number;

  feesPaid: number;
  slippageCost: number;
}
```

Required daily report:

```yaml
daily_report:
  - realized_pnl
  - unrealized_pnl
  - pnl_excluding_rebates
  - pnl_including_estimated_rebates
  - pnl_including_estimated_rewards
  - adverse_selection_loss
  - number_of_fills
  - maker_fill_rate
  - stale_fill_count
  - average_quote_lifetime_ms
  - max_inventory_exposure
  - markets_disabled_by_risk
```

Critical evaluation rule:

```text
If PnL excluding rebates is deeply negative, the strategy is unhealthy even if rebate-inclusive PnL is positive.
```

---

## 15. Decision Trace

Every quote decision must write a structured trace.

```typescript
export interface QuoteDecisionTrace {
  timestampMs: number;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';

  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';

  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spreadTicks: number | null;

  fairPrice: number | null;
  microprice: number | null;
  complementFair: number | null;
  lastTradeEma: number | null;

  toxicityScore: number;
  inventoryPct: number;
  inventorySkewCents: number;

  targetPrice?: number;
  targetSizeUsd?: number;

  expectedSpreadCaptureCents?: number;
  expectedRebateScore?: number;
  expectedRewardScore?: number;

  decision:
    | 'quote'
    | 'skip'
    | 'cancel'
    | 'exit_only'
    | 'disabled_by_risk';

  reason: string;
  riskFlags: string[];
}
```

Decision traces are mandatory for debugging and strategy review.

---

## 16. Paper Execution Simulator

### 16.1 Required Simulation Features

The paper simulator must approximate:

```yaml
paper_simulator:
  order_lifecycle:
    - submitted
    - resting
    - partially_filled
    - filled
    - canceled
    - rejected

  fill_model:
    - queue_position_approximation
    - trade_through_detection
    - partial_fill_support
    - stale_fill_after_cancel_delay

  failure_modes:
    - delayed_cancel
    - websocket_disconnect
    - api_reject
    - tick_size_change
    - orderbook_stale
    - sudden_spread_collapse
```

### 16.2 Conservative Fill Model

The simulator should not assume unrealistic fills.

Default conservative rule:

```text
A passive BUY quote fills only if observed trades execute at or below quote price after quote placement.
A passive SELL quote fills only if observed trades execute at or above quote price after quote placement.
```

Queue approximation:

```yaml
queue_model:
  default_queue_position: behind_existing_size
  fill_only_after_prior_visible_size_consumed: true
  allow_partial_fills: true
```

---

## 17. Metrics

### 17.1 Execution Metrics

```yaml
execution_metrics:
  - submitted_orders_count
  - accepted_orders_count
  - rejected_orders_count
  - post_only_reject_rate
  - canceled_orders_count
  - cancel_success_rate
  - cancel_latency_ms_p50
  - cancel_latency_ms_p95
  - avg_quote_lifetime_ms
  - fill_rate
  - maker_fill_rate
  - partial_fill_rate
  - stale_fill_count
```

### 17.2 Risk Metrics

```yaml
risk_metrics:
  - market_exposure_usd
  - event_exposure_usd
  - strategy_exposure_usd
  - max_inventory_pct
  - consecutive_adverse_fills
  - adverse_selection_loss_per_fill
  - toxicity_score_at_fill_avg
  - toxicity_score_at_fill_p95
  - markets_in_cooldown
  - kill_switch_triggers
```

### 17.3 Market Quality Metrics

```yaml
market_quality_metrics:
  - spread_ticks
  - spread_cents
  - depth_1_usd
  - depth_3_usd
  - midpoint_volatility_10s
  - midpoint_volatility_60s
  - book_hash_change_rate
  - large_trade_count_60s
  - trade_burst_score
```

---

## 18. Acceptance Criteria Before Live

The strategy must pass paper/shadow acceptance before `small_live` is allowed.

```yaml
paper_acceptance:
  min_days: 7
  min_markets_observed: 50
  min_simulated_fills: 1000

  post_only_reject_rate_max: 5
  stale_fill_rate_max: 1
  adverse_selection_loss_per_fill_max_cents: 0.5

  pnl_including_estimated_rebates: positive
  pnl_excluding_rebates: not_deeply_negative

  max_intraday_drawdown_pct: 2
  no_uncontrolled_inventory_breach: true
  no_unhandled_tick_size_change: true
  no_unhandled_ws_disconnect: true
```

Live trading must remain disabled if any acceptance condition fails.

---

## 19. Recommended Initial Config

```yaml
strategy:
  name: rebate_aware_market_making
  mode: paper
  live_trading_enabled: false

market_selection:
  fees_enabled: true
  reward_enabled_preferred: true
  min_volume_24h_usd: 10000
  min_liquidity_usd: 5000
  min_best_level_depth_usd: 100
  min_depth_3_levels_usd: 500
  min_midpoint: 0.15
  max_midpoint: 0.85
  min_spread_ticks: 3
  max_spread_cents: 8
  min_time_to_resolution_minutes: 90
  max_oracle_ambiguity_score: 0.20

fair_price:
  microprice_weight: 0.45
  midpoint_weight: 0.25
  complement_weight: 0.20
  last_trade_ema_weight: 0.10
  external_signal_weight: 0.00
  complement_consistency_tolerance_cents: 2.0

quote:
  order_type: GTC
  post_only: true
  levels: 1
  refresh_interval_ms: 1000
  stale_order_max_age_ms: 2500
  min_quote_lifetime_ms: 500
  max_quote_lifetime_ms: 10000
  improve_best_by_ticks: 0
  allow_improve_when_spread_ticks_gte: 5

spread:
  min_half_spread_ticks: 1
  base_half_spread_cents: 1.0
  volatility_multiplier: 0.8
  adverse_selection_buffer_cents: 0.5
  toxicity_widening_max_cents: 3.0
  inventory_widening_max_cents: 2.0
  reward_tightening_max_cents: 0.5

size:
  base_order_size_usd: 10
  max_order_size_usd: 25
  min_size_multiplier_over_exchange_min: 1.2
  respect_reward_min_incentive_size: true

inventory:
  max_market_exposure_usd: 100
  max_event_exposure_usd: 250
  max_total_strategy_exposure_usd: 1000
  soft_limit_pct: 35
  hard_limit_pct: 65
  max_skew_cents: 3.0
  skew_sensitivity: 0.35
  stop_adding_inventory_above_hard_limit: true
  exit_only_above_hard_limit: true

toxicity:
  cancel_if_midpoint_moves_10s_cents_gte: 1.5
  cancel_if_midpoint_moves_60s_cents_gte: 3.0
  cancel_if_large_trade_usd_gte: 1000
  cancel_if_hash_changes_10s_gte: 8
  cancel_if_spread_ticks_lte: 1
  cooldown_after_cancel_seconds: 20

risk:
  max_daily_drawdown_pct: 2
  max_strategy_drawdown_pct: 5
  max_consecutive_adverse_fills: 4
  cancel_all_on_ws_disconnect_seconds: 3
  cancel_all_on_api_error_rate_pct: 20
  cancel_all_on_tick_size_change: true
  disable_near_resolution_minutes: 30
```

---

## 20. Required Module Layout

Recommended TypeScript layout:

```text
src/
  data/
    gamma-market-scanner.ts
    clob-orderbook-client.ts
    ws-market-stream.ts
    ws-user-stream.ts

  strategy/
    market-making/
      config.ts
      market-selector.ts
      market-scorer.ts
      fair-price-engine.ts
      toxicity-engine.ts
      inventory-engine.ts
      quote-engine.ts
      rebate-estimator.ts
      reward-score-estimator.ts
      decision-trace.ts
      strategy-runner.ts

  execution/
    order-router.ts
    post-only-guard.ts
    cancel-replace-engine.ts
    open-order-reconciler.ts
    kill-switch.ts

  risk/
    exposure-limits.ts
    drawdown-guard.ts
    stale-book-guard.ts
    catalyst-guard.ts
    resolution-window-guard.ts

  accounting/
    pnl-attribution.ts
    fill-classifier.ts
    rebate-accounting.ts
    reward-accounting.ts

  simulation/
    paper-execution-engine.ts
    queue-model.ts
    slippage-model.ts

  tests/
    market-making/
      market-selector.test.ts
      fair-price-engine.test.ts
      toxicity-engine.test.ts
      inventory-engine.test.ts
      quote-engine.test.ts
      post-only-guard.test.ts
      cancel-replace-engine.test.ts
      paper-execution-engine.test.ts
      pnl-attribution.test.ts
```

---

## 21. Required Unit Tests

### 21.1 Market Selector Tests

```yaml
market_selector_tests:
  - rejects_closed_market
  - rejects_market_without_orderbook
  - rejects_fee_disabled_market
  - rejects_low_liquidity_market
  - rejects_midpoint_outside_allowed_range
  - rejects_spread_too_tight
  - rejects_near_resolution_market
  - accepts_valid_fee_enabled_market
```

### 21.2 Fair Price Tests

```yaml
fair_price_tests:
  - computes_midpoint
  - computes_microprice
  - computes_complement_implied_yes_price
  - rejects_missing_best_bid_or_ask
  - widens_or_rejects_when_complement_consistency_fails
  - rounds_prices_to_valid_tick
```

### 21.3 Toxicity Tests

```yaml
toxicity_tests:
  - low_toxicity_allows_quote
  - medium_toxicity_widens_quote
  - high_toxicity_cancels_or_exit_only
  - critical_toxicity_cancels_all
  - large_trade_triggers_cooldown
  - midpoint_velocity_triggers_cancel
  - book_hash_instability_triggers_cancel
```

### 21.4 Inventory Tests

```yaml
inventory_tests:
  - computes_net_yes_exposure
  - detects_soft_limit
  - detects_hard_limit
  - skews_quotes_against_inventory
  - blocks_inventory_increasing_orders_above_hard_limit
  - blocks_sell_order_without_inventory
```

### 21.5 Quote Engine Tests

```yaml
quote_engine_tests:
  - generates_post_only_bid_below_best_ask
  - generates_post_only_ask_above_best_bid
  - does_not_cross_spread
  - respects_tick_size
  - respects_min_order_size
  - respects_max_order_size
  - respects_reward_min_size_only_when_risk_allows
  - skips_quote_when_book_stale
```

### 21.6 Execution Tests

```yaml
execution_tests:
  - cancel_before_replace
  - does_not_double_exposure_during_replace
  - handles_cancel_timeout
  - handles_post_only_reject
  - handles_tick_size_change_by_canceling_market_orders
  - kill_switch_cancels_all_on_ws_disconnect
```

### 21.7 Paper Simulator Tests

```yaml
paper_simulator_tests:
  - passive_buy_fills_only_after_trade_at_or_below_price
  - passive_sell_fills_only_after_trade_at_or_above_price
  - respects_queue_position
  - supports_partial_fills
  - simulates_delayed_cancel_stale_fill
  - calculates_adverse_selection_after_fill
```

---

## 22. Required Integration Tests

```yaml
integration_tests:
  market_data_pipeline:
    - loads_markets_from_gamma
    - fetches_orderbooks
    - computes_market_scores
    - selects_eligible_markets

  strategy_pipeline_paper:
    - receives_book_update
    - computes_fair_price
    - computes_toxicity
    - generates_quote
    - paper_submits_quote
    - paper_fills_quote
    - updates_inventory
    - updates_pnl
    - writes_decision_trace

  risk_pipeline:
    - ws_disconnect_triggers_cancel_all
    - tick_size_change_triggers_cancel_and_reprice
    - near_resolution_triggers_market_disable
    - drawdown_limit_disables_strategy
```

---

## 23. Runtime Invariants

These invariants must never be violated:

```yaml
runtime_invariants:
  - no_live_orders_when_mode_is_paper
  - no_live_orders_when_live_trading_enabled_is_false
  - every_live_order_must_be_post_only
  - every_live_order_price_must_match_tick_size
  - no_buy_order_may_cross_best_ask
  - no_sell_order_may_cross_best_bid
  - no_sell_order_without_sufficient_inventory
  - exposure_limits_must_be_checked_before_submit
  - stale_books_must_not_generate_quotes
  - tick_size_change_must_cancel_existing_market_quotes
  - strategy_must_cancel_all_on_kill_switch
  - every_quote_decision_must_have_trace
```

---

## 24. Implementation Notes for the Coding Agent

1. Implement the strategy in **paper mode first**.
2. Do not add aggressive taker rebalancing in the first implementation.
3. Do not use LLM/news prediction as part of V1 quote generation.
4. Make risk checks synchronous and mandatory before order submission.
5. Keep quote generation deterministic and fully traceable.
6. Separate market discovery, quote calculation, execution, inventory, and accounting.
7. Do not hide rejects or skipped quotes. They are part of the diagnostic signal.
8. Treat rebates/rewards as estimated PnL until confirmed by actual payout data.
9. Always compute PnL both including and excluding estimated incentives.
10. Live trading must require explicit config and passing paper acceptance gates.

---

## 25. Definition of Done

The implementation is complete only when:

```yaml
definition_of_done:
  code:
    - all required modules implemented
    - all configs typed and validated
    - paper mode operational
    - shadow mode operational
    - small_live mode guarded by explicit flag

  risk:
    - kill switches implemented
    - exposure limits implemented
    - stale book guard implemented
    - tick-size-change guard implemented
    - near-resolution guard implemented

  accounting:
    - pnl attribution implemented
    - decision traces implemented
    - daily report implemented

  tests:
    - unit tests pass
    - integration tests pass
    - paper simulator tests pass
    - runtime invariant tests pass

  acceptance:
    - paper acceptance criteria encoded as machine-checkable gate
    - live mode blocked until gate passes
```

---

## 26. Reviewer Prompt

Use this prompt for another review agent after implementation:

```text
Review the implemented Polymarket rebate-aware market-making strategy against the specification.

Focus on:
1. Whether live trading is impossible unless explicitly enabled.
2. Whether every live order is post-only and tick-size-valid.
3. Whether stale order books, websocket disconnects, tick-size changes, and near-resolution windows cancel existing quotes.
4. Whether the quote engine avoids crossing the spread.
5. Whether inventory limits prevent uncontrolled directional exposure.
6. Whether toxicity filters actually cancel or widen quotes before adverse-flow conditions.
7. Whether cancel-before-replace prevents double exposure.
8. Whether PnL is attributed separately into spread capture, estimated rebates, estimated rewards, adverse selection, and inventory MTM.
9. Whether paper mode simulates passive fills conservatively and does not overstate edge.
10. Whether acceptance gates prevent small_live mode until paper/shadow criteria pass.

Return:
- PASS / FAIL / PASS WITH MINOR ISSUES
- critical blockers
- non-critical issues
- missing tests
- recommended fixes
```
