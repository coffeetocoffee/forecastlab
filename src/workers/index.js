// Workers Index
export * from './worker-pool.js';

// Re-export Monte Carlo task from monte-carlo-worker for consistency
import { MonteCarloTask } from './worker-pool.js';
export { MonteCarloTask };
