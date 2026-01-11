---
name: nasa
description: Apply NASA's Power of Ten coding rules adapted for TypeScript/Node.js. Use when reviewing code, writing new code, or when the user asks for "NASA rules", "safe code", "defensive coding", or high-reliability code standards.
---

# NASA Power of Ten - TypeScript/Node.js Adaptation

Apply NASA JPL's safety-critical coding rules when writing or reviewing code. These rules prioritize reliability, predictability, and maintainability over cleverness or brevity.

## The 10 Rules (Adapted for TypeScript)

### Rule 1: Simple Control Flow

**Original**: Avoid complex flow constructs, such as goto and recursion.

**TypeScript Adaptation**:
- No recursion - use iterative approaches with explicit stacks/queues
- No deeply nested callbacks - use async/await with flat structure
- Avoid complex ternary chains - use if/else for clarity
- No goto-like patterns (labeled breaks across functions)

```typescript
// BAD: Recursion
function processTree(node: Node): void {
  process(node);
  node.children.forEach(child => processTree(child));
}

// GOOD: Iterative with explicit stack
function processTree(root: Node): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    process(node);
    stack.push(...node.children);
  }
}
```

### Rule 2: Fixed Loop Bounds

**Original**: All loops must have fixed bounds.

**TypeScript Adaptation**:
- Every loop must have a maximum iteration count
- Use `for` loops with explicit bounds over `while` when possible
- Add safety limits to while loops to prevent infinite loops
- Document expected iteration counts

```typescript
// BAD: Unbounded while
while (queue.length > 0) {
  processNext(queue);
}

// GOOD: Bounded with safety limit
const MAX_ITERATIONS = 10_000;
let iterations = 0;
while (queue.length > 0 && iterations < MAX_ITERATIONS) {
  processNext(queue);
  iterations++;
}
if (iterations >= MAX_ITERATIONS) {
  throw new Error('Loop exceeded maximum iterations');
}
```

### Rule 3: No Dynamic Allocation After Initialization

**Original**: Avoid heap memory allocation after initialization.

**TypeScript Adaptation**:
- Pre-allocate arrays and buffers when size is known
- Avoid creating objects in hot loops
- Reuse objects instead of creating new ones repeatedly
- Initialize data structures at startup, not during request handling

```typescript
// BAD: Allocating in hot path
function processItems(items: Item[]): Result[] {
  return items.map(item => ({ ...item, processed: true })); // New object per item
}

// GOOD: Mutate or pre-allocate
function processItems(items: Item[]): void {
  for (let i = 0; i < items.length; i++) {
    items[i].processed = true; // In-place mutation
  }
}
```

### Rule 4: Short Functions and Files

**Original**: Restrict functions to a single printed page (60 lines).

**TypeScript Adaptation**:
- Functions should be **40 lines or fewer** (excluding blank lines and comments)
- Files should be **300 lines or fewer** (excluding blank lines and comments)
- One function, one responsibility
- One file, one module/concern
- If a function needs more lines, extract helper functions
- If a file exceeds the limit, split into separate modules
- Cyclomatic complexity should be 10 or lower per function

```typescript
// BAD: Long function doing multiple things
async function handleSlackEvent(event: SlackEvent): Promise<void> {
  // 100+ lines of validation, processing, storage, notification...
}

// GOOD: Composed of focused functions
async function handleSlackEvent(event: SlackEvent): Promise<void> {
  const validated = validateEvent(event);
  const classified = await classifyMessage(validated);
  await storeResult(classified);
  await notifyUser(classified);
}
```

### Rule 5: Runtime Assertions

**Original**: Use a minimum of two runtime assertions per function.

**TypeScript Adaptation**:
- Validate inputs at function boundaries
- Assert preconditions and postconditions
- Use TypeScript's type system AND runtime checks for critical data
- Fail fast with descriptive errors

```typescript
function processUserMessage(message: string, userId: string): ProcessedMessage {
  // Precondition assertions
  if (!message || typeof message !== 'string') {
    throw new Error('Message must be a non-empty string');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('UserId must be a non-empty string');
  }

  const result = doProcessing(message, userId);

  // Postcondition assertion
  if (!result.id || !result.timestamp) {
    throw new Error('Processing failed to produce valid result');
  }

  return result;
}
```

### Rule 6: Minimize Scope

**Original**: Restrict the scope of data to the smallest possible.

**TypeScript Adaptation**:
- Declare variables at the point of first use
- Use `const` by default, `let` only when reassignment is needed
- Never use `var`
- Keep functions pure when possible - minimize side effects
- Avoid module-level mutable state

