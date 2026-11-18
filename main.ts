// Robust swing bot for the make.fun 24h BTC race (btc-race-24h-20261118-1444).
//
// Strategy: buy the big multi-hour dips, sell on the bounce, and never chase
// the noise. One position at a time, full cash in, full position out.
//
// Why this shape, and what it refuses to do
// ------------------------------------------
// The dev leaderboard's top 5 all sit at +$90.90-$92.30 with 319-386 trades,
// identical sharpe (~0.141) and identical max drawdown (~0.25%). A hindsight
// dynamic-programming optimum over the same frozen window, with partial
// positions and the replay's own costs, is +$89.06 in 180 position changes.
// The top 5 are AT that ceiling: they memorised the dev window's dips. A
// schedule that replays dev-window trades cannot generalise to the live 24h
// window (different prices, different dip times), so it will trade
// essentially at random live while paying ~26 bps per round trip - or, if
// its levels are absolute dev prices, it may never trigger at all and fail
// the 1-trade guardrail. The prize is decided by the LIVE window, not dev.
//
// This bot does the opposite: it trades only the window's real structure,
// the multi-hour swings, with parameters taken from a flat plateau (not a
// single peak) and validated walk-forward on both halves of the dev window.
//
// The dev window's structure (1,440 bars, BTC $65,083 -> $63,261, -2.80%):
//   - hour 00 drops -1.35%, then hours 05-08 recover +1.9% (the big swing);
//   - hours 09-18 chop sideways $64,100-$64,900; hours 19-23 drift down
//     -1.07% into the close. A bot that buys a dip late in the window and
//     holds to the end is flattened at a loss - so this bot stops opening
//     new positions in the last 120 bars.
//   - 1-minute noise is ~6.7 bps (SD) against ~26 bps round-trip cost, so
//     micro-scalping loses after costs: a 1,944-config grid of dip-buying
//     tranche scalpers peaked at -$4.56. Only the big swings clear the cost.
//
// Rules (all in basis points, 1 bp = 0.01%):
//   - Entry: the close is >= 160 bps below the highest close of the last
//     240 bars (4 hours). That is a real dip, not 1-minute noise. 160 is
//     the most selective end of the flat plateau (dip 130-160 all give
//     +$20-26 on dev); both dev entries were deeper than 160 bps, so the
//     dev grade is unchanged, and live it skips the shallowest marginal
//     dips, which are the most likely to be noise.
//   - Exit on a bounce: the close is >= 220 bps above the entry close.
//   - Exit on a stop-loss: the close is >= 120 bps below the entry close.
//     (Never triggered on dev - both dev trades won - but it caps a live
//     trade that keeps falling instead of bouncing.)
//   - Exit on time: 360 bars (6 hours) after the fill, whatever the price.
//     A dip that has not bounced in 6 hours is not bouncing.
//   - No new buys in the last 120 bars of the 1,440-bar window, so a
//     position is never flattened at a loss by the end-of-window close.
//   - One position, long only, no leverage, no shorts, no clock, no
//     randomness, no network, no files. Every run on the same bars gives
//     the same orders.
//
// Dev result (kit grade-local, frozen window): net PnL +$26.02, 4 trades,
// max drawdown 0.65%, sharpe 0.050 - both dev trades positive, walk-forward
// positive on both halves (+$19.26 first half, +$4.36 second half). That is
// ~rank 29 of 1,831 on dev: it clears the dev gate comfortably and, more
// importantly, it is a causal rule that trades the same way live.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, BuyInput, OrderInput, SellInput } from './vendor/makefun-bars.ts';

/** Bars of trailing history the dip is measured against (4 hours). */
const LOOKBACK_BARS = 240;
/** Buy when the close is this far below the trailing high, in bps. */
const DIP_BPS = 160;
/** Sell when the close is this far above the entry close, in bps. */
const TAKE_PROFIT_BPS = 220;
/** Sell when the close is this far below the entry close, in bps. */
const STOP_LOSS_BPS = 120;
/** Sell this many bars after the fill bar if neither exit fired. */
const MAX_HOLD_BARS = 360;
/** Bars in one race window (dev and live alike, per the competition). */
const WINDOW_BARS = 1440;
/** Do not open a new position in the last this many bars of the window. */
const NO_BUY_LAST_BARS = 120;
/** Reject a fill more than this far from the close the order was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** The close of every bar so far, in price units (price_scale). */
const closes: bigint[] = [];
/** The entry this position was bought on, once its fill has been seen. */
let entryClose: bigint | null = null;
/** The bar the current position filled on (for the max-hold exit). */
let entryBar: number | null = null;
/** A buy decided on the last batch, waiting for its fill to appear. */
let pendingBuy: { close: bigint } | null = null;

function trailingHigh(): bigint {
  let high = closes[closes.length - 1];
  const from = closes.length - LOOKBACK_BARS;
  for (let i = closes.length - 2; i >= from; i -= 1) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const symbol = state.hello.symbols[0].symbol;
    // A minute the recorder took no sample has no bar for the symbol: trade
    // on nothing, and do not let a stale close into the history.
    const bar = batch.bars.find((b) => b.symbol === symbol);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);

    const held = state.positions.get(symbol);
    if (held === undefined) {
      // Flat: any entry record is stale (a buy that was rejected, or a
      // position that has just been sold). Clear it before deciding.
      entryClose = null;
      entryBar = null;
      pendingBuy = null;
    } else if (entryClose === null) {
      // Holding, but no entry recorded yet: the buy decided on the last
      // batch has filled. Anchor the exits to the decided close and the
      // fill bar, exactly as the replay's own books do.
      if (pendingBuy !== null) {
        entryClose = pendingBuy.close;
        entryBar = batch.seq;
        pendingBuy = null;
      } else {
        // Defensive: a position with no recorded decision (never happens in
        // a clean run). Anchor to the current bar so the exits still work.
        entryClose = close;
        entryBar = batch.seq;
      }
    }

    if (state.warmingUp) return [];

    if (held !== undefined && entryClose !== null && entryBar !== null) {
      const upBps = ((close - entryClose) * 10000n) / entryClose;
      const downBps = ((entryClose - close) * 10000n) / entryClose;
      const heldLong = batch.seq - entryBar >= MAX_HOLD_BARS;
      if (upBps >= BigInt(TAKE_PROFIT_BPS) || downBps >= BigInt(STOP_LOSS_BPS) || heldLong) {
        const sell: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: look for the dip. A full trailing window must exist first, and
    // no new position opens in the window's last two hours.
    if (closes.length < LOOKBACK_BARS + 1) return [];
    if (batch.seq >= WINDOW_BARS - NO_BUY_LAST_BARS) return [];
    if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const high = trailingHigh();
    const dipBps = ((high - close) * 10000n) / high;
    if (dipBps < BigInt(DIP_BPS)) return [];
    pendingBuy = { close };
    const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
