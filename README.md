# Token Radar

A token launch radar for make.fun's `token-radar-01` bounty. It reads a sealed
snapshot of every protocol DefiLlama tracks, ranks the protocols that record
no token yet by what a launch would be worth, and shows a reader how to farm
each one.

Built by Dexter (Muse) for [@botann001](https://github.com/Botann001).

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it?

- **178 rows**: the full 40-protocol watchlist, plus every other protocol that
  passes the watchlist's own rule below the $50M floor. Nothing is hand-picked.
- **164 set aside**, each with its reason: wrapped, staked or bridged products
  of a token that already trades, versioned pools, exchange products, and
  protocols above the floor the watchlist left out.
- **32 live-token protocols** shown apart, with their market caps: the market
  that calibrates the model, never mixed into the ranking.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

```
implied = round(TVL x category_multiple x growth x maturity x breadth)
```

- **Category multiple**: each category's median market-cap-to-TVL ratio over
  its live-token protocols in this same snapshot, shrunk toward the global
  median by `n / (n + 6)` and clamped to `[0.05, 0.80]`. A category with fewer
  than 3 live comps uses the global median and says so.
- **Growth**: `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- **Maturity**: `0.6 + 0.4 x sqrt(min(age_days, 1095) / 1095)`; unknown age
  uses 365 days. The first year of running with no token proves the most.
- **Breadth**: `1 + 0.02 x min(chains - 1, 5)`.

No protocol name is special-cased. The dashboard recomputes every row from the
same figures and checks the number `board.json` carries, and its model sandbox
lets a reader re-rank the board with their own base scale and growth weight
without touching the shipped board.

Each row carries a 7-step farm plan derived from its category, chains, TVL and
age: a fresh wallet and test amount, the category's action, a weekly action
(alternating chains for multi-chain protocols), a hold window, a claim check,
an exit with approval revocation, and a farm log. Every step states its cost
and time; gas figures are planning estimates, not quotes.

## Run it

Node.js 22.18 or later, standard library only, no install:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html`
in a browser; the page works with no network. In the grader's container the
snapshot is at `/input/snapshot.json` and the output at `/output`.

## Screenshots

`1-board.png` (the board), `2-detail.png` (a protocol's detail view) and
`3-filtered.png` (the Lending filter) are true renders of this dashboard at
1440x900, captured headlessly from the built output. They are regenerated
whenever the dashboard changes; the shipped shots always match the shipped
page.

## Layout

```
main.ts               program: snapshot in, board + dashboard + dossier out
lib/model.ts          the radar-2 model, farm plans, and board checks
vendor/makefun-board.ts  make.fun's dossier library, byte for byte from the kit
dashboard/            the static page: index.html, app.css, app.js (no network)
screenshots/          the three screenshots the dossier carries
```

## Honesty notes

Implied value is this entry's model, not a price or a promise, and it does not
predict whether or when a token is issued. A protocol is shown as recording
no token, never as having none: DefiLlama's record is not proof.

## License

MIT. See `LICENSE`.
