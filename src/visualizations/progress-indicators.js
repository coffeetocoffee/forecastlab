// Progress indicators for long-running computations
// Visual feedback for Monte Carlo simulations and other intensive tasks

/**
 * Progress Indicator Component
 * Shows real-time progress of async operations
 */
export class ProgressIndicator {
  constructor(options = {}) {
    this.container = options.container;
    this.showPercentage = options.showPercentage !== false;
    this.showStatusText = options.showStatusText !== false;
    this.onComplete = options.onComplete || null;
    
    this.element = null;
    this.progressBar = null;
  }

  /**
   * Initialize progress indicator in container
   */
  initialize() {
    if (this.element) {
      return; // Already initialized
    }
    
    this.element = d3.select(this.container)
      .append('div')
      .attr('class', 'progress-container');
    
    // Status text
    this.statusText = this.element.append('div')
      .attr('class', 'status-text')
      .style('margin-bottom', '8px')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .style('color', '#1f2937')
      .text('Initializing...');
    
    // Progress bar container
    const progressWrapper = this.element.append('div')
      .attr('class', 'progress-wrapper')
      .style('width', '100%')
      .style('height', '24px')
      .style('background', '#e5e7eb')
      .style('border-radius', '12px')
      .style('overflow', 'hidden');
    
    // Progress bar fill
    this.progressBar = progressWrapper.append('div')
      .attr('class', 'progress-fill')
      .style('height', '100%')
      .style('width', '0%')
      .style('background', 'linear-gradient(90deg, #3b82f6, #10b981)')
      .style('transition', 'width 0.3s ease-out')
      .style('border-radius', '12px');
    
    // Percentage text
    if (this.showPercentage) {
      this.percentageText = this.element.append('div')
        .attr('class', 'percentage-text')
        .style('text-align', 'center')
        .style('font-size', '18px')
        .style('font-weight', 'bold')
        .style('color', '#3b82f6')
        .text('0%');
    }
    
    return this;
  }

  /**
   * Update progress percentage
   */
  updateProgress(percent, status) {
    if (!this.element) {
      this.initialize();
    }
    
    const cappedPercent = Math.min(100, Math.max(0, percent));
    
    // Animate progress bar
    this.progressBar.style('width', `${cappedPercent}%`);
    
    // Update percentage text
    if (this.percentageText) {
      this.percentageText.text(`${cappedPercent.toFixed(1)}%`);
    }
    
    // Update status text
    if (this.showStatusText && status) {
      this.statusText.text(status);
    }
    
    return this;
  }

  /**
   * Start with a status message
   */
  start(message) {
    this.reset();
    this.updateProgress(0, message);
    return this;
  }

  /**
   * Complete progress with success message
   */
  complete(message) {
    this.updateProgress(100, message);
    
    setTimeout(() => {
      if (this.onComplete) {
        this.onComplete({ completed: true, percent: 100 });
      }
      
      this.hide();
    }, 1000);
    
    return this;
  }

  /**
   * Handle partial task completion updates
   */
  updateTask(taskInfo) {
    const { taskIndex, totalTasks, currentPath, totalPaths, stage } = taskInfo;
    
    let status;
    if (stage === 'paths') {
      const pathPercent = ((currentPath / totalPaths) * 100).toFixed(1);
      status = `Simulating path ${currentPath} of ${totalPaths} (${pathPercent}%)`;
    } else {
      const taskPercent = ((taskIndex / totalTasks) * 100).toFixed(1);
      status = `Processing task ${taskIndex + 1} of ${totalTasks} (${taskPercent}%)`;
    }
    
    // Overall progress based on both metrics
    const overallPercent = Math.min(100, ((taskIndex + (currentPath / totalPaths)) / totalTasks) * 100);
    
    this.updateProgress(overallPercent, status);
    return this;
  }

  /**
   * Show error state
   */
  showError(message) {
    if (!this.element) {
      this.initialize();
    }
    
    this.progressBar.style('background', '#ef4444');
    this.statusText.text(`Error: ${message}`);
    
    return this;
  }

  /**
   * Hide progress indicator
   */
  hide() {
    if (this.element) {
      this.element.style('display', 'none');
    }
    return this;
  }

