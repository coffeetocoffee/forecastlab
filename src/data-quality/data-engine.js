/**
 * ForecastLab Data Quality Engine v1.0
 * Comprehensive data detective capabilities for classical forecasting
 * 
 * Features:
 * - Anomaly pattern library
 * - Automatic imputation strategies
 * - Source attribution intelligence
 * - Data provenance tracking
 */

/**
 * DataQualityEngine - Main class for comprehensive data analysis
 */
export class DataQualityEngine {
  constructor() {
    this.anomalies = [];
    this.imputations = [];
    this.provenanceLog = [];
    this.qualityReport = null;
  }

  /**
   * Run comprehensive quality check on time series data
   * @param {Array} data - Array of {date, value} objects
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Quality report
   */
  async analyze(data, options = {}) {
    this.provenanceLog.push({
      timestamp: new Date().toISOString(),
      action: 'analysis_started',
      dataPoints: data.length,
      missing: data.filter(d => d.value === null || d.value === undefined).length
    });

    // Run all quality checks
    const results = await Promise.all([
      this.checkMissingValues(data),
      this.detectAnomalies(data, options),
      this.detectTrendShifts(data),
      this.detectSeasonalityBreaks(data),
      this.identifyHumanErrors(data),
      this.checkOutlierClusters(data),
      this.assessStationarity(data)
    ]);

    // Compile comprehensive report
    this.qualityReport = {
      summary: this.generateSummary(results),
      anomalies: results[1],
      missingData: results[0],
      trendAnalysis: results[2],
      seasonalityAnalysis: results[3],
      errorPatterns: results[4],
      outlierAnalysis: results[5],
      stationarityTest: results[6],
      recommendations: this.generateRecommendations(results),
      provenanceId: this.generateProvenanceId()
    };

    this.provenanceLog.push({
      timestamp: new Date().toISOString(),
      action: 'analysis_completed',
      issuesFound: this.countIssues(),
      severity: this.calculateSeverity()
    });

    return this.qualityReport;
  }

  /**
   * Detect missing values and gaps
   */
  checkMissingValues(data) {
    const gaps = [];
    let currentGap = null;

    for (let i = 0; i < data.length; i++) {
      if (data[i].value === null || data[i].value === undefined) {
        if (!currentGap) {
          currentGap = { start: i, end: i, type: 'single' };
        } else {
          currentGap.end = i;
        }
      } else {
        if (currentGap) {
          gaps.push(this.formatGap(currentGap, data));
          currentGap = null;
        }
      }
    }
    if (currentGap) {
      gaps.push(this.formatGap(currentGap, data));
    }

    return {
      totalMissing: data.filter(d => d.value === null || d.value === undefined).length,
      gapCount: gaps.length,
      gaps,
      coveragePercent: ((data.length - data.filter(d => d.value === null || d.value === undefined).length) / data.length * 100).toFixed(2)
    };
  }

  formatGap(gap, data) {
    const startDate = data[gap.start]?.date;
    const endDate = data[gap.end]?.date;
    const duration = gap.end - gap.start + 1;
    
    // Determine gap type
    if (duration <= 2) {
      return { ...gap, startDate, endDate, duration, type: 'scattered_hole' };
    } else {
      return { ...gap, startDate, endDate, duration, type: 'complete_time_gap' };
    }
  }

  /**
   * Detect anomalies using multiple methods
   */
  async detectAnomalies(data, options) {
    const zScoreMethod = this.detectViaZScore(data);
    const iqrMethod = this.detectViaIQR(data);
    const isolationForest = this.detectViaIsolationForest(data);
    
    // Combine results and rank by severity
    const allAnomalies = [
      ...zScoreMethod,
      ...iqrMethod.map(a => ({ ...a, method: 'IQR' })),
      ...isolationForest.map(a => ({ ...a, method: 'Isolation Forest' }))
    ];

    // Deduplicate overlapping detections
    const uniqueAnomalies = this.deduplicateAnomalies(allAnomalies);

    // Add pattern classification
    const classified = uniqueAnomalies.map(anom => ({
      ...anom,
      patternType: this.classifyAnomalyPattern(anom, data)
    }));

    return {
      detectedCount: classified.length,
      confidenceLevels: this.groupByConfidence(classified),
      anomalies: classified,
      methodsUsed: ['Z-Score', 'IQR', 'Isolation Forest']
    };
  }

