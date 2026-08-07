import { CliError, EXIT } from "./errors.js";

export function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new CliError(`unexpected positional argument: ${token}`, { exitCode: EXIT.usage });
    }
    const [rawName, inline] = token.slice(2).split("=", 2);
    if (!allowed.has(rawName)) {
      throw new CliError(`unknown option: --${rawName}`, { exitCode: EXIT.usage });
    }
    if (Object.hasOwn(options, rawName)) {
      throw new CliError(`option repeated: --${rawName}`, { exitCode: EXIT.usage });
    }
    if (allowed.get(rawName) === "boolean") {
      if (inline !== undefined) throw new CliError(`--${rawName} does not take a value`, { exitCode: EXIT.usage });
      options[rawName] = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new CliError(`--${rawName} requires a value`, { exitCode: EXIT.usage });
    }
    options[rawName] = value;
  }
  return options;
}

export function requireOptions(options, names) {
  for (const name of names) {
    if (!options[name]) throw new CliError(`missing required option: --${name}`, { exitCode: EXIT.usage });
  }
}

