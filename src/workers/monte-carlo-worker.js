// Worker script for parallel Monte Carlo simulations
// Runs individual MC paths in isolated Web Workers

import { WorkerPool, MonteCarloTask } from './worker-pool.js';

let pool = null;

if (typeof self !== 'undefined') {
  self.onmessage = function(event) {
  const { type, data } = event.data;
  
  if (type === 'init') {
    self.postMessage({ type: 'ready', workerId: data.id });
    
    // Initialize worker pool
    pool = new WorkerPool({
      size: Math.max(1, navigator.hardwareConcurrency),
      onTaskComplete: (result) => {
        self.postMessage({
          type: 'task_complete',
          taskId: result.taskId,
          data: {
            workerId: result.workerId,
            result: result.result
          }
        });
      },
      onProgressUpdate: (data) => {
        self.postMessage({
          type: 'progress',
          data: data
        });
      }
    });
    
    return;
  }
  
  if (type === 'execute') {
    try {
      const startTime = performance.now();
      
      // Create and execute Monte Carlo task
      const mcTask = new MonteCarloTask({
        baseValues: data.task.baseValues,
        horizon: data.task.horizon,
        numPaths: data.task.numPaths || 1000,
        volatility: data.task.volatility || 0.3,
        drift: data.task.drift || 0,
        method: data.task.method || 'ar1',
        onProgress: (current, total) => {
          if (data.options?.includeProgress !== false) {
            self.postMessage({
              type: 'progress',
              data: {
                current,
                total,
                percent: ((current / total) * 100).toFixed(1),
                workerId: data.workerId,
                taskId: data.taskId
              }
            });
          }
        }
      });
      
      const result = mcTask.execute();
      
      const endTime = performance.now();
      const durationMs = endTime - startTime;
      
      // Send complete result
      self.postMessage({
        type: 'task_complete',
        taskId: data.taskId,
        data: {
          workerId: data.workerId,
          result: {
            ...result,
            executionTime: durationMs,
            timestamp: Date.now()
          }
        }
      });
      
    } catch (error) {
      self.postMessage({
        type: 'error',
        data: {
          message: error.message,
          stack: error.stack,
          workerId: data.workerId,
          taskId: data.taskId
        }
      });
    }
  }
};

// Export functions for use with WorkerPool
  self.MonteCarloTask = MonteCarloTask;
}
