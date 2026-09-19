# ForecastLab: Strategic Long-Term Plan 🚀

**Date Generated**: September 19, 2026  
**Current Version**: v1.0 (All Tiers Complete - Tier 1-4 ✅)  
**Goal**: Transform ForecastLab from a solid foundation into a world-class forecasting workbench

---

## Executive Summary

ForecastLab has successfully implemented all four foundational tiers:
- **Tier 1**: Rolling-origin backtesting, interval coverage, significance testing ✅
- **Tier 2**: STL, Theta, Croston, Box-Cox methods ✅  
- **Tier 3**: Reproducibility infrastructure ✅
- **Tier 4**: Interactive browser workbench ✅

This document outlines a strategic roadmap to expand ForecastLab into a **professional-grade, explainable forecasting platform** while maintaining its core principles: **Honest, Explainable, Reproducible**.

---

## 🎯 Recommended Strategy: Hybrid Professional Platform

A balanced approach combining **professional capabilities**, **educational accessibility**, and **research rigor** without compromising the classical statistics philosophy.

### Core Philosophy (Stay True To These)
✅ No machine learning black boxes  
✅ No external dependencies  
✅ No network calls or APIs  
✅ Pure JavaScript/Node.js  
✅ Local-first design  
✅ Classical statistical methods only  

---

## Phase 1: Professional Foundation (Months 1-6)

**Focus**: Make ForecastLab production-ready for real-world enterprise data

### 1.1 Exogenous Regressors & Features ⭐ **HIGH PRIORITY**

The single biggest forecast-quality lever mentioned in the original roadmap.

**Implement:**
- **Fourier Terms**: Capture complex seasonality (daily + weekly patterns simultaneously)
- **Holiday Calendar**: Local JSON file of holidays with custom effects
- **Day-of-Week Dummies**: Automatic weekday/weekend indicators
- **External Regressor Support**: Import user-provided explanatory variables

**Why This Matters:**
- Energy example's weekend dip needs a "day type" feature
- Temperature forecasts benefit from weather features
- Sales forecasting requires promo/campaign indicators
- Still classical regression (GLM), NOT machine learning

**Implementation Approach:**
```javascript
// Project file enhancement
{
  "series": {...},
  "features": {
    "fourier": {
      "harmonics": [2, 3],  // fundamental + higher frequencies
      "seasonLength": 168   // weekly pattern for hourly data
    },
    "holidays": "./holidays.json",
    "external": ["weather.csv", "promo.csv"]
  }
}
```

### 1.2 Multiple Seasonality Support ⭐

Real-world data often has overlapping seasonal patterns.

**Examples:**
- Hourly energy data: daily (24h) + weekly (168h) seasonality
- Retail sales: weekly + yearly patterns
- Web traffic: hourly + daily + monthly cycles

**Technical Approach:**
- HOLT-WINTERS extension: Multiple seasonal indices
- STL extension: Multiple seasonal components
- Fourier decomposition for flexible periodicity
- Auto-detection of dominant seasons via autocorrelation

**Minimum Requirements:**
- At least 2 full cycles of BOTH seasonalities
- Clear separation between seasonal periods (e.g., 24 vs 168 hours is fine; 24 vs 25 hours is problematic)

### 1.3 Batch Processing Engine

Process hundreds/thousands of series efficiently.

**Features:**
- Worker pool for parallel processing
- Chunked CSV reading (memory efficient)
- Progress tracking for long runs
- Aggregate reporting across all series

**Use Case:**
- A retailer with 10,000 products → auto-select best method per product
- Utility company with 500 substations → compare performance distribution
- Healthcare system with 200 locations → identify underperforming models

**API Example:**
```javascript
import { batchForecast } from 'forecastlab';

const results = await batchForecast({
  csvFile: 'products.csv',
  idColumn: 'product_id',
  valueColumn: 'sales',
  dateColumn: 'date',
  methods: ['auto'],  // or specific list
  outputFormat: 'json'
});
```

### 1.4 Structural Break Detection

