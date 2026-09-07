function shiftBusinessDate(value: string, direction: -1 | 1): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Fecha ISO inválida: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error(`Fecha ISO inválida: ${value}`);
  }
  do {
    date.setUTCDate(date.getUTCDate() + direction);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) return date.toISOString().slice(0, 10);
  } while (true);
}

export function previousBusinessDate(value: string): string {
  return shiftBusinessDate(value, -1);
}

export function nextBusinessDate(value: string): string {
  return shiftBusinessDate(value, 1);
}
