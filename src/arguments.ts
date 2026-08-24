export interface DiffCommandOptions {
  staged: boolean;
  ref?: string;
  path?: string;
}

export class DiffArgumentError extends Error {}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let started = false;

  for (const character of input.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }

  if (escaping) throw new DiffArgumentError("A trailing backslash is not a complete argument.");
  if (quote) throw new DiffArgumentError("The file path has an unterminated quote.");
  if (started) tokens.push(token);
  return tokens;
}

function normalizePath(value: string): string {
  const path = value.startsWith("@") ? value.slice(1) : value;
  if (!path) throw new DiffArgumentError("Select a file after @.");
  return path;
}

export function parseDiffArguments(input: string): DiffCommandOptions {
  const tokens = tokenize(input);
  const result: DiffCommandOptions = { staged: false };
  let optionsEnded = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (!optionsEnded && token === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token === "--staged") {
      if (result.staged) throw new DiffArgumentError("--staged may only be specified once.");
      result.staged = true;
      continue;
    }
    if (!optionsEnded && (token === "--ref" || token.startsWith("--ref="))) {
      if (result.ref !== undefined) throw new DiffArgumentError("--ref may only be specified once.");
      const value = token === "--ref" ? tokens[++index] : token.slice("--ref=".length);
      if (!value || value.startsWith("-")) {
        throw new DiffArgumentError("--ref requires a Git revision or range that does not start with '-'.");
      }
      result.ref = value;
      continue;
    }
    if (!optionsEnded && token.startsWith("--")) {
      throw new DiffArgumentError(`Unknown option: ${token}`);
    }
    if (result.path !== undefined) {
      throw new DiffArgumentError("/diff accepts at most one file or directory path.");
    }
    result.path = normalizePath(token);
  }

  if (result.staged && result.ref !== undefined) {
    throw new DiffArgumentError("--staged and --ref cannot be used together.");
  }
  return result;
}
