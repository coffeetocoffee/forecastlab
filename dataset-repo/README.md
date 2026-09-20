# ForecastLab Dataset Repository
## Public Benchmark Datasets Collection

Welcome to the ForecastLab Dataset Repository! A curated collection of time-series datasets for testing, learning, and benchmarking forecasting methods.

---

## Quick Links

- **[Browse Datasets](./catalog/)** - Search by category, difficulty, patterns
- **[Submission Guidelines](../SUBMIT_DATASET.md)** - Contribute your own dataset
- **[Privacy Guide](../PRIVACY_GUIDE.md)** - How we protect sensitive data
- **[Benchmark Suite](../BENCHMARKS.md)** - Standard evaluation protocols

---

## Dataset Categories

### 🟢 Educational (Beginner)

Simple series designed for learning forecasting concepts.

| Dataset | Description | Points | Seasonality | Difficulty |
|---------|-------------|--------|-------------|------------|
| `linear-trend` | Straight line + noise | 200 | None | Easy |
| `seasonal-simple` | Single seasonal pattern | 365 | 7 (weekly) | Easy |
| `trend-seasonal` | Trend + single seasonality | 500 | 12 (monthly) | Medium |
| `level-level` | Constant with noise | 1000 | None | Easy |

**Use Case**: Learning basic forecasting concepts, tutorials

---

### 🟡 Business (Intermediate)

Real-world business scenarios with moderate complexity.

| Dataset | Description | Frequency | Pattern | Use Case |
|---------|-------------|-----------|---------|----------|
| `retail-daily` | Store sales | Daily | Weekly + Holiday | Retail forecasting |
| `web-traffic` | Page views | Hourly | Daily + Weekly | Web analytics |
| `energy-load` | Power demand | Hourly | Daily + Weekly | Utility planning |
| `inventory-slow` | Slow-moving items | Monthly | Irregular | Inventory mgmt |

**Use Case**: Mid-level forecasting challenges, portfolio building

---

### 🔴 Scientific (Advanced)

Research-grade datasets from scientific domains.

| Dataset | Domain | Resolution | Challenge |
|---------|--------|------------|-----------|
| `temperature-history` | Meteorology | Daily | Multi-year trends |
| `river-flow` | Hydrology | Hourly | Flood prediction |
| `population-demographics` | Demographics | Annual | Long-term trends |
| `ecological-population` | Biology | Monthly | Cyclic variations |

**Use Case**: Research validation, advanced method development

---

### ⚫ Challenging (Expert)

Edge cases that test forecasting robustness.

| Dataset | Challenge | Characteristics |
|---------|-----------|-----------------|
| `intermittent-demand` | Zero-inflated | 70% zeros, sporadic spikes |
| `structural-break-pandemic` | Regime shift | Pre/post COVID patterns |
| `multi-modal` | Distribution | Multiple peaks, non-normal |
| `hierarchical-tree` | Reconciliation | Parent-child relationships |

**Use Case**: Method stress-testing, production deployment readiness

---

## Dataset Schema

Each dataset includes standardized metadata:

```json
{
  "id": "retail-store-123",
  "name": "Retail Store #123 Sales",
  "description": "Daily sales including promotions and holidays",
  "source": "Anonymous retail partner",
  "license": "CC-BY-4.0",
  "frequency": "daily",
  "timezone": "America/New_York",
  "dateRange": {
    "start": "2020-01-01",
    "end": "2023-12-31"
  },
  "seasonality": [7],
  "numPoints": 1095,
  "columns": {
    "date": "YYYY-MM-DD",
    "value": "sales_amount"
  },
  "statistics": {
    "mean": 1234.5,
    "std": 456.7,
    "min": 123,
    "max": 5678,
    "missingPct": 0.5
  },
  "patterns": ["weekly-seasonality", "holiday-effect", "positive-trend"],
  "difficulty": "intermediate",
  "useCases": ["practice", "benchmark", "tutorial"],
  "fileSize": "45 KB"
}
```

---

## Download Formats

Datasets are available in multiple formats:

- **CSV** - Standard comma-separated values
- **JSON** - With metadata embedded
- **RData** - For R users
- **Parquet** - Efficient columnar format

### Quick Download

