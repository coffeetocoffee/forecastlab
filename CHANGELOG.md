# Changelog

All notable changes to ForecastLab will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
