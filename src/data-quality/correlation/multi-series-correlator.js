/**
 * Multi-Series Correlation Analyzer - v2.0
 * 
 * Features:
 * - Cross-correlation between multiple time series
 * - Lag-based correlation detection (for lead-lag relationships)
 * - Hierarchical reconciliation patterns
 * - Causal relationship suggestions
 */

export class MultiSeriesCorrelator {
  constructor() {
    this.seriesCache = new Map();
    this.correlations = new Map();
  }

  /**
   * Analyze correlations across multiple series
   * @param {Array} seriesData - Array of {name, data: [{date, value}]} objects
   * @param {Object} options - Configuration
   * @returns {Promise<Object>} Correlation matrix and insights
   */
  async analyze(seriesData, options = {}) {
    const {
      maxLags = 7,        // Maximum lags to check (positive/negative)
      minSignificance = 0.7,  // Minimum r-value for significance
      includeCausality = true // Include Granger-causality hints
    } = options;

    console.log(`📊 Analyzing ${seriesData.length} series...`);

    // Pre-compute statistics for each series
    const seriesStats = await this.prepareSeries(seriesData);

    // Compute full correlation matrix
    const correlationMatrix = await this.computeCorrelationMatrix(seriesStats, maxLags);

    // Find significant relationships
    const significantRelations = this.extractSignificantRelations(correlationMatrix, minSignificance);

    // Detect causal patterns (lead-lag relationships)
    let causalityInsights = [];
    if (includeCausality) {
      causalityInsights = await this.detectCausalPatterns(seriesData, maxLags);
    }

    // Identify hierarchical clusters
    const clusters = this.groupRelatedRelations(significantRelations);

    return {
      seriesCount: seriesData.length,
      totalPairs: Math.floor(seriesData.length * (seriesData.length - 1) / 2),
      significantPairs: significantRelations.length,
      correlationMatrix: this.formatMatrixForDisplay(correlationMatrix),
      significantRelations,
      causalityInsights,
      clusters,
      strongestPairs: significantRelations.slice(0, 5),
      summary: this.generateSummary(seriesData, significantRelations, causalityInsights)
    };
  }

  /**
   * Prepare series data with statistics
   */
  async prepareSeries(seriesData) {
    const prepared = [];

    for (const { name, data } of seriesData) {
      const values = data.map(d => d.value).filter(v => v !== null && v !== undefined);

      const mean = values.reduce((s, v) => s + v, 0) / values.length;

      const stats = {
        name,
        count: values.length,
        mean,
        std: this.std(values),
        variance: values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
      };

      this.seriesCache.set(name, { data, stats });
      prepared.push(stats);
    }

    return prepared;
  }

  /**
   * Compute pairwise correlations with lag support
   */
  async computeCorrelationMatrix(seriesList, maxLags) {
    const matrix = {};
    
    for (let i = 0; i < seriesList.length; i++) {
      const seriesA = seriesList[i];
      if (!matrix[seriesA.name]) {
        matrix[seriesA.name] = {};
      }
      
      matrix[seriesA.name][seriesA.name] = 1; // Self-correlation
      
      for (let j = i + 1; j < seriesList.length; j++) {
        const seriesB = seriesList[j];

        if (!matrix[seriesB.name]) {
          matrix[seriesB.name] = {};
        }

        // Zero-lag correlation
        const zeroLag = this.computeCorrelationAtLag(seriesA, seriesB, 0);
        matrix[seriesA.name][seriesB.name] = zeroLag.r;
        matrix[seriesB.name][seriesA.name] = zeroLag.r;
        
        // Store best lag correlation
        let bestLag = 0;
        let bestR = Math.abs(zeroLag.r);
        
        // Check positive and negative lags
        for (let lag = 1; lag <= maxLags; lag++) {
          const posLag = this.computeCorrelationAtLag(seriesA, seriesB, lag);
          const negLag = this.computeCorrelationAtLag(seriesA, seriesB, -lag);
          
          if (Math.abs(posLag.r) > bestR) {
            bestR = Math.abs(posLag.r);
            bestLag = lag;
            matrix[seriesA.name][`${seriesB.name}_lag_${lag}`] = posLag.r;
          }
          
          if (Math.abs(negLag.r) > bestR) {
            bestR = Math.abs(negLag.r);
            bestLag = -lag;
            matrix[seriesA.name][`${seriesB.name}_lag_${negLag}`] = negLag.r;
          }
        }
        
        // Store best lag metadata
        matrix[seriesA.name][`${seriesB.name}_best_lag`] = bestLag;
        matrix[seriesA.name][`${seriesB.name}_best_r`] = bestLag === 0 ? zeroLag.r : 
                                                         bestLag > 0 ? matrix[seriesA.name][`${seriesB.name}_lag_${bestLag}`] :
                                                                       matrix[seriesA.name][`${seriesB.name}_lag_${bestLag}`];
      }
    }
    
    return matrix;
  }

