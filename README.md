# 🔮 ForecastLab v4.0

**Classical forecasting without the black-box magic ✨**

![Version](https://img.shields.io/badge/version-4.0.0--beta-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## 🚀 The Pitch

Tired of paying **$50K/year for AI tools you can't understand**?  
Sick of **ML frameworks that require 17 dependencies**?  

ForecastLab says: **"Let me show you EXACTLY how this forecast was calculated."**

No hidden algorithms. No black boxes. Just honest, explainable classical statistics that actually make sense.

---

## 🎯 What You Get

- ✅ **Minimal Dependencies** — Pure Node.js with optional D3.js for visualizations (CDN, no npm install needed)
- ✅ **Explainable Models** — Every method comes with plain-language explanations
- ✅ **Reproducible Reports** — SHA-256 hash + exact command recorded
- ✅ **Plugin Ecosystem** — Build custom models with our SDK (v4.0!)
- ✅ **Local First** — Your data never leaves your machine
- ✅ **Classic Methods** — Naive, Holt-Winters, STL, Theta, and more
- ✅ **Causal Understanding** — Discover *why* series move: lagged relationships, what-if simulations, external events, counterfactuals — all classical statistics, no ML

---

## 📦 Quick Start

### Option 1: Try Built-in Example (5 minutes)

```bash
# Copy demo data
node src/cli.js demo --example energy

# Check quality, compare methods, generate report
cd forecastlab-demo/energy
node ../src/cli.js check .
node ../src/cli.js compare .
node ../src/cli.js report --html report.html
```

Open `report.html` in your browser — **that's it!**

### Option 2: Use Your Own Data

```bash
# Initialize from CSV
node src/cli.js init --data measurements.csv --unit kWh --season 24

# Compare methods automatically
node src/cli.js compare --project measurements.forecast.json

# Generate full report
node src/cli.js report --project measurements.forecast.json \
  --html out/report.html --json out/report.json
```

---

## 🛠️ Commands Cheat Sheet

| Command | What It Does | Example |
|---------|--------------|---------|
| `demo` | 🎭 Try built-in examples | `node src/cli.js demo --example energy` |
| `init` | 📥 Import your CSV | `node src/cli.js init --data sales.csv --season 12` |
| `check` | 🔍 Validate data quality | `node src/cli.js check --project mydata.forecast.json` |
| `compare` | ⚔️ Backtest & rank methods | `node src/cli.js compare --method auto` |
| `forecast` | 🔮 Generate predictions | `node src/cli.js forecast --horizon 48` |
| `report` | 📄 Create HTML/JSON report | `node src/cli.js report --html report.html` |
| `serve` | 🌐 Open interactive workbench | `node src/cli.js serve --open` |
| `methods` | 📖 Learn about algorithms | `node src/cli.js methods` |
| `plugins` | 🔌 List installed plugins | `node src/cli.js plugins --list` |
| `causal graph` | 🕸️ Discover how variables affect each other | `node src/cli.js causal graph --data examples/causal-energy.csv --season 24 --html causal.html` |
| `causal what-if` | 🧪 Simulate "what if we changed X?" | `node src/cli.js causal what-if --data examples/causal-energy.csv --variable temperature --target demand --change 5` |
| `causal factors` | 📅 Measure external events (holidays, promos) | `node src/cli.js causal factors --data examples/causal-energy.csv --value demand --factors examples/causal-factors.json --season 24` |
| `causal counterfactual` | 🔀 Actual vs "what would have happened" | `node src/cli.js causal counterfactual --data examples/causal-sales.csv --event-date 2026-04-01` |

---

## 🧪 Try It Now!

See what ForecastLab can do in seconds:

```bash
# Watch charts dance and forecasts appear
node src/cli.js demo --example energy
node src/cli.js serve --project energy.forecast.json --open
```

---

## 🎓 For Plugin Developers

Build your own forecasting models in under 10 lines:

```javascript
import { registerModel } from '@forecastlab/sdk';

export class MyForecaster {
  fit(data) { /* your algorithm */ }
  forecast(horizon) { /* your predictions */ }
  explain() { return "How I work"; } // ← Everyone sees this!
}

registerModel('my-custom', MyForecaster);
```

👉 [Get started](./docs/plugins/getting-started.md) | [View examples](./sdk/models/)

---

## 🏆 Why ForecastLab?

| Problem | Other Tools | ForecastLab |
|---------|-------------|-------------|
| **Understanding** | ❌ Black box ML | ✅ Show me the math |
| **Setup** | ❌ 17 npm packages | ✅ `node cli.js` |
| **Privacy** | ❌ Cloud APIs | ✅ Local only |
| **Cost** | ❌ $50K/year SaaS | ✅ Free forever |
| **Trust** | ❌ Hidden assumptions | ✅ Everything visible |
| **Reproducibility** | ❌ Can't reproduce | ✅ Hash recorded |

---

## 📊 Built-in Examples

Try these real-world datasets:

- ⚡ **energy** - Hourly building electricity (daily + weekly patterns)
- 🌊 **river** - Daily water levels (long-term trends)
- 🌡️ **temp** - Mean daily temperature (seasonal cycles)
- 🕸️ **causal** - Hourly energy market: temperature and price driving demand (for the `causal` commands)

Each comes with project files ready to explore!

---

## 🧠 Causal Understanding (No Machine Learning)

ForecastLab answers **why** a series moves, not just what it will do next — using
only classical statistics you can audit line by line:

- **Relationship builder** — discovers lagged links between variables
  (temperature → demand at lag 0, price → demand at lag 1), each with a lag
  profile, a per-unit effect, a Granger-style F-test p-value, and a 0–1
  confidence score. `--html` opens a **drag-and-drop graph**: rearrange nodes,
  and test your own hypotheses by dragging from a node's green handle onto
  another node — the statistics re-run instantly in your browser.
- **Intervention simulator** — "what if we changed X?" propagates the change
  through the fitted impulse response (no unexplained multipliers), with
  uncertainty bands, extrapolation warnings, and natural experiments found in
  history.
- **External factor integration** — register holidays, promotions, or weather
  series with temporal decay kernels (box, exponential, triangular, gaussian,
  step), get each factor's measured effect, and rank them by impact magnitude
  against a seasonal baseline.
- **Counterfactual engine** — builds a control group of similar periods and
  computes difference-in-differences with a t-test, so you can compare what
  happened against what would have happened.

```bash
node src/cli.js demo --example causal
node src/cli.js causal graph --data examples/causal-energy.csv --season 24 --html causal.html
```

👉 [Causal guide](./docs/causal.md) — methods, options, and the programmatic API

---

## 🔬 How It Works

```
1. CHECK   → Spot data issues before they break forecasts
2. COMPARE → Holdout last 20%, test all methods, pick winner by RMSE
3. FORECAST→ Refit winner on all data, predict forward
4. REPORT  → Bundle charts, metrics, explanations into HTML
```

Every step is documented, reproducible, and makes sense.

---

## 📚 Documentation

- [Data Format Guide](./docs/data-format.md) - How to structure your CSV
- [Workflow Tutorial](./docs/workflow.md) - Best practices explained
- [Methods Reference](./docs/methods.md) - Every algorithm decoded
- [Causal Guide](./docs/causal.md) - Why series move: relationships, what-ifs, events, counterfactuals
- [Plugin SDK](./sdk/README.md) - Extend ForecastLab
- [Roadmap](./docs/roadmap.md) - Where we're heading

---

## 🎯 Non-Goals (So You Know)

- ❌ **No ML** - We stick to classical statistics
- ❌ **No ARIMA** - Too complex for our philosophy
- ❌ **No API Keys** - Never create accounts
- ❌ **No Real-time** - Batch processing only
- ❌ **No Deployment** - `serve` is local-only

---

## 🏗️ Project Structure

```
forecastlab/
├── src/           🔧 Core engine & CLI
│   ├── models/    ← Statistical forecasting methods
│   ├── methods/   ← Algorithm implementations
│   └── cli.js     ← Main command interface
├── sdk/           🧩 Plugin ecosystem (v4.0!)
│   ├── core.mjs   ← Plugin registry
│   └── models/    ← Example plugins
├── examples/      📊 Demo datasets
├── docs/          📖 Documentation
├── test/          ✨ Test suite
└── scripts/       🛠️ Helper utilities
```

---

## 📜 License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

## 💬 Final Word

**ForecastLab exists because predicting the future should be:**

- Explainable ✅
- Reproducible ✅
- Honest ✅
- Accessible ✅

Not hidden behind expensive software licenses or mysterious AI magic.

**Ready to forecast honestly?** 👇

```bash
npm install -g forecastlab  # Or just clone and run!
forecastlab demo --example energy
```

---

*Made with ❤️ for transparent, trustworthy forecasting.*  
*v4.0.0-beta — Plugin ecosystem now live!* 🚀
