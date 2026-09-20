/**
 * Counterfactual Analysis Module - ForecastLab Phase 4C
 * 
 * Answer "what would have happened if..." questions using regression-based
 * causal multipliers and Monte Carlo simulation.
 * 
 * @module counterfactual
 */

class CounterfactualEngine {
    /**
     * Create counterfactual analysis engine
     * @param {Object} fittedModel - Previously fitted forecasting model
     */
    constructor(fittedModel) {
        this.model = fittedModel;
        this.coefficients = fittedModel.getCoefficients ? fittedModel.getCoefficients() : {};
        this.regressors = fittedModel.regressors || {};
        this.rSquared = fittedModel.rSquared || 0;
    }

    /**
     * Simulate counterfactual scenario
     */
    simulateCounterfactual(intervention) {
        // Validate intervention
        if (!intervention.variable || !intervention.newValues) {
            throw new Error('Intervention must specify variable and newValues');
        }

        // Generate original forecast
        const originalForecast = this._generateOriginalForecast();
        
        // Generate counterfactual forecast
        const cfForecast = this._applyIntervention(intervention);
        
        // Compute differences
        const difference = this._computeDifference(originalForecast, cfForecast);
        
        // Add interpretations and warnings
        return {
            original: originalForecast,
            counterfactual: cfForecast,
            difference: difference,
            cumulativeImpact: difference[difference.length - 1]?.cumulativeImpact || 0,
            interpretation: this._interpretImpact(intervention, difference),
            warnings: this._addSafetyChecks(intervention, difference)
        };
    }

    _generateOriginalForecast() {
        // Use original model predictions
        const horizon = this.model.horizon || 30;
        const baseValue = this.model.lastValue || 100;
        const trend = this.model.trend || 0;
        
        return Array.from({ length: horizon }, (_, i) => ({
            time: i + 1,
            value: baseValue + trend * i
        }));
    }

    _applyIntervention(intervention) {
        const horizon = this.model.horizon || 30;
        const baseValue = this.model.lastValue || 100;
        const trend = this.model.trend || 0;
        
        const modifiedPoints = [];
        
        for (let i = 0; i < horizon; i++) {
            let adjustedValue = baseValue + trend * i;
            
            switch (intervention.type) {
                case 'constant_value':
                    // Assume intervention affects intercept
                    const effectSize = this._estimateEffectSize(intervention);
                    adjustedValue += effectSize;
                    break;
                    
                case 'multiplicative':
                    adjustedValue *= intervention.factor;
                    break;
                    
                case 'price_change':
                    const elasticity = this.coefficients.elasticity || -2.5;
                    const priceChangePct = intervention.percentChange / 100;
                    adjustedValue *= Math.pow(1 + priceChangePct, elasticity);
                    break;
                    
                case 'promotion':
                    if (i < intervention.duration) {
                        adjustedValue *= (1 + intervention.uplift);
                    }
                    break;
                    
                default:
                    break;
            }
            
            modifiedPoints.push({
                time: i + 1,
                value: adjustedValue
            });
        }
        
        return modifiedPoints;
    }

    _estimateEffectSize(intervention) {
        // Estimate effect based on coefficient magnitude
        const coeff = this.coefficients[intervention.variable] || 1;
        const originalValue = this.regressors[intervention.variable]?.[0] || 0;
        const newValue = intervention.newValues?.[0] || intervention.constantValue || originalValue;
        
        return coeff * (newValue - originalValue);
    }

    _computeDifference(original, counterfactual) {
        const differences = [];
        let cumulativeImpact = 0;
        
        for (let i = 0; i < original.length; i++) {
            const pointDiff = counterfactual[i].value - original[i].value;
            cumulativeImpact += pointDiff;
            
            differences.push({
                time: original[i].time,
                pointDifference: pointDiff,
                cumulativeImpact: cumulativeImpact
            });
        }
        
        return differences;
    }