```bash
# Single dataset
curl -O https://datasets.forecastlab.org/retail-daily.csv

# Multiple datasets (batch)
cat catalog.json | jq '.[] | select(.difficulty=="beginner") | .download' \
  | xargs curl -O

# All educational datasets
curl -O https://datasets.forecastlab.org/educational.tar.gz
```

---

## Submission Guidelines

We welcome dataset contributions! Here's how:

### Privacy-Preserving Submission Process

1. **Local Anonymization**: Run `forecastlab anonymize --input raw.csv --output safe.csv`
2. **Pattern Verification**: Tool checks that original patterns are preserved
3. **Hash Generation**: SHA-256 hash ensures data integrity
4. **Submit Only Safe Version**: Original data stays local
5. **Optional Metadata**: Add context without exposing sensitive info

### What We Look For

✅ **Data Quality**: Minimal missing values, clean timestamps  
✅ **Relevance**: Real-world forecasting applications  
✅ **Documentation**: Clear description, source attribution  
✅ **License**: Permissive license (CC-BY, MIT, or public domain)  
✅ **Diversity**: Fill gaps in existing categories  

### Contribution Checklist

- [ ] Data anonymized using privacy tools
- [ ] Metadata schema completed
- [ ] Quality assessment passed
- [ ] License file included
- [ ] Example forecast report generated
- [ ] README with use case descriptions

---

## Benchmark Usage

### Standard Test Protocols

#### Protocol 1: Single Series Comparison
```bash
# Hold out last 20% for validation
forecastlab compare --dataset retail-daily --holdout 0.2

# Results show RMSE, MAE, MAPE for each method
```

#### Protocol 2: Cross-Dataset Analysis
```bash
# Compare methods across all beginner datasets
forecastlab benchmark --category educational

# Generates leaderboard table
```

#### Protocol 3: Hierarchical Reconciliation
```bash
# Test on hierarchical structure
forecastlab reconcile --dataset energy-hierarchy

# Bottom-up, top-down, and optimal combination results
```

### Published Benchmarks

- **M-Competition Replication**: Classic forecasting competition datasets
- **LightFM Benchmark**: Modern business series collection
- **Global Time Series Archive**: 500+ public datasets

---

## Statistics & Updates

### Current Repository Stats

- **Total Datasets**: 87
- **Educational**: 23
- **Business**: 34
- **Scientific**: 18
- **Challenging**: 12
- **Total Downloads**: 42,156
- **Contributors**: 31

### Update Schedule

- **Weekly**: New submissions processed
- **Monthly**: Performance benchmarks refreshed
- **Quarterly**: Category reorganization
- **Annually**: Major version updates

---

## API Access

### RESTful Endpoints

```bash
# List all datasets
GET /api/v1/datasets

# Filter by category
GET /api/v1/datasets?category=business&difficulty=intermediate

# Get dataset details
GET /api/v1/datasets/retail-daily

# Download file
GET /api/v1/datasets/retail-daily/download
```

### Node.js Client

```javascript
import { DatasetClient } from '@forecastlab/datasets';

const client = new DatasetClient();

// Fetch educational datasets
const datasets = await client.list({ category: 'educational' });

// Get download URL
const url = await client.getDownloadUrl('retail-daily', 'csv');
```

---

## Citation & Attribution

If you use datasets in research or publications:

```bibtex
@software{forecastlab_dataset_repo,
  title = {ForecastLab Dataset Repository},
  author = {ForecastLab Community},
  year = {2026},
  url = {https://github.com/coffeetocoffee/forecastlab-datasets}
}
```

Always cite both the repository and specific dataset authors when applicable.

---

## Contact & Support

- **Dataset Questions**: GitHub Issues → datasets folder
- **Submission Inquiries**: Submit PR with template
- **Bug Reports**: Report data issues or inconsistencies
- **Community Chat**: Discord #datasets channel

---

## Privacy Commitment

ForecastLab is committed to responsible data handling:

🔒 **No Personal Information**: All datasets anonymized before sharing  
🔒 **Local Processing**: Your original data never leaves your machine  
🔒 **Consent-Based**: All submissions include contributor permission  
🔒 **Transparent**: Full audit trail of data processing steps  

Learn more in our [Privacy Policy](../PRIVACY_POLICY.md).

---

*Last Updated: January 2026*  
*Repository Size: 156 MB | Total Series Length: 2.3M observations*
