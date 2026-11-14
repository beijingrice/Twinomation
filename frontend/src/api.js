import { useEffect, useRef, useState } from 'react';

const clientHeaders = { 'Content-Type': 'application/json', 'X-Twinomation-Client': 'local-demo' };

export async function api(path, { token, method = 'GET', body, key, signal } = {}) {
  const response = await fetch('/api' + path, {
    method, signal,
    headers: { ...clientHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The service is unavailable. Please try again.'); }
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function useLive(path, token, onRefresh) {
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let retryTimer;
    async function connect() {
      setStatus('connecting');
      let reconnectDelay = 4000;
      let fallbackStatus = 'offline';
      try {
        const response = await fetch('/api' + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
        if (response.status === 429) { reconnectDelay = 30000; fallbackStatus = 'polling'; }
        if (!response.ok || !response.body) throw new Error('Live view unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setStatus('live');
        refresh.current();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (message.includes('event: unavailable')) throw new Error('Session unavailable');
            if (message.includes('event: refresh')) refresh.current();
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) {
        setStatus(fallbackStatus);
        retryTimer = setTimeout(connect, reconnectDelay);
      }
    }
    connect();
    const poll = setInterval(() => refresh.current(), 30000);
    const visibility = () => { if (!document.hidden) refresh.current(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [path, token]);
  return status;
}
