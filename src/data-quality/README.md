# ForecastLab Data Quality Engine v1.0

Comprehensive data detective capabilities for classical forecasting.

## 🎯 Features

### 1. **Anomaly Pattern Library**
Detects common anomalies with pattern classification:
- **Sudden shifts (step changes)** - CUSUM algorithm
- **Seasonality breaks** - STL decomposition comparison
- **Gradual drifts** - Trend analysis over rolling windows
- **Outlier clusters** - Batch error detection
- **Extreme outliers** - Z-score, IQR, and Isolation Forest methods

### 2. **Automatic Imputation Strategies**
Four proven methods with trade-off explanations:

| Method | Best For | Preserves |
|--------|----------|-----------|
| `linear` | Small scattered holes | Local trends |
| `seasonal` | Periodic patterns | Seasonality |
| `neighbor_avg` | Quick smoothing | Local behavior |
| `model_based` | Complex patterns | Statistical structure |

Each method includes detailed logs of what was imputed.

### 3. **Source Attribution Intelligence**
Identifies likely root causes of data issues:

**Sensor/System Failures:**
- Missing block identification
- Pattern breakage detection

**Human Errors:**
- Excessive rounding detection
- Unit mismatch signatures
- Boundary value manipulation patterns

**Seasonal Events:**
- Holiday flags
- Maintenance windows
- Calendar disruptions

### 4. **Data Provenance Tracking**
Complete audit trail for transparency:
- Every operation logged with timestamp
- Before/after values recorded
- Imputation history saved
- Rollback capability (planned)

## 📦 Installation & Usage

### Basic Check
```bash
forecastlab check path/to/data.csv
```

### Detailed Analysis with Auto-Fix
```bash
forecastlab check path/to/data.csv --detailed --auto-fix --fix-method model_based
```

### JSON Output
```bash
forecastlab check path/to/data.csv --json > quality-report.json
```

## 🔧 CLI Commands

```bash
forecastlab check <path> [options]

Options:
  --detailed        Show detailed diagnostic report
  --auto-fix       Apply automatic imputation for minor issues
  --fix-method     Choose imputation method (linear|seasonal|model_based)
  --json           Output as JSON format
```

## 💻 Programmatic API

### Quick Check
```javascript
import { checkDataQuality } from './src/data-quality/data-engine.js';

const data = [{ date: '2024-01-01', value: 100 }, ...];
const report = await checkDataQuality(data);

console.log(report.summary.overallHealth); // 85.7
console.log(report.recommendations); // Array of suggestions
```

### Full Engine Access
```javascript
import { DataQualityEngine } from './src/data-quality/data-engine.js';

const engine = new DataQualityEngine();

// Analyze data
const report = await engine.analyze(data, {});

// Impute missing values using specific method
const result = engine.imputeMissing(data, 'seasonal', { period: 7 });

// Export full report
const jsonReport = engine.exportQualityReport('json');

// View provenance log
const log = engine.getProvenanceLog();
```

## 📊 Report Structure

```javascript
{
  summary: {
    totalIssues: 5,
    critical: 2,
    warnings: 3,
    overallHealth: 78.3,
    dataReady: false
  },
  anomalies: {
    detectedCount: 3,
    confidenceLevels: { high: 1, medium: 1, low: 1 },
    anomalies: [...]
  },
  missingData: {
    totalMissing: 8,
    gapCount: 2,
    coveragePercent: 92.5,
    gaps: [...]
  },
  trendAnalysis: {
    significantShifts: [...],
    hasMajorShift: true
  },
  seasonalityAnalysis: {
    breaksDetected: true,
    seasonalStability: "unstable"
  },
  recommendations: [
    {
      title: "Address Detected Anomalies",
      priority: "high",
      options: [...]
    }
  ],
  provenanceId: "pq-1704123456-abc123"
}
```

## 🎨 Implementation Philosophy

This module follows ForecastLab's core principles:

✅ **Transparency**: Every detection and decision is explainable  
✅ **Local-First**: All processing happens on your machine  
✅ **Explainable**: Clear reasons why each issue was flagged  
✅ **Accessible**: No statistics PhD required to interpret results  
✅ **Extensible**: Easy to add new detection algorithms  

## 🚀 Example Usage

See `example.js` for complete working examples:

```bash
node src/data-quality/example.js
```

Outputs:
- Health score calculation
- Anomaly detection breakdown
- Imputation method comparisons
- Full report generation

## 🔄 Next Steps (Roadmap)

- [ ] Snapshot-based rollback functionality
- [ ] Multi-series correlation analysis
- [ ] Automated root cause suggestion
- [ ] Integration with forecasting pipeline
- [ ] Webhook alerts for real-time systems

## 📝 License

MIT - Same as ForecastLab core project

---

*Built with ❤️ for transparent, trustworthy forecasting*
*v2.0.0-beta — Part of ForecastLab Data Quality Suite*
