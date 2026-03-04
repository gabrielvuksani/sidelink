export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const hoursBetween = (fromIso: string, toIso: string): number => {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60);
};

export const addMinutes = (iso: string, minutes: number): string => {
  const date = new Date(iso);
  date.setTime(date.getTime() + minutes * 60 * 1000);
  return date.toISOString();
};

export const addHours = (iso: string, hours: number): string => addMinutes(iso, hours * 60);

export const addDays = (iso: string, days: number): string => addHours(iso, days * 24);

export const subtractHours = (iso: string, hours: number): string => addHours(iso, -hours);

export const isPastOrEqual = (leftIso: string, rightIso: string): boolean => {
  return new Date(leftIso).getTime() >= new Date(rightIso).getTime();
};