Detect when data behavior changes abruptly.

**What it detects:**
- Policy changes (new regulations)
- Pandemic impacts (COVID spikes/drops)
- Equipment failures (sudden step changes)
- Market regime shifts

**Statistical Tests:**
- Chow test (pre/post break)
-CUSUM (cumulative sum control chart)
- Bayesian change point detection

**Report Integration:**
```markdown
## Data Quality Notes
⚠️ Structural break detected at t=1247 (confidence: 94%)
   Suggested action: Consider fitting separate models 
   before and after this point, or include dummy variable
```

### 1.5 Missing Value Imputation Strategies

Handle gaps gracefully rather than failing.

**Available Methods:**
- Linear interpolation (simple trends)
- Seasonal interpolation (preserves patterns)
- Model-based imputation (fit partial model, predict missing)
- Multiple imputation (quantify uncertainty)

**Transparency Requirement:**
Report how many points were imputed and by which method — never hide the data quality issues.

---

## Phase 2: Intelligent Automation (Months 7-12)

**Focus**: Reduce user effort while improving accuracy through smart automation

### 2.1 Auto-Seasonality Detection

Stop requiring users to guess `--season 24`.

**Approach:**
- Autocorrelation function (ACF) peak detection
- Periodogram analysis (frequency domain)
- Multiple seasonality identification
- Confidence intervals on detected periods

**Output:**
```
Detected seasonality:
  Primary: 24.0 ± 0.5 periods (95% CI)
  Secondary: 168.0 ± 12 periods (weekly pattern)
Recommendation: Use snaive or stl with multiple seasonal components
```

### 2.2 Method Recommendation Engine

Learn from thousands of series characteristics to suggest optimal methods.

**Features:**
- Decision tree based on series properties
- Training data: public benchmark datasets (M-competition, etc.)
- Classification: intermittent vs trending vs seasonal
- Regression: recommend exact parameters (smoothing constants, etc.)

**Explainable Recommendations:**
```
Recommended method: Holt-Winters additive (94% confidence)

Reasoning:
✓ Strong weekly seasonality detected (ACF lag 168 peaks)
✓ Moderate trend present (slope coefficient significant)
✓ Low intermittency (zero ratio: 2.1%)
✓ Sufficient history (5,000+ points)

Alternatives to consider:
• STL (better interpretability, similar accuracy)
• Theta (faster computation, simpler)
```

### 2.3 Ensemble Forecasting

Combine multiple methods for robustness.

**Techniques:**
- Simple averaging (unweighted mean of forecasts)
- Performance-weighted (better backtest performers get more weight)
- Trimmed mean (remove top/bottom 25%, average rest)
- Dynamic ensembles (different methods dominate different horizons)

**Key Insight:**
Ensembles rarely win on every series but dramatically reduce worst-case errors. More reliable for production use.

### 2.4 Smart Parameter Tuning

Automatically optimize smoothing constants, lambda values, etc.

**Methods:**
- Grid search over parameter space (exhaustive if small)
- Cross-validation on historical data
- Bayesian optimization (smart search, fewer evaluations)
- Heuristic defaults based on series characteristics

**Example:**
```javascript
const result = fit(values, 'holt', {
  horizon: 24,
  params: { alpha: 'auto', beta: 'auto' }  // automatically tune
});
```

### 2.5 Anomaly-Aware Forecasting

Downweight outliers during model fitting rather than ignoring them.

**Robust Estimation:**
- Huber loss instead of squared error
- M-estimators for resistant statistics
- Automatic outlier detection (IQR, z-score, CUSUM)
- Iterative reweighting

**Safety Feature:**
```javascript
{
  "model": "holt",
  "robust": true,
  "outliers_detected": [
    {"index": 342, "value": 9847, "severity": "extreme"},
    {"index": 789, "value": 1234, "severity": "moderate"}
  ],
  "impact": "Reduced influence on trend estimation"
}
```

---

## Phase 3: Ecosystem Building (Months 13-18)

