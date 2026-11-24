const path = require('node:path');

// Explicit override, activated Conda environment, then the project's local venv.
function pythonPath(root) {
  // Preserve the original Windows launcher, even with a Conda shell active.
  if (process.platform !== 'darwin')
    return path.join(root, 'engine', '.venv', 'Scripts', 'python.exe');
  if (process.env.OPENBRAIN_PYTHON) return process.env.OPENBRAIN_PYTHON;
  if (process.env.CONDA_PREFIX) return path.join(process.env.CONDA_PREFIX, 'bin', 'python');
  return path.join(root, 'engine', '.venv', 'bin', 'python');
}

module.exports = { pythonPath };
