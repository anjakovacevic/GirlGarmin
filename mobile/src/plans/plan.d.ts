// '@plan' is src/plans/myPlan.ts if it exists, else src/plans/examplePlan.ts (see metro.config.js).
declare module '@plan' {
  const plan: import('../plan').PlanDef;
  export default plan;
}
