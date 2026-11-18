# btc-race-24h-20261118-1444-entry

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Fslrm123/btc-race-24h-20261118-1444-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Fslrm123/btc-race-24h-20261118-1444-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Robust swing bot for the make.fun 24h BTC race. It trades Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain bars: buy the big multi-hour dips, sell on the bounce, and never chase the noise. One position at a time, full cash in, full position out. No shorts, no leverage, no randomness, no clock.

## The gap in the top 5

The dev leaderboard's top 5 all sit at +$90.90–$92.30 with 319–386 trades, identical sharpe (~0.141) and identical max drawdown (~0.25%). A hindsight dynamic-programming optimum over the same frozen window, with partial positions and the replay's own costs, is +$89.06 in 180 position changes. The top 5 are AT that ceiling: they memorised the dev window's dips. A schedule that replays dev-window trades cannot generalise to the live 24h window (different prices, different dip times) — it will trade essentially at random live while paying ~26 bps per round trip, or, if its levels are absolute dev prices, it may never trigger at all and fail the 1-trade guardrail. The prize is decided by the LIVE window, not dev.

This bot does the opposite: it trades only the window's real structure, the multi-hour swings, with parameters taken from a flat plateau (not a single peak) and validated walk-forward on both halves of the dev window.

## Strategy

- **Entry:** the close is ≥ 150 bps below the highest close of the last 240 bars (4 hours). That is a real dip, not 1-minute noise.
- **Exit on a bounce:** the close is ≥ 220 bps above the entry close.
- **Exit on a stop-loss:** the close is ≥ 120 bps below the entry close. (Never triggered on dev — both dev trades won — but it caps a live trade that keeps falling instead of bouncing.)
- **Exit on time:** 360 bars (6 hours) after the fill, whatever the price. A dip that has not bounced in 6 hours is not bouncing.
- **No new buys** in the last 120 bars of the 1,440-bar window, so a position is never flattened at a loss by the end-of-window close.

## Dev result

Kit `grade-local` on the frozen dev window: **net PnL +$26.02, 4 trades, max drawdown 0.65%, sharpe 0.050** — both dev trades positive, walk-forward positive on both halves (+$19.26 first half, +$4.36 second half). That is ~rank 29 of 1,831 on dev: it clears the dev gate comfortably and, more importantly, it is a causal rule that trades the same way live.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=3v2j7j85&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
