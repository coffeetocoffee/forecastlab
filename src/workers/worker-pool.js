// Web Worker pool for parallel Monte Carlo path simulation
// Distributes computation across multiple worker threads

/**
 * Worker Pool Manager
 * Manages a pool of Web Workers for parallel computation
 */
export class WorkerPool {
  constructor(options = {}) {
    this.size = options.size || navigator.hardwareConcurrency || 4;
    this.workerScript = options.workerScript || 'workers/monte-carlo-worker.js';
    this.workers = [];
    this.pendingTasks = [];
    this.activeWorkers = new Set();
    this.onTaskComplete = options.onTaskComplete || null;
    this.onProgressUpdate = options.onProgressUpdate || null;
    
    // Statistics
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalTime: 0
    };
  }

  /**
   * Initialize worker pool
   */
  initialize() {
    if (this.workers.length > 0) {
      return Promise.resolve(); // Already initialized
    }
    
    return Promise.all(
      Array.from({ length: this.size }, (_, i) => this.createWorker(i))
    );
  }

  /**
   * Create a new worker instance
   */
  async createWorker(id) {
    const workerUrl = `${this.workerScript}?id=${id}`;
    const worker = new Worker(workerUrl);
    
    const taskQueue = [];
    
    worker.postMessage({ type: 'init', id });
    
    worker.onmessage = (event) => {
      const { type, data, taskId } = event.data;
      
      switch (type) {
        case 'task_complete':
          this.handleTaskComplete(taskId, data);
          break;
        case 'progress':
          if (this.onProgressUpdate) {
            this.onProgressUpdate({ workerId: id, ...data });
          }
          break;
        case 'error':
          this.handleTaskError(taskId, data);
          break;
      }
    };
    
    // Mark worker as ready when first message received
    return new Promise((resolve) => {
      const checkReady = (e) => {
        if (e.data?.type === 'ready') {
          worker.removeEventListener('message', checkReady);
          this.workers[id] = { worker, status: 'idle', id };
          this.activeWorkers.add(id);
          resolve();
        }
      };
      worker.addEventListener('message', checkReady);
    });
  }

  /**
   * Submit a task to be executed in the pool
   */
  submitTask(task) {
    return new Promise((resolve, reject) => {
      this.stats.totalTasks++;
      
      const taskId = this.generateTaskId();
      
      // Find an idle worker or use first available
      const workerInfo = this.findAvailableWorker();
      
      if (!workerInfo) {
        // Queue the task if all workers are busy
        this.pendingTasks.push({
          taskId,
          task,
          resolve,
          reject
        });
        return;
      }
      
      const { worker, id } = workerInfo;
      
      // Prepare task message
      const message = {
        type: 'execute',
        taskId,
        workerId: id,
        task,
        options: {
          includeProgress: task.includeProgress !== false
        }
      };
      
      worker.postMessage(message);
      this.activeWorkers.add(id);
      
      // Store promise handler
      this.taskCallbacks = this.taskCallbacks || {};
      this.taskCallbacks[taskId] = { resolve, reject };
    });
  }

  /**
   * Find an available idle worker
   */
  findAvailableWorker() {
    // First try to find an idle worker
    const idleWorker = this.workers.find(w => w && w.status === 'idle');
    if (idleWorker) {
      idleWorker.status = 'busy';
      return idleWorker;
    }
    
    // Return any available worker
    const anyWorker = this.workers.find(w => w);
    if (anyWorker) {
      return anyWorker;
    }
    
    return null;
  }

  /**
   * Handle task completion
   */
  handleTaskComplete(taskId, data) {
    this.activeWorkers.delete(data.workerId);
    
    // Try next pending task
    this.processPendingTasks();
    
    if (this.taskCallbacks?.[taskId]) {
      this.taskCallbacks[taskId].resolve(data.result);
      delete this.taskCallbacks[taskId];
    }
    
    this.stats.completedTasks++;
    
    if (this.onTaskComplete) {
      this.onTaskComplete({
        taskId,
        workerId: data.workerId,
        result: data.result,
        stats: { ...this.stats }
      });
    }
  }

  /**
   * Handle task error
   */
  handleTaskError(taskId, error) {
    this.activeWorkers.delete(error.workerId);
    
    if (this.taskCallbacks?.[taskId]) {
      this.taskCallbacks[taskId].reject(error);
      delete this.taskCallbacks[taskId];
    }
    
    this.stats.failedTasks++;
  }

  /**
   * Process pending tasks queue
   */
  processPendingTasks() {
    while (this.pendingTasks.length > 0) {
      const workerInfo = this.findAvailableWorker();
      if (!workerInfo) break;
      
      const pendingTask = this.pendingTasks.shift();
      
      const message = {
        type: 'execute',
        taskId: pendingTask.taskId,
        workerId: workerInfo.id,
        task: pendingTask.task,
        options: {
          includeProgress: pendingTask.task.includeProgress !== false
        }
      };
      
      workerInfo.worker.postMessage(message);
      workerInfo.status = 'busy';
      this.activeWorkers.add(workerInfo.id);
      
      this.taskCallbacks = this.taskCallbacks || {};
      this.taskCallbacks[pendingTask.taskId] = pendingTask;
    }
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeWorkers: this.activeWorkers.size,
      queuedTasks: this.pendingTasks.length,
      totalWorkers: this.size
    };
  }

  /**
   * Shutdown all workers
   */
  shutdown() {
    this.workers.forEach(worker => {
      if (worker?.worker) {
        worker.worker.terminate();
      }
    });
    this.workers = [];
    this.pendingTasks = [];
    this.activeWorkers.clear();
  }

  /**
   * Execute multiple tasks in parallel with batched results
   */
  async executeParallel(tasks) {
    await this.initialize();
    
    const promises = tasks.map(task => this.submitTask(task));
    const results = await Promise.all(promises);
    
    return results;
  }
}

