import * as fs from 'fs';
import * as path from 'path';

/**
 * Checks if the given workspace path is an Expo project.
 * It looks for 'expo' in the dependencies of the package.json.
 */
export function isExpoProject(workspacePath: string): boolean {
  try {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (
        (packageJson.dependencies && packageJson.dependencies.expo) ||
        (packageJson.devDependencies && packageJson.devDependencies.expo)
      ) {
        return true;
      }
    }
  } catch (error) {
    console.error('Error reading package.json:', error);
  }
  return false;
}