**Focus**: Create a sustainable ecosystem around ForecastLab

### 3.1 Plugin Architecture

Allow custom methods while keeping core clean.

**Design Principles:**
- Plugins live in separate npm packages or local folders
- Strict interface contract for compatibility
- Sandboxed execution (no arbitrary code)
- Security audit trail

**Plugin Interface:**
```javascript
// plugin-example.js
export const METHOD_ID = 'custom_arima';

export async function fit(values, params) {
  // Your implementation here
  return { forecast, interval, params, info };
}

export function summary() {
  return "Custom ARIMA-like method using state-space";
}

// Optional metadata
export const MIN_POINTS = 30;
export const REQUIRES_SEASONALITY = false;
```

### 3.2 Project Sharing & Portability

Move beyond single-file projects.

**Features:**
- Project archives (.forecast.zip containing all referenced files)
- Relative path resolution (portable across machines)
- Encryption option for sensitive data
- Digital signatures for integrity verification

**Workflow:**
```bash
# Package project for sharing
forecastlab archive --project my-analysis.forecast.json \
                   --output my-analysis.forecast.zip

# Recipient unpacks and opens
unzip my-analysis.forecast.zip
forecastlab report --project my-analysis.forecast.json
```

### 3.3 Benchmark Dataset Repository

Community-maintained collection of standard datasets.

**Types:**
- Public domain (M-competition, tourism, etc.)
- Anonymized business data (from contributors)
- Synthetic test cases (edge cases, stress tests)
- Educational examples (step-by-step walkthroughs)

**Metadata Standard:**
```json
{
  "name": "Retail-Sales-EU",
  "description": "Monthly retail sales across 12 EU countries",
  "source": "Eurostat (public domain)",
  "frequency": "monthly",
  "units": "EUR millions",
  "period": "2010-2020",
  "size": 1440,
  "characteristics": ["trending", "seasonal", "structural_break"],
  "recommended_methods": ["stl", "hw", "theta"]
}
```

### 3.4 Report Gallery & Templates

Beautiful, customizable reporting.

**Template Types:**
- Executive summary (business audience)
- Technical deep dive (data scientists)
- Regulatory compliance (audit-focused)
- Student workbook (educational)
- Research paper (LaTeX export)

**Customization:**
- Logo insertion
- Brand colors
- Section visibility toggles
- Language localization (i18n framework)

---

## Phase 4: Advanced Analytics (Months 19-24)

**Focus**: Push boundaries while staying classical

### 4.1 Multi-Series Modeling

Joint modeling of related time series.

**Applications:**
- Hierarchical reconciliation (total sales = sum of regions)
- Panel data analysis (compare methods across groups)
- Spillover effects (A influences B)
- Factor models (common latent drivers)

**Approach:**
- Vector autoregression (VAR) simplified
- Dynamic factor models
- Hierarchical Bayes (no MCMC—use analytical solutions)

### 4.2 Uncertainty Quantification Upgrade

Beyond prediction intervals.

**Enhancements:**
- Prediction intervals for cumulative totals
- Joint intervals (simultaneous coverage for horizon 1-52)
- Density forecasts (full predictive distribution)
- Scenario trees (what-if branches)

**Visualization:**
```
        ┌───────────────┐ High scenario
        │    ████████    │  (95th percentile)
        └───────────────┘
      ┌─────────────────┐ Mean forecast
      │     ███████████  │
      └─────────────────┘
    ┌───────────────────┐ Low scenario
    │     ████████████   │  (5th percentile)
    └───────────────────┘
```

### 4.3 Counterfactual Analysis

"What would happen if...?" scenarios.

**Examples:**
- Price increase of 10% → demand impact?
- Holiday moved from Friday to Thursday → sales shift?
- Remove structural break → how much worse would we do?
- Aggressive promotions → cannibalization effect?

**Technical Implementation:**
- Regression coefficients as causal multipliers
- Monte Carlo simulation of scenarios
- Sensitivity analysis sweeps
- Automated what-if generator