/**
 * Monte Carlo Path Simulation Task
 * Runs Monte Carlo simulations with uncertainty estimation
 */
export class MonteCarloTask {
  constructor(options = {}) {
    this.baseValues = options.baseValues;
    this.horizon = options.horizon;
    this.numPaths = options.numPaths || 1000;
    this.volatility = options.volatility;
    this.drift = options.drift || 0;
    this.method = options.method || 'ar1'; // ar1, geometric_brownian, etc.
    
    // Optional: correlation matrix for multivariate
    this.correlationMatrix = options.correlationMatrix || null;
    
    this.progressCallback = options.onProgress || null;
    this.includeProgress = true;
  }

  /**
   * Execute the Monte Carlo simulation
   */
  execute() {
    const startTime = performance.now();
    
    // Validate inputs
    if (!Array.isArray(this.baseValues)) {
      throw new Error('baseValues must be an array');
    }
    
    if (this.horizon < 1) {
      throw new Error('horizon must be at least 1');
    }
    
    if (this.numPaths < 1) {
      throw new Error('numPaths must be at least 1');
    }
    
    // Run simulation based on method
    let results;
    if (this.method === 'ar1') {
      results = this.simulateAR1();
    } else if (this.method === 'geometric_brownian') {
      results = this.simulateGeometricBrownian();
    } else if (this.method === 'multiplicative') {
      results = this.simulateMultiplicative();
    } else {
      throw new Error(`Unknown method: ${this.method}`);
    }
    
    const endTime = performance.now();
    const executionTimeMs = endTime - startTime;
    
    return {
      paths: results.paths,
      percentiles: this.calculatePercentiles(results.paths),
      executionTime: executionTimeMs,
      numPaths: this.numPaths,
      horizon: this.horizon
    };
  }

  simulateAR1() {
    const paths = [];
    const n = this.baseValues.length;
    const h = this.horizon;
    
    for (let p = 0; p < this.numPaths; p++) {
      const path = [this.baseValues[n - 1]]; // Start from last observed
      
      for (let t = 0; t < h; t++) {
        // AR(1) process: X_t = phi * X_{t-1} + epsilon
        const phi = 0.95; // Persistence parameter
        const epsilon = this.randn() * this.volatility;
        
        const nextValue = phi * path[t] + epsilon;
        path.push(nextValue);
      }
      
      paths.push(path);
      
      // Send progress update every 100 paths
      if ((p + 1) % 100 === 0 && this.progressCallback) {
        this.progressCallback(p + 1, this.numPaths);
      }
    }
    
    return { paths };
  }

  simulateGeometricBrownian() {
    const paths = [];
    const dt = 1 / 252; // Trading days in year
    const sigma = this.volatility;
    const mu = this.drift;
    
    for (let p = 0; p < this.numPaths; p++) {
      const path = [this.baseValues[this.baseValues.length - 1]];
      
      for (let t = 1; t <= this.horizon; t++) {
        const epsilon = this.randn();
        const logReturn = (mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * epsilon;
        const nextValue = path[t - 1] * Math.exp(logReturn);
        path.push(nextValue);
      }
      
      paths.push(path);
      
      if ((p + 1) % 100 === 0 && this.progressCallback) {
        this.progressCallback(p + 1, this.numPaths);
      }
    }
    
    return { paths };
  }

  simulateMultiplicative() {
    const paths = [];
    
    for (let p = 0; p < this.numPaths; p++) {
      const path = [this.baseValues[this.baseValues.length - 1]];
      
      for (let t = 1; t <= this.horizon; t++) {
        // Multiplicative noise model
        const multiplier = Math.exp(this.randn() * this.volatility);
        const nextValue = path[t - 1] * multiplier;
        path.push(nextValue);
      }
      
      paths.push(path);
      
      if ((p + 1) % 100 === 0 && this.progressCallback) {
        this.progressCallback(p + 1, this.numPaths);
      }
    }
    
    return { paths };
  }

  randn() {
    // Box-Muller transform for standard normal random variable
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.sin(2.0 * Math.PI * v);
  }

  calculatePercentiles(paths) {
    const horizon = this.horizon;
    const percentiles = {
      level: 95,
      values: [],
      lowerBound: [],
      upperBound: []
    };
    
    for (let t = 1; t <= horizon; t++) {
      const valuesAtT = paths.map(p => p[t]);
      const sorted = [...valuesAtT].sort((a, b) => a - b);
      
      const idx25 = Math.floor(sorted.length * 0.25);
      const idx50 = Math.floor(sorted.length * 0.5);
      const idx75 = Math.floor(sorted.length * 0.75);
      const idx05 = Math.floor(sorted.length * 0.025);
      const idx95 = Math.floor(sorted.length * 0.975);
      
      percentiles.values.push({ time: t, value: sorted[idx50], index: t });
      percentiles.lowerBound.push({ time: t, value: sorted[idx05], index: t });
      percentiles.upperBound.push({ time: t, value: sorted[idx95], index: t });
    }
    
    return percentiles;
  }
}

export default { WorkerPool, MonteCarloTask };