  /**
   * Compute correlation at specific lag
   */
  computeCorrelationAtLag(seriesA, seriesB, lag) {
    const cacheA = this.seriesCache.get(seriesA.name);
    const cacheB = this.seriesCache.get(seriesB.name);
    
    if (!cacheA || !cacheB) {
      return { r: 0, p_value: 1, n: 0 };
    }
    
    const dataA = cacheA.data;
    const dataB = cacheB.data;
    
    // Align by date first
    const aligned = this.alignByDate(dataA, dataB);
    
    if (aligned.count < 10) {
      return { r: 0, p_value: 1, n: aligned.count };
    }
    
    // Apply lag to series B
    const valuesA = aligned.a.map(p => p.value);
    const valuesB = lag > 0 
      ? aligned.b.slice(0, aligned.b.length - lag).map(p => p.value)
      : lag < 0
        ? aligned.b.slice(-lag).map(p => p.value)
        : aligned.b.map(p => p.value);
    
    const trimmedLength = Math.min(valuesA.length, valuesB.length);
    const validValuesA = valuesA.slice(0, trimmedLength);
    const validValuesB = valuesB.slice(0, trimmedLength);
    
    return this.computationPearson(validValuesA, validValuesB);
  }

  /**
   * Align two series by date
   */
  alignByDate(dataA, dataB) {
    const mapA = new Map(dataA.map(d => [d.date, d]));
    const commonPoints = [];
    
    for (const point of dataB) {
      if (mapA.has(point.date)) {
        commonPoints.push({
          a: mapA.get(point.date),
          b: point
        });
      }
    }
    
    return {
      count: commonPoints.length,
      a: commonPoints.map(p => p.a),
      b: commonPoints.map(p => p.b)
    };
  }

  /**
   * Pearson correlation coefficient
   */
  computationPearson(x, y) {
    const n = x.length;
    if (n === 0) return { r: 0, p_value: 1, n };
    
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    
    let num = 0, denX = 0, denY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    const denominator = Math.sqrt(denX * denY);
    const r = denominator > 0 ? num / denominator : 0;
    
    // Simple p-value approximation
    const tStat = r * Math.sqrt((n - 2) / (1 - r * r));
    const pValue = this.tToPValue(tStat, n - 2);
    
    return { r, p_value: pValue, n };
  }

  /**
   * Approximate p-value from t-statistic
   */
  tToPValue(t, df) {
    // Simplified approximation using normal distribution
    const z = t / Math.sqrt(df / (df - 2));
    return 2 * (1 - this.normCDF(Math.abs(z)));
  }

  normCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.319385 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  std(values) {
    if (values.length < 2) return 1;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  }