### 4.4 Real-Time Adaptation

Slow retraining schedules for streaming data.

**Strategies:**
- Update models daily/weekly/monthly on schedule
- Event-triggered updates (after detecting change points)
- Adaptive weighting (recent data gets more emphasis)
- Sliding window refitting (last N observations only)

**Important Note:**
Still batch-oriented internally (per original philosophy). The "real-time" aspect is about update frequency, not continuous streaming.

---

## Critical Success Factors

### Must-Have Characteristics

1. **Backwards Compatibility**
   - Existing projects always load
   - Deprecated features still work (with warnings)
   - Gradual migration guides

2. **Performance**
   - No memory leaks on large datasets (1M+ points)
   - Reasonable CPU usage (no unnecessary bottlenecks)
   - Progress feedback during long operations

3. **Testing Infrastructure**
   - Golden file tests for reproducibility (already started!)
   - Regression prevention suite
   - Performance benchmarking
   - Edge case coverage

4. **Documentation**
   - API reference (auto-generated JSDoc)
   - User tutorials (beginner → advanced)
   - Examples library (downloadable)
   - FAQ and troubleshooting

5. **Community Engagement**
   - Issue tracker (even if no GitHub—use something else)
   - Feature voting system
   - Contribution guidelines
   - Recognition for contributors

---

## What NOT to Do (Hard Boundaries)

🚫 **Never introduce ML libraries** (tensorflow.js, brain.js, etc.)  
🚫 **Never add network dependencies** (no external API calls)  
🫓 **Never compromise reproducibility** for speed  
🔒 **Never store data in the cloud** without user consent  
🎭 **Never hide assumptions** behind "black box" labels  

If a feature violates these, it doesn't belong in ForecastLab.

---

## Technology Stack Evolution

### Current Stack (v1.0)
- Node.js ≥20
- Native ESM modules
- HTML/CSS/SVG for reports
- No npm dependencies

### Recommended Additions (Carefully Chosen)

**Possibly Accept:**
- `commander` or `yargs` for CLI parsing (replaces manual argument handling)
- `chart.js` or `vis-network` for enhanced visualizations (optional, can be disabled)
- `diff` library for report comparison (small, pure JS)

**Consider Only If Essential:**
- SQLite wrapper (better than CSV-only storage)
- Basic HTTP server improvements (for serve.js scaling)
- Compression utilities (for large archives)

**Evaluation Criteria for Any Dependency:**
1. Is there a native JavaScript alternative?
2. Is it <50KB gzipped?
3. Does it have zero transitive dependencies?
4. Is it actively maintained (>2 commits/month)?
5. Can I read and understand all the code?

If no answer is "yes", don't add it. Keep the "zero dependencies" promise.

---

## Implementation Priority Matrix

| Feature | Impact | Effort | Priority | Phase |
|---------|--------|--------|----------|-------|
| Fourier terms/exogenous | HIGH | MEDIUM | 🔥 CRITICAL | 1 |
| Multiple seasonality | HIGH | HIGH | HIGH | 1 |
| Batch processing | HIGH | MEDIUM | HIGH | 1 |
| Auto-seasonality detection | MEDIUM | LOW | MEDIUM | 2 |
| Ensemble methods | MEDIUM | MEDIUM | MEDIUM | 2 |
| Plugin architecture | MEDIUM | HIGH | LOW | 3 |
| Anomaly-aware fitting | MEDIUM | MEDIUM | MEDIUM | 2 |
| Report templates | LOW | LOW | LOW | 3 |
| Multi-series modeling | HIGH | VERY HIGH | LOW | 4 |

**Rule:** Always implement highest-priority items first. Don't let shiny new ideas distract from foundational upgrades.

---

## Risk Assessment

### Technical Risks
1. **Complexity Creep**: Each feature adds maintenance burden
   - *Mitigation*: Strict interface contracts, comprehensive tests

2. **Performance Degradation**: Large datasets become slow
   - *Mitigation*: Profiling at each phase, memory benchmarks

