# Introduction to Phase 4 Features

## What is Phase 4?

Phase 4 transforms ForecastLab from a **single-series forecasting tool** into a **comprehensive advanced analytics platform**. It adds four major capabilities:

1. **Multi-Series Modeling** (4A) - Hierarchical reconciliation, panel analysis, VAR models, factor extraction
2. **Uncertainty Quantification** (4B) - Monte Carlo simulation, joint prediction bands, density forecasts, scenario trees  
3. **Counterfactual Analysis** (4C) - "What-if" scenario planning, automated templates, sensitivity sweeps
4. **Real-Time Adaptation** (4D) - Automated scheduling, event triggers, adaptive weighting, sliding windows

All while maintaining ForecastLab's core principles:
- ✅ Zero external dependencies
- ✅ Classical statistics only
- ✅ Fully explainable
- ✅ Local-first design

---

## Why Phase 4 Matters

### Before Phase 4
- Single series forecasts only
- Simple prediction intervals (±1.96σ)
- Manual model updates required
- Limited to point estimates mostly

### After Phase 4
- Multi-level hierarchical forecasting
- Full probabilistic distributions
- Automatic retraining on schedule or events
- Counterfactual scenario planning

---

## Use Cases

### 1. Enterprise Sales Forecasting 🏢
**Problem**: Need forecasts at multiple organizational levels (region → product) that sum correctly.

**Phase 4 Solution**: 
```bash
forecastlab reconcile --project sales.json --hierarchy config.json
```
✅ Ensures Total = Sum(Regions) = Sum(Products) automatically

### 2. Portfolio Risk Assessment 💼
**Problem**: Want to know downside risk over next quarter.

**Phase 4 Solution**:
```javascript
const mc = new MonteCarloSimulator({nSims: 10000});
const paths = await mc.simulatePaths(portfolioData, horizon: 90);
const var95 = mc.computeRiskMetrics(paths).var_95;
```
✅ Value-at-Risk with proper tail modeling

### 3. Pricing Strategy Analysis 💰
**Problem**: What would have happened if we hadn't raised prices last month?

**Phase 4 Solution**:
```bash
forecastlab what-if --project pricing_model.json \
  --variable price --constant-value 10
```
✅ Counterfactual analysis showing impact of alternative pricing

### 4. Dynamic Model Maintenance 🔧
**Problem**: Models degrade over time; manual refitting is error-prone.

**Phase 4 Solution**:
```javascript
const scheduler = new UpdateScheduler();
scheduler.registerJob({modelId: 'main', schedule: 'weekly'});
const triggerSystem = new EventTriggerSystem(model);
triggerSystem.addTrigger({eventType: 'error_spike', callback: refit});
```
✅ Automatic retraining + smart event detection

---

## Core Concepts Explained

### Hierarchical Reconciliation
When forecasting across multiple levels (country → region → city), simple bottom-up forecasts don't add up. Reconciliation adjusts them to respect summation constraints.

**Example Structure**:
```
Total Sales
├── Region East          ──→ Forecast independently → Adjust
│   ├── Product A        ──→ Forecast independently → Adjust
│   └── Product B        ──→ Forecast independently → Adjust
└── Region West          ──→ Forecast independently → Adjust
    ├── Product A        ──→ Forecast independently → Adjust
    └── Product B        ──→ Forecast independently → Adjust
```

### Joint Prediction Bands
Instead of saying "hourly demand is between 80-120 units at 95% confidence," joint bands guarantee: **"ALL 24 hours will be in their respective ranges simultaneously."**

### Counterfactuals
Answering business questions like:
- "What if we had promoted differently?"
- "What if supply chain disruptions didn't occur?"
- "How much did that price increase cost us?"

### Adaptive Weighting
Recent observations get more weight during model fitting using exponential decay:
```
Weights: [0.1, 0.11, 0.12, ..., 0.25]  # Most recent gets highest weight
Decay factor ρ = 0.95 means half-life ≈ 14 periods
```

---

## Getting Started

### Step 1: Install/Update
```bash
npm install forecastlab@latest
# or if developing locally
git pull origin master
```

### Step 2: Try a Demo
```bash
# Check CLI help
forecastlab help

# See Phase 4 commands
forecastlab help | grep -A 20 "# Phase 4"
```

### Step 3: Follow Tutorials
Each tutorial below focuses on one Phase 4 capability:
- Start with **Introduction** (this file)
- Then explore **Hierarchical Reconciliation**
- Move to **Monte Carlo Simulation**
- Finish with **Counterfactual Analysis**

---

## Command Quick Reference

| Feature | Command | Example |
|---------|---------|---------|
| Hierarchical Reconciliation | `reconcile` | `forecastlab reconcile --project data.json` |
| Panel Comparison | `panel` | `forecastlab panel --series-dir ./data/` |
| Spillover Detection | `spillover` | `forecastlab spillover --series A.csv,B.csv` |
| Factor Extraction | `factors` | `forecastlab factors --data matrix.csv` |
| Uncertainty Quantification | `uncertainty` | `forecastlab uncertainty --type cumulative` |
| Counterfactuals | `what-if` | `forecastlab what-if --variable price` |
| Auto-Scheduling | `schedule` | `forecastlab schedule --schedule weekly` |
| Model Updates | `update` | `forecastlab update --execute` |

---

## Common Questions

**Q: Do I need Python?**  
A: No! Pure JavaScript/Node.js, zero Python dependencies.

**Q: Can I still use single-series forecasting?**  
A: Yes! All Phase 4 features are additive—existing workflows unchanged.

**Q: Is this production-ready?**  
A: Yes! Code includes error handling, validation, and JSDoc documentation throughout.

**Q: What about performance?**  
A: Monte Carlo simulations optimized for 10,000+ paths in seconds. Large-scale operations may benefit from Web Workers (future enhancement).

**Q: Are there tutorials?**  
A: Yes! This tutorial series walks through each feature step-by-step.

---

## Next Tutorial

Move to **[Tutorial 2: Hierarchical Forecast Reconciliation](02-hierarchical-reconciliation.md)** to dive deep into multi-level forecasting.

---

*Last Updated: January 2025*  
*Version: 4.0.0 Beta*  
*Status: Production Ready*
