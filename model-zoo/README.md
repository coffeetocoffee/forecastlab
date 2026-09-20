# ForecastLab Model Zoo
## Contributed Forecasting Models Repository

Welcome to the ForecastLab Model Zoo! This is a collection of community-contributed, validated forecasting models that extend the base ForecastLab engine.

---

## Quick Links

- **[Model Catalog](./catalog.json)** - Browse all available models
- **[Contribution Guidelines](../CONTRIBUTING_MODELS.md)** - How to submit your model
- **[Validation Framework](./validation-guide.md)** - Quality standards for submissions
- **[Benchmark Dashboard](./benchmarks.html)** - Performance comparisons

---

## Featured Models (v3.0)

### 🏆 Top Performers

| Model | RMSE Improvement | Best For | Author | Status |
|-------|------------------|----------|--------|--------|
| `holt-winters-optimized` | +12% vs baseline | Seasonal series | Jane Smith | ✅ Validated |
| `stl-theta-combo` | +8.5% vs baseline | Multiple seasonality | Bob Lee | ✅ Validated |
| `naive-plus` | +5% vs naive | All series types | Alice Chen | ✅ Validated |

### 🆕 Newest Additions

| Model | Description | Category | Author | Date |
|-------|-------------|----------|--------|------|
| `bayesian-update` | Bayesian updating with conjugate priors | Bayesian | Dr. Kim | Jan 2026 |
| `fourier-hybrid` | Fourier terms + regression | Hybrid | Marco P. | Jan 2026 |
| `robust-holt` | Huber loss-based Holt method | Robust | Sarah W. | Dec 2025 |

### 🔧 Community Contributions

Models are indexed by difficulty level and use case:

**Beginner-Friendly**:
- `seasonal-mean` - Simple seasonal averaging
- `drift-with-trend` - Basic drift method
- `rolling-window` - Rolling average forecast

**Intermediate**:
- `arima-lite` - Simplified ARIMA implementation
- `exponential-smoothing-advanced` - Multi-level smoothing
- `structural-break-adjusted` - Detects and adapts to breaks

**Advanced**:
- `var-spillover` - Vector Autoregression for multiple series
- `factor-model` - Latent factor extraction
- `scenario-tree-builder` - Multi-path branching forecasts

---

## Model Zoo Structure

Each model in the zoo follows this structure:

```
models/
├── holt-winters-optimized/
│   ├── README.md              # Overview and best practices
│   ├── explanation.md         # Mathematical details
│   ├── usage.md               # CLI/API examples
│   ├── src/
│   │   ├── model.js           # Implementation
│   │   └── test.js            # Test suite
│   ├── benchmarks/
│   │   └── results.json       # Performance data
│   └── manifest.json          # Plugin metadata
├── arima-lite/
│   └── ...
└── bayesian-update/
    └── ...
```

---

## Benchmark Results

### Latest Comparison: Monthly Business Series (n=50)

**Horizon**: 12 steps ahead  
**Metrics**: RMSE, MAE, MAPE, sMAPE, MASE  

| Rank | Model | RMSE | MAE | MAPE (%) | Time (ms) |
|------|-------|------|-----|----------|-----------|
| 1 | `holt-winters-optimized` | 0.089 | 0.072 | 4.2 | 12 |
| 2 | `stl-theta-combo` | 0.091 | 0.074 | 4.5 | 18 |
| 3 | `arima-lite` | 0.095 | 0.078 | 4.8 | 25 |
| 4 | `exponential-smoothing-advanced` | 0.098 | 0.081 | 5.1 | 15 |
| 5 | Holt-Winters (baseline) | 0.101 | 0.083 | 5.3 | 10 |
| 6 | `naive-plus` | 0.112 | 0.089 | 5.8 | 8 |
| 7 | Seasonal Naive | 0.134 | 0.102 | 6.9 | 5 |

*See full benchmark dashboard for interactive visualization*

---

## Installation & Usage

### Install via npm

```bash
npm install @forecastlab/models-bundle
```

This installs all validated models from the zoo.

### Install Individual Models

```bash
npm install @forecastlab/model-arima-lite
npm install @forecastlab/model-bayesian-update
```

### Use in ForecastLab

```bash
# List available models
node src/cli.js methods

# Run comparison with custom model
node src/cli.js compare --project mydata.forecast.json \
  --method holt-winters-optimized,arima-lite
  
# Use specific model for forecast
node src/cli.js forecast --project mydata.forecast.json \
  --method bayesian-update --horizon 24
```

---

## Validation Standards

All models in the zoo must pass:

✅ **Automated Tests** (80%+ coverage)  
✅ **Performance Threshold** - Must beat or match baseline on at least one metric  
✅ **Documentation** - Clear explanation, math, usage examples  
✅ **Reproducibility** - All benchmarks verifiable  
✅ **Peer Review** - Reviewed by at least 2 community members  

### Quality Tiers

- **⭐ Verified** - Passes all validation criteria
- **🌟 Recommended** - Verified + demonstrated outperformance on diverse datasets
- **🚀 Experimental** - Under review, early feedback welcome

---

## Submit Your Model

We welcome contributions from the community!

### Steps to Contribute

1. Fork the [forecastlab-models](https://github.com/coffeetocoffee/forecastlab-models) repository
2. Create new model directory following our template
3. Implement model using [ForecastLab Plugin SDK](https://github.com/coffeetocoffee/forecastlab#plugins)
4. Write comprehensive tests and documentation
5. Run local benchmarks against standard datasets
6. Submit pull request with performance comparison
7. Address reviewer feedback
8. Merge and publish to catalog

### Templates Available

- [`model-template`](./templates/basic/) - Simple constant prediction
- [`seasonal-template`](./templates/seasonal/) - With seasonality support
- [`advanced-template`](./templates/advanced/) - Full-featured model

### Checklist Before Submission

- [ ] Code passes ESLint/Prettier
- [ ] Unit tests written and passing
- [ ] Documentation complete (README, explanation, usage)
- [ ] Benchmarks run and documented
- [ ] Peer-reviewed by another user
- [ ] Manifest file properly formatted

---

## Citation

If you use a model from the ForecastLab Model Zoo in your research, please cite appropriately:

```bibtex
@software{forecastlab_model_zoo,
  title = {ForecastLab Model Zoo},
  author = {ForecastLab Community},
  year = {2026},
  url = {https://github.com/coffeetocoffee/forecastlab-models}
}
```

And cite the specific model authors when applicable.

---

## License

All models are distributed under MIT License unless otherwise specified. Individual models may have additional attribution requirements listed in their manifests.

---

## Contact & Support

- **Bug Reports**: GitHub Issues on main repository
- **Model Discussions**: GitHub Discussions
- **Community Chat**: Join our Discord server
- **Email**: models@forecastlab.org

---

*Last Updated: January 2026*  
*Total Models: 27 | Total Downloads: 15,432 | Active Contributors: 42*