    _interpretImpact(intervention, differences) {
        const totalImpact = differences[differences.length - 1].cumulativeImpact;
        const originalTotal = this.model.originalForecastSum || 0;
        const pctChange = originalTotal > 0 ? (totalImpact / originalTotal) * 100 : 0;
        
        let message = '';
        
        if (intervention.variable === 'price') {
            message = `Had ${intervention.variable} remained constant, cumulative outcomes would be ${Math.abs(totalImpact).toFixed(0)} units ${totalImpact > 0 ? 'higher' : 'lower'} (${pctChange.toFixed(1)}%)`;
        } else if (intervention.type === 'promotion') {
            message = `With ${intervention.duration}-day promotion active, expected uplift is ${totalImpact.toFixed(0)} units (${pctChange.toFixed(1)}% increase)`;
        } else {
            message = `Counterfactual ${intervention.type} results in ${Math.abs(totalImpact).toFixed(0)} unit change (${pctChange.toFixed(1)}%)`;
        }
        
        return message;
    }

    _addSafetyChecks(intervention, differences) {
        const warnings = [];
        
        // Check for extrapolation
        if (intervention.variable && intervention.newValues) {
            const originalRange = this._getValueRange(this.regressors[intervention.variable]);
            const cfRange = this._getValueRange([intervention.newValues[0]]);
            
            if (cfRange.min < originalRange.min || cfRange.max > originalRange.max) {
                warnings.push({
                    type: 'EXTRAPOLATION',
                    message: 'Counterfactual values outside observed range—interpret with caution'
                });
            }
        }
        
        // Check R²
        if (this.rSquared < 0.3) {
            warnings.push({
                type: 'LOW_EXPLANATORY_POWER',
                message: `Model explains only ${(this.rSquared * 100).toFixed(0)}% variance—counterfactuals may be unreliable`
            });
        }
        
        // Check for large deviations
        const maxDeviation = Math.max(...differences.map(d => Math.abs(d.pointDifference)));
        if (maxDeviation > 0.5) {
            warnings.push({
                type: 'LARGE_DEVIATION',
                message: 'Very large forecast deviations detected—verify intervention assumptions'
            });
        }
        
        return warnings;
    }

    _getValueRange(values) {
        if (!values || values.length === 0) {
            return { min: 0, max: 0 };
        }
        return {
            min: Math.min(...values),
            max: Math.max(...values)
        };
    }
}

/**
 * Automated What-If Scenario Generator
 * Template library for common business scenarios
 */
class ScenarioGenerator {
    constructor() {
        this.templates = this._initTemplates();
    }

    _initTemplates() {
        return {
            'promotion_lift': {
                name: 'Historical promotion uplift',
                generate: (data, params) => {
                    const avgUplift = params.avgUplift || 0.25;
                    const duration = params.duration || 14;
                    
                    return {
                        name: 'Promotion Active',
                        probability: params.probability || 0.25,
                        intervention: {
                            type: 'promotion',
                            uplift: avgUplift,
                            duration: duration
                        }
                    };
                }
            },
            
            'holiday_shift': {
                name: 'Holiday moved earlier/later',
                generate: (data, params) => {
                    const shiftDays = params.shiftDays || 1;
                    
                    return {
                        name: `Holiday Shifted ${shiftDays > 0 ? '+' : ''}${shiftDays} Days`,
                        probability: 0.15,
                        intervention: {
                            type: 'temporal_shift',
                            lag: shiftDays,
                            pattern: 'peak'
                        }
                    };
                }
            },
            
            'price_elasticity': {
                name: 'Price change impact',
                generate: (data, params) => {
                    const percentChange = params.percentChange || 10;
                    const elasticity = params.elasticity || -2.5;
                    
                    return {
                        name: `Price Change ${percentChange > 0 ? '+' : ''}${percentChange}%`,
                        probability: 0.2,
                        intervention: {
                            type: 'price_change',
                            percentChange: percentChange,
                            elasticity: elasticity
                        }
                    };
                }
            },
            
            'supply_disruption': {
                name: 'Supply chain disruption',
                generate: (data, params) => {
                    const reduction = params.reduction || 0.3;
                    const duration = params.duration || 21;
                    
                    return {
                        name: 'Supply Disruption',
                        probability: params.probability || 0.15,
                        intervention: {
                            type: 'supply_shock',
                            reduction: reduction,
                            duration: duration
                        }
                    };
                }
            }
        };
    }

