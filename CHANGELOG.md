# Changelog

All notable changes to ForecastLab will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [7.0.0] - 2026-09-21

### Added
- **Continuous forecasting (streaming layer)** - `src/streaming/` runs the same
  classical methods incrementally alongside batch mode
  - Feed connectors: CSV file tails, HTTP webhook receivers, native WebSocket
    streams, cursor-based polling for database change tracking
  - Incremental engine: bounded fit window, O(1) Welford aggregates, drift
    detection, cache invalidation, auto-recommissioning on regime shifts
  - Priority job queue with concurrency/depth limits, timeouts, and webhook
    completion callbacks
  - Alert triggers (threshold, anomaly feedback loop, drift) with
    info → warn → critical escalation and cooldowns
  - `stream` CLI command (`--feed`, `--once`, `--webhook`, `--alert-above/below`,
    `stream replay`), SSE endpoints plus a Live card in the workbench
  - Hybrid bridge: `writeSnapshot()` exports batch-compatible CSV + project
    files so `report`/`reproduce` keep working on stream data

### Fixed
- **Repair release: the workbench actually runs now.** The CLI, public API,
  and web server all failed to load (non-async `main()` using `await`,
  CommonJS `module.exports` in ESM modules, corrupted `sparse-matrix.js`
  lines, missing `d3` subpackages, wrong import paths)
- Box-Cox transform/inverse contract, NaN inverse on out-of-domain
  extrapolations, lost positivity shifts
- Croston ignoring `horizon`; GLM features never built, singular design
  matrices, flat forecasts from array-as-scalar harmonics
- VAR solving only the first equation, missing intercept, stub forecasting
- `normCdf` computing Φ(x·√2); broken inverse normal CDF; LCG mapped to
  [-0.5, 2] instead of [0, 1); `SlidingWindow` returning objects, not arrays
- All 6 unit test files failed to load (wrong import depth, missing
  `node:test` import); 15 further failures fixed across VAR, scheduler,
  Monte Carlo, and reconciliation suites
- Committed the missing `examples/*.forecast.json` files `demo` needs;
  removed the unused `d3` dependency (genuinely zero dependencies now);
  CI runs on push across Node 20/22/24 with a CLI smoke test

### Changed
- `serve --feed …` attaches a live streaming engine (`/api/stream/*` + Live card)
- `check`/`compare`/`forecast`/`report` accept a directory or bare `.` and
  auto-discover the project file; first positional doubles as the project path

## [4.0.0] - Beta Release (Current)

### Added
- **Plugin Ecosystem** - Full SDK for building custom forecasting models
  - Plugin registry system (`sdk/core.mjs`)
  - Model registration API
  - Example plugin templates in `sdk/models/`
- **Multi-Series Modeling** (Phase 4A)
  - Hierarchical Reconciliation Engine with optimal combination forecasting
  - Panel Data Analysis for cross-series comparison
  - Vector Autoregression (VAR) Models for multivariate time series
  - Factor Extraction using analytical PCA
- **New Visualization Components** (Phase 5 - Design Phase)
  - PredictionBandChart (D3.js-based)
  - ScenarioTreeSankey diagram
  - CounterfactualSliders
  - HierarchicalReconciliation treemap
  - ProgressIndicators
- **Module System Standardization**
  - Converted entire codebase to ES Modules (ESM)
  - Removed CommonJS dependencies

### Changed
- **Dependency Management**
  - Updated "Zero Dependencies" claim to "Minimal Dependencies"
  - D3.js v7.x now officially supported via CDN (no npm install required)
  - Node.js >= 20 recommended for optimal performance
- **Documentation**
  - Added comprehensive CHANGELOG
  - Updated README to reflect v4.0 features
  - Enhanced plugin developer documentation

### Fixed
- Module system conflicts resolved across all components
- Improved consistency between documentation and implementation
- Verified Git repository synchronization

---

## [3.x.x] - Previous Versions

### Notable Changes in v3
- Classical forecasting methods (Naive, Holt-Winters, STL, Theta)
- Data quality checking and validation
- Method comparison and benchmarking
- HTML/JSON report generation
- Local-first architecture (no cloud dependencies)

### Known Issues Resolved in v4
- ❌ Module system conflict (CommonJS vs ESM) → ✅ Resolved with full ESM conversion
- ❌ Undocumented D3.js dependency → ✅ Documented in minimal dependencies model
- ❌ Missing changelog → ✅ Complete changelog now maintained

---

## Version numbering follows Semantic Versioning:
- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (x.Y.z): New features, backward compatible
- **PATCH** (x.y.Z): Bug fixes, backward compatible

---

## Upgrading from v3 to v4

### Breaking Changes
- None identified so far, but test your plugins against v4

### Migration Steps
1. No migration needed for CLI usage
2. Plugin developers should review SDK documentation
3. Update any hardcoded version references

### Recommended Actions
- Review new Multi-Series modeling features
- Explore the Plugin SDK for custom model development
- Check out Phase 5 visualization designs (in progress)

---

## Future Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for upcoming features and planned releases.
