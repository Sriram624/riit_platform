import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appConfig as config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runRiskEngine(payload) {
  const candidatePaths = [
    config.riskEnginePath,
    '../../../services/risk-engine/src/engine.py',
    '../../services/risk-engine/src/engine.py',
  ]
    .filter(Boolean)
    .map((relativePath) => path.resolve(__dirname, relativePath));

  const scriptPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));

  if (!scriptPath) {
    throw new Error(
      `Risk engine script not found. Tried: ${candidatePaths.join(', ')}`,
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Risk engine failed with code ${code}. stderr: ${errorOutput || 'empty'}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(output);
        resolve(parsed);
      } catch (parseError) {
        reject(
          new Error(`Failed to parse risk engine response: ${parseError.message}`),
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