```typescript
// BAD: Wide scope
let result: string;
let processed = false;
// ... 50 lines later ...
result = compute();
processed = true;

// GOOD: Minimal scope
const result = compute(); // Declared where used, immutable
```

### Rule 7: Check All Return Values

**Original**: Check the return value of all non-void functions.

**TypeScript Adaptation**:
- Never ignore Promise rejections - always await and handle
- Check for null/undefined explicitly
- Handle all possible return states
- Use `noUncheckedIndexedAccess` in tsconfig

```typescript
// BAD: Ignoring potential failures
const data = cache.get(key); // Might be undefined
doSomething(data.value); // Crash if undefined

// GOOD: Explicit handling
const data = cache.get(key);
if (!data) {
  throw new Error(`Cache miss for key: ${key}`);
}
doSomething(data.value);

// For async operations
try {
  const result = await fetchData();
  // handle result
} catch (error) {
  // handle error explicitly
  throw new Error(`Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
}
```

### Rule 8: Limited Preprocessor/Metaprogramming

**Original**: Use the preprocessor sparingly.

**TypeScript Adaptation**:
- Avoid complex type gymnastics - prefer simple, readable types
- No runtime code generation (eval, new Function)
- Limit decorator usage to well-understood patterns
- Avoid proxy objects for core logic
- Keep generics simple (max 2-3 type parameters)

```typescript
// BAD: Complex type gymnastics
type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
// ... combined into unreadable mega-types

// GOOD: Simple, explicit types
interface PartialConfig {
  timeout?: number;
  retries?: number;
}
```

### Rule 9: Limit Indirection

**Original**: Limit pointer use to a single dereference.

**TypeScript Adaptation**:
- Maximum chain depth of 3 (a.b.c is OK, a.b.c.d.e is not)
- No callback hell - use async/await
- Avoid excessive abstraction layers
- Prefer direct function calls over dependency injection for simple cases

```typescript
// BAD: Deep chaining
const value = response.data?.results?.[0]?.metadata?.settings?.value;

// GOOD: Explicit extraction with validation
const results = response.data?.results;
if (!results || results.length === 0) {
  throw new Error('No results in response');
}
const settings = results[0].metadata?.settings;
if (!settings) {
  throw new Error('Missing settings in first result');
}
const value = settings.value;
```

### Rule 10: Compile with All Warnings

**Original**: Compile with all possible warnings active; all warnings should be addressed.

**TypeScript Adaptation**:
- Enable TypeScript strict mode (`"strict": true`)
- Enable additional checks:
  - `noUncheckedIndexedAccess`
  - `noImplicitReturns`
  - `noFallthroughCasesInSwitch`
  - `exactOptionalPropertyTypes`
- Zero ESLint warnings policy
- Address all TypeScript errors, no `@ts-ignore` without documented reason

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

## Application to mbrain Project

When reviewing or writing code for this project:

1. **Slack Event Handler** (`api/slack/events.ts`):
   - Validate all incoming webhook data (Rule 5)
   - Handle all Slack API response states (Rule 7)
   - Keep handler functions under 40 lines (Rule 4)

2. **Claude Service** (`src/services/claude.ts`):
   - Add timeout limits to API calls (Rule 2)
   - Validate classification responses (Rule 5, 7)
   - No complex prompt generation logic (Rule 8)

3. **Notion Service** (`src/services/notion.ts`):
   - Check all API responses explicitly (Rule 7)
   - Limit property access chains (Rule 9)
   - Pre-validate data before API calls (Rule 5)

4. **Type Definitions** (`src/types/index.ts`):
   - Keep types simple and readable (Rule 8)
   - Avoid deeply nested optional chains (Rule 9)

## Code Review Checklist

When reviewing code against NASA rules:

- [ ] No recursion - all iterations are explicit
- [ ] All loops have maximum iteration bounds
- [ ] No object allocation in hot paths
- [ ] Functions are 40 lines or fewer
- [ ] Files are 300 lines or fewer
- [ ] Inputs validated, outputs verified
- [ ] Variables declared with minimal scope
- [ ] All return values checked
- [ ] No complex metaprogramming
- [ ] Property chains max 3 deep
- [ ] TypeScript strict mode, zero warnings

## When to Apply These Rules

Apply with **full rigor** when:
- Writing core business logic
- Handling external API responses
- Processing user input
- Working with financial/sensitive data

Apply with **reasonable flexibility** when:
- Writing tests (recursion for test data generation is OK)
- One-off scripts
- Prototyping (but refactor before merge)