  /**
   * Show progress indicator
   */
  show() {
    if (this.element) {
      this.element.style('display', 'block');
    }
    return this;
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.updateProgress(0, '');
    return this;
  }

  /**
   * Create animated loading spinner
   */
  createSpinner(containerElement) {
    const spinner = containerElement.append('div')
      .attr('class', 'spinner')
      .style('width', '24px')
      .style('height', '24px')
      .style('border', '3px solid #e5e7eb')
      .style('border-top-color', '#3b82f6')
      .style('border-radius', '50%')
      .style('animation', 'spin 1s linear infinite');
    
    // Add keyframes
    const style = document.createElement('style');
    style.innerHTML = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
    return spinner;
  }
}

/**
 * Multi-stage Progress Monitor
 * Handles complex multi-step computations with multiple stages
 */
export class MultiStageProgress {
  constructor(options = {}) {
    this.stages = [];
    this.currentStage = 0;
    this.progressCallbacks = [];
    this.container = options.container;
    
    this.indicators = {};
  }

  /**
   * Add a processing stage
   */
  addStage(name, expectedTasks) {
    this.stages.push({
      name,
      expectedTasks,
      completedTasks: 0,
      started: false
    });
    
    return this;
  }

  /**
   * Mark a task as completed
   */
  markTaskComplete(stageName) {
    const stage = this.stages.find(s => s.name === stageName);
    if (stage) {
      stage.completedTasks++;
      this.updateOverallProgress();
    }
    
    if (!stage.started) {
      stage.started = true;
    }
  }

  /**
   * Get overall progress percentage
   */
  getOverallProgress() {
    if (this.stages.length === 0) return 0;
    
    const totalExpected = this.stages.reduce((sum, s) => sum + s.expectedTasks, 0);
    const totalCompleted = this.stages.reduce((sum, s) => sum + s.completedTasks, 0);
    
    return (totalCompleted / totalExpected) * 100;
  }

  /**
   * Update progress display
   */
  updateOverallProgress() {
    const percent = this.getOverallProgress();
    const currentStageName = this.getCurrentStageName();
    
    const status = `${currentStageName}: ${(percent).toFixed(1)}% complete`;
    
    this.progressCallbacks.forEach(cb => cb(percent, status));
  }

  /**
   * Register progress callback
   */
  onProgress(callback) {
    this.progressCallbacks.push(callback);
  }

  /**
   * Get current stage name
   */
  getCurrentStageName() {
    if (this.stages.length === 0) return 'Unknown';
    
    // Find first active stage or last completed
    const activeStage = this.stages.find(s => s.started && s.completedTasks < s.expectedTasks);
    if (activeStage) return activeStage.name;
    
    const lastStarted = [...this.stages].reverse().find(s => s.started);
    return lastStarted ? lastStarted.name : 'Initialization';
  }

  /**
   * Reset all stages
   */
  reset() {
    this.stages.forEach(s => {
      s.completedTasks = 0;
      s.started = false;
    });
    this.currentStage = 0;
  }
}

/**
 * Create progress-aware wrapper for async operations
 */
export function createProgressAwareOperation(operation, options = {}) {
  const {
    stages = [],
    onProgress = null,
    onComplete = null,
    onError = null
  } = options;
  
  return new Promise(async (resolve, reject) => {
    const multiProgress = new MultiStageProgress({
      container: options.container
    });
    
    // Add stages
    stages.forEach(stage => {
      multiProgress.addStage(stage.name, stage.expectedTasks);
    });
    
    // Track progress
    multiProgress.onProgress((percent, status) => {
      if (onProgress) {
        onProgress({
          percent,
          status,
          stage: multiProgress.getCurrentStageName(),
          time: performance.now()
        });
      }
    });
    
    try {
      const result = await operation({
        updateProgress: (stage, completed, total) => {
          multiProgress.markTaskComplete(stage);
        }
      });
      
      if (onComplete) {
        onComplete({
          percent: 100,
          status: 'Complete',
          time: performance.now(),
          result
        });
      }
      
      resolve(result);
    } catch (error) {
      if (onError) {
        onError(error);
      }
      reject(error);
    }
  });
}

export default { ProgressIndicator, MultiStageProgress, createProgressAwareOperation };