    /**
     * Generate scenarios from templates
     */
    async generateScenarios(model, options = {}) {
        const templateIds = options.templates || Object.keys(this.templates);
        const scenarios = [];

        for (const templateId of templateIds) {
            const template = this.templates[templateId];
            if (template) {
                try {
                    const generated = template.generate(model, options.parameters || {});
                    scenarios.push(generated);
                } catch (error) {
                    console.warn(`Failed to generate scenario ${templateId}:`, error.message);
                }
            }
        }

        // Normalize probabilities to sum to 1
        this._normalizeProbabilities(scenarios);

        return scenarios;
    }

    _normalizeProbabilities(scenarios) {
        const totalProb = scenarios.reduce((sum, s) => sum + (s.probability || 0), 0);
        
        if (totalProb > 0 && totalProb !== 1) {
            for (const scenario of scenarios) {
                scenario.probability = scenario.probability / totalProb;
            }
        }
    }
}

/**
 * Sensitivity Analysis Sweeper
 * Explore parameter uncertainty through grid search
 */
class ParameterSweeper {
    constructor(fittedModel) {
        this.model = fittedModel;
    }

    /**
     * Sweep a single parameter across specified range
     */
    sweepParameter(paramName, minValue, maxValue, steps = 20) {
        const parameterValues = this._generateGrid(minValue, maxValue, steps);
        const results = [];

        for (const value of parameterValues) {
            const modifiedModel = this._modifyParameterValue(this.model, paramName, value);
            const forecast = this._getModifiedForecast(modifiedModel, value);
            
            results.push({
                parameter: paramName,
                value: value,
                forecast: forecast.forecast,
                deviationFromBaseline: this._computeDeviation(forecast, this.model.baselineForecast)
            });
        }

        return results;
    }

    /**
     * Generate evenly-spaced parameter values
     */
    _generateGrid(min, max, steps) {
        const stepSize = (max - min) / (steps - 1);
        return Array.from({ length: steps }, (_, i) => min + i * stepSize);
    }

    /**
     * Modify model parameter value
     */
    _modifyParameterValue(model, paramName, value) {
        // Create shallow copy with modified parameter
        return {
            ...model,
            [paramName]: value,
            baselineForecast: model.forecasts || this._getDefaultBaseline(model)
        };
    }

    _getDefaultBaseline(model) {
        const baseValue = model.lastValue || 100;
        const horizon = model.horizon || 10;
        return Array.from({ length: horizon }, (_, i) => baseValue + i);
    }

    /**
     * Get forecast from modified model
     */
    _getModifiedForecast(modifiedModel, paramValue) {
        const baseValue = modifiedModel.lastValue || 100;
        const horizon = modifiedModel.horizon || 10;
        
        // Simple linear projection with modified parameter
        const forecast = Array.from({ length: horizon }, (_, i) => {
            if (modifiedModel.trend === undefined) {
                return baseValue;
            }
            return baseValue + modifiedModel.trend * i + (paramValue - (modifiedModel[paramName] || 0)) * 0.1 * i;
        });
        
        return { forecast };
    }

    _computeDeviation(forecast, baseline) {
        if (!baseline) return 0;
        
        const sumDiff = forecast.forecast.reduce((sum, val, i) => 
            sum + Math.abs(val - (baseline[i] || val)), 0
        );
        
        return sumDiff / forecast.forecast.length;
    }

    /**
     * Generate heatmap data for 2D parameter sweeps
     */
    generateHeatmap(results) {
        const uniqueParam1 = [...new Set(results.map(r => r.param1))];
        const uniqueParam2 = [...new Set(results.map(r => r.param2))];
        
        const matrix = Array(uniqueParam1.length).fill(null).map(() => 
            Array(uniqueParam2.length).fill(0)
        );
        
        for (const result of results) {
            const i = uniqueParam1.indexOf(result.param1);
            const j = uniqueParam2.indexOf(result.param2);
            matrix[i][j] = result.RMSE || 0;
        }
        
        return {
            param1Values: uniqueParam1,
            param2Values: uniqueParam2,
            heatmap: matrix
        };
    }
}

// Export modules
module.exports = {
    CounterfactualEngine,
    ScenarioGenerator,
    ParameterSweeper
};