3. **Feature Fragmentation**: Too many options confuse users
   - *Mitigation*: Smart defaults, progressive disclosure (advanced options hidden)

### Adoption Risks
1. **Too Complex for Casual Users**: Original simplicity lost
   - *Mitigation*: Separate "simple" and "pro" modes

2. **Not Differentiated Enough**: Why not use Prophet/AutoARIMA?
   - *Mitigation*: Emphasize transparency, reproducibility, offline capability

3. **Community Resistance to Change**: Breaking backwards compat
   - *Mitigation*: Never break existing workflows, only extend

---

## Success Metrics

Define what "success" means at each phase:

**Phase 1 Success (Professional Foundation):**
- ✅ Process 10,000+ point series in <10 seconds
- ✅ Handle exogenous regressors without errors
- ✅ Detect multiple seasonalities correctly 95% of time
- ✅ Zero critical bugs reported in batch mode

**Phase 2 Success (Intelligent Automation):**
- ✅ Auto-selection matches expert choice 85%+ of time
- ✅ Ensemble reduces worst-case error by 30% vs single method
- ✅ Parameter tuning converges reliably (never crashes)
- ✅ Anomaly detection catches 90%+ known outliers

**Phase 3 Success (Ecosystem):**
- ✅ 10+ community-contributed plugins
- ✅ 20+ datasets in benchmark repository
- ✅ Project sharing works across different environments
- ✅ Documentation covers 100% of common use cases

**Overall Vision Success:**
- ForecastLab is THE go-to tool for explainable classical forecasting
- Researchers cite ForecastLab in methodology papers
- Enterprises use it for production forecasting (not just prototypes)
- Students learn forecasting concepts THROUGH ForecastLab
- Maintainers sleep well at night (no fire-fighting emergencies)

---

## Quick Wins (Do These First!)

These provide immediate value with minimal effort:

1. **Add Fourier term calculation function** (`src/utils/fourier.js`)
   - One month of work
   - Enables exogenous features immediately
   - Useful for ALL future phases

2. **Create `examples/advanced/` directory**
   - Document 3-5 real-world use cases
   - Show Fourier terms in action
   - Prove multiple seasonality works

3. **Build "Simple Mode" CLI flag**
   - Hides advanced parameters
   - Shows only essentials: data, horizon, output
   - Welcomes non-expert users

4. **Write tutorial: "From Zero to Production Forecast"**
   - Step-by-step guide with actual company data
   - Cover everything from CSV import to report generation
   - Publish locally (not online) for flexibility

5. **Add version pinning to project files**
   - Record minimum required ForecastLab version
   - Warning if loading old project on new version
   - Foundation for reproducible research

---

## Final Thoughts

ForecastLab has a unique opportunity: **be the antidote to black-box AI forecasting**. 

In a world where:
- Companies pay $50K/year for "AI-powered" tools they can't understand
- Researchers struggle to reproduce someone else's ARIMA implementation
- Students learn Python notebooks that require 17 dependencies

...ForecastLab says: **"Let me show you EXACTLY how this forecast was calculated."**

That clarity is powerful. That reproducibility matters. That explainability is not optional.

Don't lose sight of that in pursuit of adding cool features. Every addition must earn its place by making ForecastLab **more honest, more explainable, and more reproducible** — not just more "feature-rich."

---

## Next Immediate Actions

1. ✅ Choose Phase 1 priority (Fourier terms vs multiple seasonality vs batch processing)
2. ✅ Create implementation tickets (detailed specs for each feature)
3. ✅ Set up local issue tracking (Markdown files in `docs/planning/`)
4. ✅ Begin development on one feature at a time
5. ✅ Test obsessively (golden files, edge cases, documentation)

**Remember:** Great software isn't built by doing everything at once. It's built by doing ONE thing exceptionally well, then adding the next.

Start small. Ship often. Stay true to the mission.

---

*Generated for ForecastLab internal planning. Not for public distribution.*
*Last updated: September 19, 2026*
