const normalize = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export const readEnv = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = normalize(process.env[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

export const readBooleanEnv = (keys: string[], fallback = false): boolean => {
  const value = readEnv(...keys);
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const readNumberEnv = (keys: string[], fallback: number): number => {
  const value = readEnv(...keys);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