  detectViaZScore(data) {
    const threshold = 2.5;
    const mean = this.mean(data);
    const std = this.std(data);
    const stdSafe = std > 0 ? std : 1;
    
    return data
      .map((point, idx) => ({
        index: idx,
        value: point.value,
        date: point.date,
        zScore: Math.abs((point.value - mean) / stdSafe),
        confidence: this.zScoreToConfidence(Math.abs((point.value - mean) / stdSafe))
      }))
      .filter(p => p.zScore > threshold && p.value !== null && p.value !== undefined);
  }

  detectViaIQR(data) {
    const validValues = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    const sorted = [...validValues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return data
      .map((point, idx) => ({
        index: idx,
        value: point.value,
        date: point.date,
        distance: point.value < lowerBound ? lowerBound - point.value : 
                  point.value > upperBound ? point.value - upperBound : 0,
        confidence: this.distanceToConfidence(Math.max(0, point.value < lowerBound ? lowerBound - point.value : 
                                                           point.value > upperBound ? point.value - upperBound : 0), iqr)
      }))
      .filter(p => p.distance > 0 && p.value !== null && p.value !== undefined);
  }

  detectViaIsolationForest(data) {
    const nTrees = 30;
    const sampleSize = Math.min(32, data.length);
    
    const scores = data.map((_, idx) => this.calcIsolationScore(data, idx, sampleSize, nTrees));
    
    return data
      .map((point, idx) => ({
        index: idx,
        value: point.value,
        date: point.date,
        isolationScore: scores[idx],
        confidence: Math.min(0.95, scores[idx] / 5)
      }))
      .filter(p => p.isolationScore > 3 && p.value !== null && p.value !== undefined);
  }

  calcIsolationScore(data, pointIdx, sampleSize, nTrees) {
    let totalPathLength = 0;
    
    for (let t = 0; t < nTrees; t++) {
      const sample = this.randomSample(data, sampleSize);
      const pathLength = this.pathLengthInTree(sample, data[pointIdx]);
      totalPathLength += pathLength;
    }
    
    return totalPathLength / nTrees;
  }

  randomSample(data, size) {
    const shuffled = [...data].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
  }

  pathLengthInTree(sample, targetPoint) {
    if (sample.length === 1) return 0;
    
    const midValue = sample[sample.length >> 1].value;
    
    if (targetPoint.value < sample[0].value || targetPoint.value > sample[sample.length-1].value) {
      return sample.length + 1;
    }
    
    const splitIndex = sample.findIndex(p => p.value > targetPoint.value);
    if (splitIndex === -1) return sample.length + 1;
    
    const side = targetPoint.value < midValue ? sample.slice(0, splitIndex) : sample.slice(splitIndex);
    return 1 + (side.length > 1 ? this.pathLengthInTree(side, targetPoint) : 0);
  }

  deduplicateAnomalies(anomalies) {
    const processed = new Set();
    const unique = [];
    
    anomalies.forEach(anom => {
      const key = `${Math.round(anom.index)}_${Math.round(anom.value)}`;
      if (!processed.has(key)) {
        processed.add(key);
        unique.push(anom);
      }
    });
    
    return unique;
  }

  classifyAnomalyPattern(anomaly, data) {
    const windowSize = 5;
    const beforeStart = Math.max(0, anomaly.index - windowSize);
    const afterEnd = Math.min(data.length, anomaly.index + windowSize + 1);
    
    const beforeTrend = this.calculateLocalTrend(data.slice(beforeStart, anomaly.index));
    const afterTrend = this.calculateLocalTrend(data.slice(anomaly.index + 1, afterEnd));
    
    if (beforeTrend === 0 && afterTrend === 0) {
      return 'isolated_spike';
    } else if (beforeTrend !== afterTrend) {
      return 'trend_reversal';
    } else if (Math.abs(anomaly.zScore || anomaly.distance || anomaly.isolationScore) > 3) {
      return 'extreme_outlier';
    } else {
      return 'moderate_deviation';
    }
  }

  calculateLocalTrend(points) {
    if (points.length < 2) return 0;
    const vals = points.map(p => p.value);
    const sumX = vals.reduce((sum, _, i) => sum + i, 0);
    const sumY = vals.reduce((sum, v) => sum + v, 0);
    const sumXY = vals.reduce((sum, v, i) => sum + i * v, 0);
    const sumXX = vals.reduce((sum, _, i) => sum + i * i, 0);
    
    const n = vals.length;
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope || 0;
  }

  groupByConfidence(anomalies) {
    return {
      high: anomalies.filter(a => (a.confidence || 0) >= 0.8).length,
      medium: anomalies.filter(a => (a.confidence || 0) >= 0.5 && (a.confidence || 0) < 0.8).length,
      low: anomalies.filter(a => (a.confidence || 0) < 0.5).length
    };
  }

  /**
   * Detect sudden trend shifts (step changes)
   */
  detectTrendShifts(data) {
    const minSegmentSize = Math.max(5, Math.floor(data.length / 10));
    const shifts = [];
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    
    if (values.length < minSegmentSize * 3) return { shiftCount: 0, significantShifts: [], hasMajorShift: false };
    
    for (let i = minSegmentSize; i < data.length - minSegmentSize; i++) {
      const prevSlice = data.slice(i - minSegmentSize, i);
      const nextSlice = data.slice(i, i + minSegmentSize);
      
      const prevMean = this.mean(prevSlice);
      const nextMean = this.mean(nextSlice);
      const std = this.std(data);
      const stdSafe = std > 0 ? std : 1;
      
      if (Math.abs(nextMean - prevMean) > stdSafe * 0.5) {
        shifts.push({
          index: i,
          date: data[i].date,
          prevMean,
          nextMean,
          magnitude: nextMean - prevMean,
          significant: Math.abs(nextMean - prevMean) > stdSafe * 0.3
        });
      }
    }
    
    return {
      shiftCount: shifts.length,
      significantShifts: shifts.filter(s => s.significant),
      detectedAt: shifts.map(s => s.date),
      hasMajorShift: shifts.some(s => s.significant)
    };
  }

  /**
   * Detect seasonality breaks
   */
  detectSeasonalityBreaks(data) {
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    const period = 7; // Assume weekly
    
    if (values.length < period * 2) {
      return {
        breaksDetected: false,
        seasonalStability: 'insufficient_data'
      };
    }
    
    const seasons = [];
    for (let i = 0; i < Math.floor(values.length / period); i++) {
      seasons.push(values.slice(i * period, (i + 1) * period));
    }
    
    const breakScores = [];
    for (let i = 1; i < seasons.length; i++) {
      const corr = this.correlationArray(seasons[i-1], seasons[i]);
      if (corr < 0.7) {
        breakScores.push({
          period: i,
          correlation: corr.toFixed(3)
        });
      }
    }
    
    return {
      breaksDetected: breakScores.length > 0,
      breakScores,
      seasonalStability: breakScores.length === 0 ? 'stable' : 'unstable'
    };
  }
  
  correlationArray(arr1, arr2) {
    const n = Math.min(arr1.length, arr2.length);
    if (n === 0) return 1;
    
    const mean1 = arr1.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const mean2 = arr2.slice(0, n).reduce((s, v) => s + v, 0) / n;
    
    const num = arr1.slice(0, n).reduce((sum, v, i) => sum + (v - mean1) * (arr2[i] - mean2), 0);
    const den1 = Math.sqrt(arr1.slice(0, n).reduce((sum, v) => sum + (v - mean1) ** 2, 0));
    const den2 = Math.sqrt(arr2.slice(0, n).reduce((sum, v) => sum + (v - mean2) ** 2, 0));
    
    return den1 && den2 ? num / (den1 * den2) : 1;
  }

  /**
   * Identify human errors (rounding, unit mismatches, etc.)
   */
  identifyHumanErrors(data) {
    const errors = [];
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    
    // Check for excessive rounding
    const decimals = data.map(p => this.countDecimals(p.value)).filter(d => d > 0);
    const mostCommonDecimal = decimals.length > 0 ? this.mode(decimals) : 2;
    
    if (mostCommonDecimal <= 1) {
      errors.push({
        type: 'excessive_rounding',
        description: `Most values have ${mostCommonDecimal} decimal places`,
        severity: mostCommonDecimal === 0 ? 'high' : 'medium'
      });
    }
    
    // Check for unit mismatches (abrupt scale changes)
    const ratios = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i-1] > 0) {
        ratios.push(values[i] / values[i-1]);
      }
    }
    
    const extremeRatios = ratios.filter(r => r > 10 || r < 0.1);
    if (extremeRatios.length > 0) {
      errors.push({
        type: 'potential_unit_mismatch',
        count: extremeRatios.length,
        severity: 'high',
        description: `${extremeRatios.length} values show potential unit changes`
      });
    }
    
    // Check for suspiciously round numbers at boundaries
    const boundaryNumbers = data.filter(p => 
      p.value % 10 === 0 || p.value % 100 === 0
    );
    
    if (boundaryNumbers.length / data.length > 0.3) {
      errors.push({
        type: 'human_adjustment_pattern',
        percentage: (boundaryNumbers.length / data.length * 100).toFixed(1),
        severity: 'low',
        description: 'High proportion of rounded boundary values detected'
      });
    }
    
    return {
      totalErrors: errors.length,
      errors,
      humanManipulationLikely: errors.some(e => e.severity === 'high')
    };
  }

  countDecimals(value) {
    if (!value || value % 1 === 0) return 0;
    return value.toString().split('.')[1].length;
  }

  mode(values) {
    const freq = {};
    values.forEach(v => freq[v] = (freq[v] || 0) + 1);
    return Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);
  }

  /**
   * Detect outlier clusters (batch errors)
   */
  checkOutlierClusters(data) {
    const windowSize = 3;
    const clusters = [];
    let currentCluster = [];
    
    const mean = this.mean(data);
    const std = this.std(data);
    const stdSafe = std > 0 ? std : 1;
    
    const isOutlier = point => Math.abs(point.value - mean) > stdSafe * 2;
    
    for (let i = 0; i < data.length; i++) {
      if (isOutlier(data[i])) {
        currentCluster.push(i);
      } else {
        if (currentCluster.length >= 2) {
          clusters.push(this.formatCluster(currentCluster, data));
        }
        currentCluster = [];
      }
    }
    if (currentCluster.length >= 2) {
      clusters.push(this.formatCluster(currentCluster, data));
    }
    
    return {
      clusterCount: clusters.length,
      clusters,
      affectedPoints: clusters.reduce((sum, c) => sum + c.indices.length, 0),
      potentialBatchError: clusters.length > 0
    };
  }

  formatCluster(indices, data) {
    return {
      indices,
      startDate: data[indices[0]].date,
      endDate: data[indices[indices.length - 1]].date,
      avgValue: indices.reduce((sum, i) => sum + data[i].value, 0) / indices.length,
      reason: 'batch_error'
    };
  }

  /**
   * Assess stationarity (for model selection)
   */
  assessStationarity(data) {
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    const firstDiff = values.map((v, i) => i > 0 ? v - values[i-1] : 0);
    
    const meanOriginal = values.reduce((s, v) => s + v, 0) / values.length;
    const varianceOriginal = values.reduce((s, v) => s + (v - meanOriginal) ** 2, 0) / values.length;
    
    const meanDiff = firstDiff.reduce((s, v) => s + v, 0) / firstDiff.length;
    const varianceDiff = firstDiff.reduce((s, v) => s + (v - meanDiff) ** 2, 0) / firstDiff.length;
    
    const fStatistic = varianceOriginal / Math.max(varianceDiff, 0.001);
    
    return {
      isStationary: fStatistic < 2,
      fStatistic: fStatistic.toFixed(3),
      recommendation: fStatistic < 2 ? 'Use level-based models' : 'Consider differencing or log transform'
    };
  }

  // Helper methods
  mean(data) {
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  std(data) {
    const values = data.map(p => p.value).filter(v => v !== null && v !== undefined);
    if (values.length < 2) return 1;
    const m = this.mean(data);
    return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
  }

  generateSummary(results) {
    const issues = [];
    
    if (results[0].totalMissing > 0) {
      issues.push({ type: 'missing_data', impact: 'medium', severity: 'warning' });
    }
    
    if (results[1].detectedCount > 0) {
      issues.push({ type: 'anomalies', impact: 'high', severity: 'warning' });
    }
    
    if (results[2].significantShifts.length > 0) {
      issues.push({ type: 'trend_shifts', impact: 'high', severity: 'error' });
    }
    
    if (results[3].breaksDetected) {
      issues.push({ type: 'seasonality_breaks', impact: 'medium', severity: 'warning' });
    }
    
    if (results[4].totalErrors > 0) {
      issues.push({ type: 'human_errors', impact: 'medium', severity: 'warning' });
    }
    
    if (results[5].clusterCount > 0) {
      issues.push({ type: 'outlier_clusters', impact: 'high', severity: 'error' });
    }

    return {
      totalIssues: issues.length,
      critical: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      overallHealth: this.calculateHealthScore(issues),
      dataReady: issues.every(i => i.severity === 'warning')
    };
  }

  calculateHealthScore(issues) {
    const weights = { critical: 3, error: 3, warning: 1, info: 0.5 };
    const score = issues.reduce((acc, i) => acc + weights[i.severity], 0);
    const maxScore = issues.length * 3;
    return maxScore > 0 ? ((maxScore - score) / maxScore * 100).toFixed(1) : 100;
  }

  countIssues() {
    if (!this.qualityReport) return 0;
    return this.qualityReport.summary.totalIssues;
  }

  calculateSeverity() {
    if (!this.qualityReport) return 'ok';
    const { critical } = this.qualityReport.summary;
    return critical === 0 ? 'warning' : 'critical';
  }

  generateRecommendations(results) {
    const recs = [];
    
    // Missing data recommendations
    if (results[0].totalMissing > 0) {
      const gapCount = results[0].gaps.filter(g => g.type === 'complete_time_gap').length;
      recs.push({
        category: 'imputation',
        priority: gapCount > 0 ? 'high' : 'medium',
        title: 'Handle Missing Values',
        description: `${results[0].totalMissing} missing values found in ${results[0].gaps.length} gaps. Choose imputation strategy:`,
        options: [
          { id: 'linear', name: 'Linear Interpolation', useCase: 'Small scattered holes, preserves trends' },
          { id: 'seasonal', name: 'Seasonal Averaging', useCase: 'When seasonality is stable' },
          { id: 'model_based', name: 'Model-Based Fill', useCase: 'Complex patterns, better accuracy' }
        ],
        automaticSuggestion: gapCount === 0 ? 'linear' : 'model_based'
      });
    }
    
    // Anomaly handling recommendations
    if (results[1].detectedCount > 0) {
      const highConf = results[1].confidenceLevels.high;
      recs.push({
        category: 'outlier_handling',
        priority: highConf > 0 ? 'high' : 'medium',
        title: 'Address Detected Anomalies',
        description: `${results[1].detectedCount} anomalies detected (${highConf} high confidence). Consider:`,
        options: [
          { id: 'remove', name: 'Exclude from Training', useCase: 'If caused by measurement error' },
          { id: 'winsorize', name: 'Winsorize Values', useCase: 'Keep but reduce extreme influence' },
          { id: 'investigate', name: 'Manual Review First', useCase: 'Before deciding treatment' }
        ]
      });
    }
    
    // Trend shift recommendations
    if (results[2].significantShifts.length > 0) {
      recs.push({
        category: 'structural_change',
        priority: 'high',
        title: 'Structural Breaks Detected',
        description: `${results[2].significantShifts.length} major trend shifts found. Model should account for:`,
        options: [
          { id: 'regime_switching', name: 'Regime-Specific Models', useCase: 'Different parameters per regime' },
          { id: 'dummy_variables', name: 'Shift Dummy Variables', useCase: 'Add intercept adjustments' },
          { id: 'segment_model', name: 'Segment Modeling', useCase: 'Model each regime separately' }
        ]
      });
    }
    
    // Human error recommendations
    if (results[4].humanManipulationLikely) {
      recs.push({
        category: 'data_integrity',
        priority: 'high',
        title: 'Data Integrity Issues',
        description: 'Potential human intervention detected. Verify source systems and entry procedures.',
        actions: [
          'Cross-check with source systems',
          'Review change audit trail',
          'Implement validation rules for future entries'
        ]
      });
    }

    return recs;
  }

  /**
   * Impute missing values using selected method
   */
  imputeMissing(data, method, options = {}) {
    this.provenanceLog.push({
      timestamp: new Date().toISOString(),
      action: 'imputation_start',
      method,
      count: data.filter(d => d.value === null || d.value === undefined).length
    });

    const imputed = [...data];
    const imputationHistory = [];

    switch (method) {
      case 'linear':
        imputed.forEach((point, i) => {
          if (point.value === null || point.value === undefined) {
            let left = i - 1 >= 0 ? data[i - 1].value : null;
            let right = i + 1 < data.length ? data[i + 1].value : null;
            
            // Find nearest non-null values
            while (left === null && i - 1 >= 0) {
              left = data[--i - 1].value;
            }
            while (right === null && i + 1 < data.length) {
              right = data[++i + 1].value;
            }
            
            if (left !== null && right !== null) {
              const newVal = (left + right) / 2;
              imputed[i] = { ...point, value: newVal };
              imputationHistory.push({ index: i, method: 'linear', original: null, imputed: newVal });
            }
          }
        });
        break;

      case 'seasonal':
        const seasonalMean = this.calculateSeasonalMean(data, options.period || 7);
        imputed.forEach((point, i) => {
          if (point.value === null || point.value === undefined) {
            const dayOfWeek = this.getDayOfWeekIndex(point.date, options.period || 7);
            const replacement = seasonalMean[dayOfWeek] || this.mean(data);
            imputed[i] = { ...point, value: replacement };
            imputationHistory.push({ index: i, method: 'seasonal', periodDay: dayOfWeek, imputed: replacement });
          }
        });
        break;

      case 'neighbor_avg':
        imputed.forEach((point, i) => {
          if (point.value === null || point.value === undefined) {
            const neighbors = this.getNeighbors(data, i, options.window || 3);
            if (neighbors.length > 0) {
              const avg = neighbors.reduce((s, v) => s + v, 0) / neighbors.length;
              imputed[i] = { ...point, value: avg };
              imputationHistory.push({ index: i, method: 'neighbor_avg', neighbors: neighbors.length, imputed: avg });
            }
          }
        });
        break;

      case 'model_based':
        const recentMean = this.mean(data.slice(-10));
        imputed.forEach((point, i) => {
          if (point.value === null || point.value === undefined) {
            imputed[i] = { ...point, value: recentMean };
            imputationHistory.push({ index: i, method: 'model_based', imputed: recentMean });
          }
        });
        break;

      default:
        throw new Error(`Unknown imputation method: ${method}`);
    }

    this.provenanceLog.push({
      timestamp: new Date().toISOString(),
      action: 'imputation_complete',
      method,
      imputationsMade: imputationHistory.length,
      history: imputationHistory
    });

    return {
      data: imputed,
      history: imputationHistory,
      metadata: {
        method,
        count: imputationHistory.length,
        originalMissing: data.filter(v => v.value === null || v.value === undefined).length
      }
    };
  }

  calculateSeasonalMean(data, period) {
    const sums = new Array(period).fill(0);
    const counts = new Array(period).fill(0);
    
    data.forEach((point, i) => {
      if (point.value !== null && point.value !== undefined) {
        const idx = i % period;
        sums[idx] += point.value;
        counts[idx]++;
      }
    });
    
    return sums.map((sum, i) => counts[i] > 0 ? sum / counts[i] : 0);
  }

  getDayOfWeekIndex(dateStr, period) {
    const date = new Date(dateStr);
    return date.getDay();
  }

  getNeighbors(data, idx, window) {
    const neighbors = [];
    for (let i = 1; i <= window; i++) {
      if (idx - i >= 0 && data[idx - i].value !== null && data[idx - i].value !== undefined) {
        neighbors.push(data[idx - i].value);
      }
      if (idx + i < data.length && data[idx + i].value !== null && data[idx + i].value !== undefined) {
        neighbors.push(data[idx + i].value);
      }
    }
    return neighbors;
  }

  zScoreToConfidence(z) {
    return Math.min(0.95, Math.exp(-2 / z));
  }

  distanceToConfidence(dist, iqr) {
    const normalized = dist / Math.max(iqr, 1);
    return Math.min(0.95, normalized / 2);
  }

  /**
   * Provenance tracking utilities
   */
  generateProvenanceId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `pq-${timestamp}-${random}`;
  }

  getProvenanceLog() {
    return this.provenanceLog;
  }

  exportQualityReport(format = 'json') {
    if (!this.qualityReport) {
      return { error: 'No analysis performed yet' };
    }

    const report = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      ...this.qualityReport
    };

    return format === 'json' ? JSON.stringify(report, null, 2) : report;
  }
}

/**
 * Utility function for easy access
 */
export function checkDataQuality(data, options = {}) {
  const engine = new DataQualityEngine();
  return engine.analyze(data, options);
}

export default DataQualityEngine;
