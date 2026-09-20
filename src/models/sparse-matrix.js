// Memory-efficient sparse matrix operations for large-scale Monte Carlo simulations
// Uses compressed sparse row (CSR) format for efficient storage and computation

/**
 * Sparse Matrix Class using Compressed Sparse Row (CSR) format
 * Optimized for storage and computation with mostly-zero matrices
 */
export class SparseMatrix {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    
    // CSR format arrays
    this.values = [];      // Non-zero values
    this.colIndices = [];  // Column indices of non-zero values  
    this.rowPointers = []; // Pointer to start of each row in values array
    
    // Metadata
    this.isSymmetric = false;
    this.diagonalValues = new Map();
  }

  /**
   * Set a value at position (i, j)
   */
  set(i, j, value) {
    if (value === 0) {
      return this.delete(i, j);
    }
    
    // Find position in sorted colIndices[i]
    const rowStart = this.rowPointers[i];
    const rowEnd = this.rowPointers[i + 1];
    
    let pos = -1;
    for (let k = rowStart; k < rowEnd; k++) {
      if (this.colIndices[k] === j) {
        pos = k;
        break;
      } else if (this.colIndices[k] > j) {
        break;
      }
    }
    
    if (pos >= 0) {
      // Update existing value
      this.values[pos] = value;
    } else {
      // Insert new value maintaining sorted order
      const insertPos = pos >= 0 ? pos : this.colIndices.findIndex(c => c > j && c !== undefined);
      
      // Adjust row pointers for elements after this row
      for (let r = i + 1; r <= this.rows; r++) {
        this.rowPointers[r]++;
      }
      
      // Insert into colIndices
      this.colIndices.splice(insertPos, 0, j);
      
      // Insert into values
      this.values.splice(insertPos, 0, value);
      
      // Update diagonal if applicable
      if (i === j) {
        this.diagonalValues.set(i, value);
      }
    }
  }

  /**
   * Delete value at position (i, j)
   */
  delete(i, j) {
    const rowStart = this.rowPointers[i];
    const rowEnd = this.rowPointers[i + 1];
    
    for (let k = rowStart; k < rowEnd; k++) {
      if (this.colIndices[k] === j) {
        // Remove from arrays
        this.colIndices.splice(k, 1);
        this.values.splice(k, 1);
        
        // Adjust subsequent row pointers
        for (let r = i + 1; r <= this.rows; r++) {
          this.rowPointers[r]--;
        }
        
        if (i === j) {
          this.diagonalValues.delete(i);
        }
        
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get value at position (i, j)
   */
  get(i, j) {
    const rowStart = this.rowPointers[i];
    const rowEnd = this.rowPointers[i + 1];
    
    for (let k = rowStart; k < rowEnd; k++) {
      if (this.colIndices[k] === j) {
        return this.values[k];
      }
    }
    
    return 0;
  }

  /**
   * Initialize from dense array
   */
  static fromDense(denseArray) {
    const rows = denseArray.length;
    const cols = denseArray[0].length;
    
    const sparse = new SparseMatrix(rows, cols);
    
    for (let i = 0; i < rows; i++) {
      sparse.rowPointers.push(sparse.values.length);
      
      for (let j = 0; j < cols; j++) {
        const value = denseArray[i][j];
        if (value !== 0) {
          sparse.values.push(value);
          sparse.colIndices.push(j);
          
          if (i === j) {
            sparse.diagonalValues.set(i, value);
          }
        }
      }
    }
    
    sparse.rowPointers.push(sparse.values.length);
    return sparse;
  }

  /**
   * Convert back to dense array
   */
  toDense() {
    const result = Array.from({ length: this.rows }, () => 
      Array(this.cols).fill(0)
    );
    
    for (let i = 0; i < this.rows; i++) {
      const rowStart = this.rowPointers[i];
      const rowEnd = this.rowPointers[i + 1];
      
      for (let k = rowStart; k < rowEnd; k++) {
        const j = this.colIndices[k];
        result[i][j] = this.values[k];
      }
    }
    
    return result;
  }

  /**
   * Multiply sparse matrix by vector
   */
  multiplyVector(vector) {
    if (vector.length !== this.cols) {
      throw new Error(`Dimension mismatch: ${this.cols} != ${vector.length}`);
    }
    
    const result = new Array(this.rows).fill(0);
    
    for (let i = 0; i < this.rows; i++) {
      const rowStart = this.rowPointers[i];
      const rowEnd = this.rowPointers[i + 1];
      
      for (let k = rowStart; k < rowEnd; k++) {
        const j = this.colIndices[k];
        result[i] += this.values[k] * vector[j];
      }
    }
    
    return result;
  }

  /**
   * Add two sparse matrices
   */
  add(other) {
    if (this.rows !== other.rows || this.cols !== other.cols) {
      throw new Error('Matrix dimensions must match');
    }
    
    const result = new SparseMatrix(this.rows, this.cols);
    
    // Combine and deduplicate entries
    const allEntries = [];
    
    for (let i = 0; i < this.rows; i++) {
      const rowStart1 = this.rowPointers[i];
      const rowEnd1 = this.rowPointers[i + 1];
      const rowStart2 = other.rowPointers[i];
      const rowEnd2 = other.rowPointers[i + 1];
      
      let ptr1 = rowStart1;
      let ptr2 = rowStart2;
      
      while (ptr1 < rowEnd1 || ptr2 < rowEnd2) {
        let col1 = ptr1 < rowEnd1 ? this.colIndices[ptr1] : Infinity;
        let col2 = ptr2 < rowEnd2 ? other.colIndices[ptr2] : Infinity;
        
        if (col1 === col2) {
          // Both have entry at same column
          const sum = (ptr1 < rowEnd1 ? this.values[ptr1] : 0) + 
                     (ptr2 < rowEnd2 ? other.values[ptr2] : 0);
          if (sum !== 0) {
            allEntries.push([i, col1, sum]);
          }
          ptr1++;
          ptr2++;
        } else if (col1 < col2) {
          onlyFirst.has entry
          allEntries.push([i, col1, this.values[ptr1]]);
          ptr1++;
        } else {
          onlySecond has entry
          allEntries.push([i, col2, other.values[ptr2]]);
          ptr2++;
        }
      }
    }
    
    // Build result matrix
    for (const [i, j, value] of allEntries) {
      result.set(i, j, value);
    }
    
    return result;
  }

  /**
   * Calculate sparsity ratio
   */
  sparsity() {
    const totalElements = this.rows * this.cols;
    const nonZeroElements = this.values.length;
    return 1 - (nonZeroElements / totalElements);
  }

  /**
   * Get statistics about the matrix
   */
  stats() {
    return {
      rows: this.rows,
      cols: this.cols,
      nonZeros: this.values.length,
      sparsity: this.sparsity(),
      density: this.values.length / (this.rows * this.cols)
    };
  }

  /**
   * Clone the matrix
   */
  clone() {
    const cloned = new SparseMatrix(this.rows, this.cols);
    cloned.values = [...this.values];
    cloned.colIndices = [...this.colIndices];
    cloned.rowPointers = [...this.rowPointers];
    cloned.isSymmetric = this.isSymmetric;
    cloned.diagonalValues = new Map(this.diagonalValues);
    return cloned;
  }
}

/**
 * Sparse Cholesky Decomposition
 * For symmetric positive-definite sparse matrices
 */
export class SparseCholesky {
  constructor(matrix) {
    if (!matrix.isSymmetric) {
      throw new Error('Matrix must be symmetric for Cholesky decomposition');
    }
    
    this.n = matrix.rows;
    this.L = this.initializeL();
    this.decompose(matrix);
  }

  initializeL() {
    const L = new SparseMatrix(this.n, this.n);
    
    // Initialize diagonal entries from input matrix
    for (let i = 0; i < this.n; i++) {
      L.diagonalValues.set(i, null);
    }
    
    return L;
  }

  decompose(A) {
    for (let i = 0; i < this.n; i++) {
      // Process diagonal element
      const diagValue = A.get(i, i);
      let L_ii_sq = diagValue;
      
      // Subtract contributions from previously computed elements
      const rowStart = A.rowPointers[i];
      const rowEnd = A.rowPointers[i + 1];
      
      for (let k = rowStart; k < rowEnd; k++) {
        const col_k = A.colIndices[k];
        if (col_k < i) {
          const Lik = L.get(i, col_k);
          const Liksq = Lik * Lik;
          
          // Accumulate L_ik^2 contribution
          let currentSum = L_ii_sq;
          const dRow = this.L.rowPointers[col_k + 1] - this.L.rowPointers[col_k];
          for (let m = 0; m < dRow; m++) {
            const dCol = this.L.colIndices[this.L.rowPointers[col_k] + m];
            if (dCol === i) {
              L_ii_sq -= Liksq * (L.get(col_k, i) ** 2);
              break;
            }
          }
        }
      }
      
      if (L_ii_sq <= 0) {
        throw new Error('Matrix is not positive-definite');
      }
      
      L.set(i, i, Math.sqrt(L_ii_sq));
      
      // Compute off-diagonal elements
      for (let k = rowStart; k < rowEnd; k++) {
        const j = A.colIndices[k];
        if (j > i) {
          let sum = A.get(i, j);
          
          // Subtract dot product of previous columns
          const colK_L = this.L.rowPointers[i];
          const colK_end = this.L.rowPointers[i + 1];
          
          for (let p = colK_L; p < colK_end; p++) {
            const prev_col = this.L.colIndices[p];
            sum -= this.L.get(i, prev_col) * this.L.get(j, prev_col);
          }
          
          L.set(i, j, sum / L.get(i, i));
        }
      }
    }
    
    this.L = L;
  }

  /**
   * Solve L @ y = b (forward substitution)
   */
  forwardSubstitute(b) {
    const y = new Array(this.n).fill(0);
    
    for (let i = 0; i < this.n; i++) {
      let sum = b[i];
      
      const rowStart = this.L.rowPointers[i];
      const rowEnd = this.L.rowPointers[i + 1];
      
      for (let k = rowStart; k < rowEnd; k++) {
        const j = this.L.colIndices[k];
        if (j < i) {
          sum -= this.L.get(i, j) * y[j];
        }
      }
      
      y[i] = sum / this.L.get(i, i);
    }
    
    return y;
  }

  /**
   * Solve L.T @ x = y (backward substitution)
   */
  backwardSubstitute(y) {
    const x = new Array(this.n).fill(0);
    
    for (let i = this.n - 1; i >= 0; i--) {
      let sum = y[i];
      
      const rowStart = this.L.rowPointers[i];
      const rowEnd = this.L.rowPointers[i + 1];
      
      for (let k = rowStart; k < rowEnd; k++) {
        const j = this.L.colIndices[k];
        if (j > i) {
          sum -= this.L.get(i, j) * x[j];
        }
      }
      
      x[i] = sum / this.L.get(i, i);
    }
    
    return x;
  }

  /**
   * Solve linear system A @ x = b
   */
  solve(b) {
    const y = this.forwardSubstitute(b);
    return this.backwardSubstitute(y);
  }
}

/**
 * Vector operations optimized for Monte Carlo variance calculations
 */
export class VectorOps {
  /**
   * Calculate covariance matrix from multiple vectors efficiently
   */
  static computeCovarianceMatrix(dataVectors) {
    const n = dataVectors.length;
    const m = dataVectors[0].length;
    
    // Calculate means
    const means = new Array(m).fill(0);
    for (const vec of dataVectors) {
      for (let i = 0; i < m; i++) {
        means[i] += vec[i];
      }
    }
    for (let i = 0; i < m; i++) {
      means[i] /= n;
    }
    
    // Calculate covariances using Welford's algorithm variant
    const covariance = new SparseMatrix(m, m);
    
    // Initialize to zero
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        let sum = 0;
        
        for (const vec of dataVectors) {
          sum += (vec[i] - means[i]) * (vec[j] - means[j]);
        }
        
        if (Math.abs(sum / (n - 1)) > 1e-10) {
          covariance.set(i, j, sum / (n - 1));
          if (i !== j) {
            covariance.set(j, i, sum / (n - 1)); // Symmetric
          }
        }
      }
    }
    
    return covariance;
  }
}

export default { SparseMatrix, SparseCholesky, VectorOps };
