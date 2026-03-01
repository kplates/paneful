let timer: ReturnType<typeof setTimeout> | null = null;
let pending: object | null = null;

export function persistSettings(partial: object): void {
  pending = pending ? { ...pending, ...partial } : { ...partial };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const body = pending;
    pending = null;
    timer = null;
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, 300);
}
