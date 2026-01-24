# Coverage Calculation

How to calculate documentation coverage for a service.

## Formula

```javascript
const endpointCoverage = (documentedEndpoints / totalEndpoints) * 100;
const modelCoverage = (documentedModels / totalModels) * 100;
const useCaseCoverage = (documentedUseCases / totalUseCases) * 100;
const configCoverage = (documentedEnvVars / totalEnvVars) * 100;

const overallCoverage =
  endpointCoverage * 0.4 +
  modelCoverage * 0.3 +
  useCaseCoverage * 0.2 +
  configCoverage * 0.1;
```

## Weights

| Component     | Weight | Rationale                              |
| ------------- | ------ | -------------------------------------- |
| Endpoints     | 40%    | Primary interface, most important      |
| Models        | 30%    | Core data structures                   |
| Use Cases     | 20%    | Business logic documentation           |
| Configuration | 10%    | Setup documentation                    |

## What Counts as "Documented"

### Endpoints

An endpoint is documented if it has:

- JSDoc or docstring with `@summary` or `@description`
- Request schema documented
- Response schema documented

**Check method:**
```bash
# Look for @summary annotations in route files
grep -r "@summary" apps/<service-name>/src/routes/
```

### Models

A model is documented if it has:

- Description comment/JSDoc on the type/interface
- Each field has `@description` or inline comment

**Check method:**
```bash
# Look for documented interfaces in models/
grep -B1 "interface\|type" apps/<service-name>/src/domain/models/
```

### Use Cases

A use case is documented if it has:

- Purpose description in JSDoc
- Input/output types documented
- Dependencies listed

**Check method:**
```bash
# Look for documented use cases
grep -r "export.*function\|export.*const" apps/<service-name>/src/domain/usecases/
```

### Configuration

An environment variable is documented if it has:

- JSDoc comment explaining purpose
- Required vs optional marked
- Default value noted (if applicable)

**Check method:**
```bash
# Look for env var usage
grep -r "INTEXURAOS_" apps/<service-name>/src/
```

## Output Format

```
Documentation Coverage: 73%

Breakdown:
  Endpoints:  80% (12/15 documented)
  Models:     67% (4/6 documented)
  Use Cases:  80% (4/5 documented)
  Config:     60% (3/5 documented)

Missing:
  - routes/webhookHandler.ts (no docstring)
  - models/TaskItem.ts (field 'metadata' undocumented)
  - usecases/processTask.ts (no description)
```

## Thresholds

| Coverage | Status       | Action                       |
| -------- | ------------ | ---------------------------- |
| 90%+     | Excellent    | Maintenance mode             |
| 70-90%   | Good         | Document on change           |
| 50-70%   | Needs Work   | Prioritize documentation     |
| <50%     | Critical     | Block features until improved |
