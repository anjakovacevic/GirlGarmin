// Picks the training plan: src/plans/myPlan.ts if it exists (git-ignored, private), else
// src/plans/examplePlan.ts. The app imports it as '@plan'. Restart `npx expo start` after
// creating or deleting myPlan.ts.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const mine = path.join(__dirname, 'src', 'plans', 'myPlan.ts');
const planFile = fs.existsSync(mine) ? mine : path.join(__dirname, 'src', 'plans', 'examplePlan.ts');

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === '@plan') return { type: 'sourceFile', filePath: planFile };
  return (upstream ?? context.resolveRequest)(context, name, platform);
};

module.exports = config;