  /**
   * Extract significant correlations
   */
  extractSignificantRelations(matrix, threshold) {
    const relations = [];
    const seen = new Set();
    
    for (const [seriesA, correlates] of Object.entries(matrix)) {
      for (const [seriesB, r] of Object.entries(correlates)) {
        // Skip self-correlations and duplicates
        if (seriesA === seriesB || typeof r !== 'number' || r === 1) continue;
        if (seriesB.includes('best_lag') || seriesB.includes('_lag_')) continue;
        
        const pairKey = [seriesA, seriesB].sort().join('-');
        if (seen.has(pairKey)) continue;
        
        // Get lag info if available
        const lagInfo = correlates[`${seriesB}_best_lag`] || 0;
        const actualR = correlates[`${seriesB}_best_r`] || r;
        
        if (Math.abs(actualR) >= threshold) {
          relations.push({
            seriesA,
            seriesB,
            correlation: actualR.toFixed(3),
            lag: lagInfo,
            sign: actualR > 0 ? 'positive' : 'negative',
            strength: this.categorizeStrength(Math.abs(actualR)),
            timestamp: new Date().toISOString()
          });
          
          seen.add(pairKey);
        }
      }
    }
    
    return relations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  categorizeStrength(absR) {
    if (absR >= 0.8) return 'very_strong';
    if (absR >= 0.6) return 'strong';
    if (absR >= 0.4) return 'moderate';
    if (absR >= 0.2) return 'weak';
    return 'very_weak';
  }

  /**
   * Detect potential causal relationships
   */
  async detectCausalPatterns(seriesData, maxLags) {
    const insights = [];
    
    for (const { name, data } of seriesData) {
      const cache = this.seriesCache.get(name);
      if (!cache) continue;
      
      // Look for series that consistently lead others
      for (const [otherName, correlates] of Object.entries(this.correlations.get(name) || {})) {
        const bestLag = correlates.best_lag || 0;
        
        if (bestLag > 0) {
          insights.push({
            leadingSeries: name,
            laggingSeries: otherName,
            lag: bestLag,
            type: `${name} leads ${otherName} by ${bestLag} periods`,
            confidence: Math.abs(correlates.best_r) >= 0.7 ? 'high' : 'medium',
            hint: `Consider if changes in ${name} cause changes in ${otherName}`
          });
        }
      }
    }
    
    return insights.slice(0, 10); // Top 10 insights
  }

  /**
   * Group related series into clusters
   */
  groupRelatedRelations(relations) {
    const clusters = [];
    const visited = new Set();
    
    relations.forEach(rel => {
      if (visited.has(`${rel.seriesA}-${rel.seriesB}`)) return;
      
      const cluster = {
        members: [rel.seriesA, rel.seriesB],
        avgCorrelation: parseFloat(rel.correlation),
        relationship: `${rel.strength} (${rel.sign})`
      };
      
      visited.add(`${rel.seriesA}-${rel.seriesB}`);
      
      // Find connected series
      relations.forEach(otherRel => {
        if (cluster.members.includes(otherRel.seriesA) || cluster.members.includes(otherRel.seriesB)) {
          if (!cluster.members.includes(otherRel.seriesA)) {
            cluster.members.push(otherRel.seriesA);
          }
          if (!cluster.members.includes(otherRel.seriesB)) {
            cluster.members.push(otherRel.seriesB);
          }
        }
      });
      
      clusters.push(cluster);
    });
    
    return clusters;
  }

  formatMatrixForDisplay(matrix) {
    const simplified = {};
    
    for (const [seriesA, correlates] of Object.entries(matrix)) {
      simplified[seriesA] = {};
      for (const [seriesB, r] of Object.entries(correlates)) {
        if (typeof r === 'number' && r !== 1 && seriesB.endsWith('_best_r')) {
          simplified[seriesA][seriesB.replace('_best_r', '')] = r;
        } else if (typeof r === 'number' && seriesA !== seriesB && !seriesB.includes('best_lag') && !seriesB.includes('_lag_')) {
          simplified[seriesA][seriesB] = r;
        }
      }
    }
    
    return simplified;
  }

  generateSummary(seriesData, relations, causality) {
    const maxCorr = relations.length > 0 ? Math.max(...relations.map(r => Math.abs(parseFloat(r.correlation)))) : 0;
    
    return {
      insightLevel: maxCorr >= 0.8 ? 'high_interdependence' : maxCorr >= 0.5 ? 'moderate_relationships' : 'weak_correlations',
      topRelationship: relations[0],
      causalHints: causality.length,
      recommendation: this.generateRecommendation(maxCorr, causality.length)
    };
  }

  generateRecommendation(maxCorr, causalHints) {
    if (maxCorr >= 0.8 && causalHints > 0) {
      return 'Strong lead-lag detected. Consider forecasting one series first, then adjusting others.';
    }
    if (maxCorr >= 0.6) {
      return 'Moderate interdependence suggests joint modeling could improve accuracy.';
    }
    if (causalHints > 0) {
      return 'Some causal hints found. Run domain-specific validation.';
    }
    return 'Series appear relatively independent. Model separately unless business logic requires otherwise.';
  }
}

export default MultiSeriesCorrelator;
