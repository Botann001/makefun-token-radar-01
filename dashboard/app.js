// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filterable tables for the live and set-aside sets, a per-protocol detail
// view with the model's own inputs and the protocol's farm plan, and a model sandbox that recomputes
// the board in the page. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, gainers: false, scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: { on: false, base: 1, growth: 0.5 } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(2); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.min(100000000000000, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth)));
  }
  // The sandbox: the same function with the reader's own base scale and growth weight. It never
  // touches board.json; turning it off restores the board's values.
  function impliedSandbox(row, model, sb) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * sb.growth;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.min(100000000000000, Math.round(row.tvl_usd * row.category_multiple * sb.base * growthMult * maturity * breadth)));
  }
  function shownImplied(row) { return state.sandbox.on ? impliedSandbox(row, DATA.model, state.sandbox) : row.implied_value_usd; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasFor(chain) { return chain === 'Ethereum' ? { setup: 12, weekly: 6, exit: 8 } : { setup: 3, weekly: 1, exit: 2 }; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('leveraged farm') >= 0) return 'Open a $' + capital + ' leveraged farm on ' + name + ' on ' + chain + ' at the lowest leverage and keep it open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' aggregator vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' yield vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' managed range on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' and use its main app on ' + chain + '.';
    if (c.indexOf('payment') >= 0) return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into the ' + name + ' farm on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var gas = gasFor(chain);
    var hold = holdDaysFor(p.age_days);
    var weekly = second === null
      ? 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.'
      : 'Make one qualifying action each week, alternating ' + chain + ' and ' + second + ', such as a deposit, a swap or a vote.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and send a $5 test amount first.', cost: 'under $' + gas.setup + ' of gas for the test and first transaction', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas.setup + ' of gas', time: '15 minutes to set up' },
      { text: weekly, cost: 'about $' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and check the points page once a month.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Unwind in two tranches a week apart, then revoke the approvals you no longer need in your wallet.', cost: 'about $' + gas.exit + ' of gas to exit', time: '20 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  function farmTotals(p) {
    var capital = capitalFor(p);
    var gas = gasFor(chainOf(p));
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    return { capital: capital, gas: gas.setup + gas.exit + gas.weekly * weeks, minutes: 60 + 10 * weeks, hold: hold };
  }

  // TVL rank and calibration lookups, computed once from the shipped data.
  var tvlRank = {};
  DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).forEach(function (r, i) { tvlRank[r.slug] = i + 1; });
  var calByCategory = {};
  (DATA.calibration || []).forEach(function (c) { calByCategory[c.category] = c; });

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    if (params.get('gain')) state.gainers = params.get('gain') === '1';
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('min', String(state.minTvl));
    if (state.gainers) params.set('gain', '1');
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function matchesCommon(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() {
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.gainers && !(r.change_7d !== null && r.change_7d > 0)) return false;
      return matchesCommon(r);
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = shownImplied(a); bv = shownImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and ' + DATA.set_aside_size + ' more are set aside with the reason each was left out. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(DATA.median_implied_usd) }))
      )
    );
  }

  function selectField(id, label, options, current, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o.value, text: o.text, selected: String(o.value) === String(current) ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var gainers = el('input', { type: 'checkbox', id: 'gainers', checked: state.gainers ? 'checked' : null, 'aria-label': 'Gainers only' });
    gainers.addEventListener('change', function () { state.gainers = gainers.checked; writeHash(); render(); });
    function scopeBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.scope === value ? 'true' : 'false', text: label, onclick: function () { state.scope = value; writeHash(); render(); } });
    }
    function tabBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === value ? 'true' : 'false', text: label, onclick: function () { state.tab = value; writeHash(); render(); } });
    }
    var countText = state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.set_aside_size + ' protocols set aside';
    if (state.sandbox.on) countText += '  ·  sandbox on';
    return el('div', null,
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        selectField('category', 'Category', [{ value: 'all', text: 'All categories' }].concat(categories.map(function (c) { return { value: c, text: c }; })), state.category, function (v) { state.category = v; }),
        selectField('chain', 'Chain', [{ value: 'all', text: 'All chains' }].concat(chains.map(function (c) { return { value: c, text: c }; })), state.chain, function (v) { state.chain = v; }),
        selectField('minTvl', 'Minimum TVL', [{ value: 0, text: 'Any TVL' }, { value: 50000000, text: '$50M or more' }, { value: 100000000, text: '$100M or more' }, { value: 500000000, text: '$500M or more' }], state.minTvl, function (v) { state.minTvl = Number(v); }),
        el('label', { class: 'check', for: 'gainers' }, gainers, 'Gainers only (7d up)')
      ),
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'tabs' }, scopeBtn('all', 'All'), scopeBtn('watchlist', 'Watchlist'), scopeBtn('early', 'Early'))),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('set-aside', 'Set aside'))),
        el('span', { class: 'count', text: countText })
      )
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.gainers = false; state.scope = 'all'; writeHash(); render(); } })
    ));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) return emptyPanel();
    var max = 1;
    list.forEach(function (r) { max = Math.max(max, shownImplied(r)); });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var flagNodes = (r.flags || []).slice(0, 2).map(function (f) { return el('span', { class: 'chip', text: f }); });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' + (r.rank <= 3 ? ' rank-top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') }),
          flagNodes.length ? el('span', { class: 'flags' }, flagNodes) : null
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownImplied(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownImplied(r)) })
        )),
        el('td', null, r.on_watchlist ? el('span', { class: 'chip watch', text: 'watchlist' }) : el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: state.sandbox.on ? 'Sandbox values: recomputed in this page with your settings. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', state.sandbox.on ? 'Implied (sandbox)' : 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = DATA.live.filter(matchesCommon);
    if (list.length === 0) return emptyPanel();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their ratios calibrate the pre-token multiples. They are set aside from the ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function setAsideTable() {
    var list = DATA.set_aside.filter(function (r) { return matchesCommon(r); });
    if (list.length === 0) return emptyPanel();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token on record, set aside from the ranking: wrapped, staked or bridged products of a token that already trades, versioned pools, exchange products, and protocols above the floor the watchlist left out. Largest first.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why set aside' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var calRows = (DATA.calibration || []).map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: c.median_ratio === null ? 'n/a' : fmtMult(c.median_ratio) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) + (c.fallback ? ' *' : '') })
      );
    });
    var sb = state.sandbox;
    var toggle = el('input', { type: 'checkbox', id: 'sb-on', checked: sb.on ? 'checked' : null, 'aria-label': 'Enable the model sandbox' });
    toggle.addEventListener('change', function () { sb.on = toggle.checked; render(); });
    function sbSelect(id, label, options, current, key) {
      var s = el('select', { id: id, 'aria-label': label }, options.map(function (o) { return el('option', { value: String(o), text: String(o), selected: o === current ? 'selected' : null }); }));
      s.addEventListener('change', function () { sb[key] = Number(s.value); sb.on = true; render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset sandbox', onclick: function () { state.sandbox = { on: false, base: 1, growth: 0.5 }; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + sqrt(min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ') x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the snapshot market pricing itself: each category median market-cap-to-TVL ratio over its live-token protocols, shrunk toward the global median (' + fmtMult(DATA.global_median_ratio) + ' over ' + DATA.global_comps + ' live protocols) by n / (n + ' + m.shrink_k + '), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. A category with fewer than ' + m.min_comps + ' live comps uses the global median. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. Gas figures in the farm plans are planning estimates, not quotes.' }),
      el('table', { class: 'calib' },
        el('caption', { class: 'sub', text: 'Calibration: one multiple per category on the board. * Uses the global median.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Median ratio' }), el('th', { scope: 'col', text: 'Multiple used' }))),
        el('tbody', null, calRows)
      ),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox' }),
        el('label', { class: 'check', for: 'sb-on' }, toggle, 'Recompute the board with my own settings'),
        el('div', { class: 'row' },
          sbSelect('sb-base', 'Base scale (multiplies every category multiple)', [0.5, 0.75, 1, 1.5, 2], sb.base, 'base'),
          sbSelect('sb-growth', 'Growth weight', [0, 0.25, 0.5, 0.75, 1], sb.growth, 'growth'),
          reset
        ),
        sb.on ? el('p', { class: 'sandbox-note', text: 'Sandbox on: the board above shows recomputed values. board.json is unchanged; turn the sandbox off to see the board values again.' }) : el('p', { class: 'sub', text: 'Change a setting to re-rank the board in this page only. The shipped board always uses the stated model.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function whyRank(row) {
    var parts = [];
    parts.push('TVL ' + fmtUsd(row.tvl_usd) + ' is the ' + ordinal(tvlRank[row.slug]) + ' largest on the board');
    parts.push('seven-day growth ' + fmtPct(row.change_7d) + ' gives a growth multiplier of ' + row.growth_multiplier);
    parts.push('age ' + fmtAge(row.age_days) + ' with no token gives a maturity multiplier of ' + row.maturity_multiplier);
    parts.push((row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ' gives a breadth multiplier of ' + row.breadth_multiplier);
    var cal = calByCategory[row.category || 'Other'];
    if (cal) parts.push('the ' + (row.category || 'Other') + ' multiple ' + fmtMult(row.category_multiple) + ' rests on ' + cal.comps + ' live comp' + (cal.comps === 1 ? '' : 's') + (row.category_fallback ? ' (global median: too few comps)' : ''));
    return 'Why rank ' + row.rank + ': ' + parts.join('; ') + '.';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var totals = farmTotals(row);
    var recomputed = impliedOf(row, DATA.model);
    var cal = calByCategory[row.category || 'Other'];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? '  ·  watchlist' : '  ·  early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        (row.flags || []).length ? el('p', { class: 'flags' }, (row.flags || []).map(function (f) { return el('span', { class: 'chip', text: f }); })) : null
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) + (cal ? ' (' + cal.comps + ' comp' + (cal.comps === 1 ? '' : 's') + (row.category_fallback ? ', global median' : ', median ' + (cal.median_ratio === null ? 'n/a' : fmtMult(cal.median_ratio))) + ')' : '') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'why', text: whyRank(row) }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'totals', text: 'Plan total: $' + totals.capital + ' of capital + about $' + totals.gas + ' of gas (estimate) + ' + totals.minutes + ' minutes of active time, held ' + totals.hold + ' days. Gas is an estimate: check the wallet quote before each transaction.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : setAsideTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Implied value is this entry\u2019s model, not a price or a promise, and it does not predict whether or when a token is issued. A protocol is shown as recording no token, never as having none. Snapshot: DefiLlama protocol index, ' + DATA.as_of + '. This page works with no network: every figure ships with it.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  // Back and forward across shared links re-read the hash, so a pasted #p= link opens its detail
  // even when the page is already open. writeHash uses replaceState, so this never loops.
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.gainers = false;
    state.scope = 'all'; state.tab = 'pre-token'; state.selected = null;
    readHash();
    render();
  });
  window.RADAR_TEST = { impliedOf: impliedOf, farmSteps: farmSteps, impliedSandbox: impliedSandbox };
})();
