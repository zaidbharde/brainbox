import { useCallback, useEffect, useRef, useState } from 'react';

type DemoStatePayload = Record<string, unknown>;

type UseTeacherDemoModeProps = {
  appId: string;
  onState?: (payload: DemoStatePayload) => void;
};

function resolveWsUrl(hostname: string, appId: string, role: 'teacher' | 'student'): string {
  return `ws://${hostname}:4100/ws/demo?role=${encodeURIComponent(role)}&app=${encodeURIComponent(appId)}`;
}

export function useTeacherDemoMode({ appId, onState }: UseTeacherDemoModeProps) {
  const [mode, setMode] = useState<'off' | 'teacher' | 'student'>('off');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [localIp, setLocalIp] = useState('');
  const [teacherIp, setTeacherIp] = useState('');
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, []);

  const connect = useCallback((role: 'teacher' | 'student', host: string) => {
    disconnect();
    setError('');
    setConnectionStatus('connecting');

    const ws = new WebSocket(resolveWsUrl(host, appId, role));
    socketRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    ws.onerror = () => {
      setConnectionStatus('disconnected');
      setError('Unable to connect demo socket.');
    };

    ws.onmessage = (event: MessageEvent) => {
      let message: { type?: string; payload?: DemoStatePayload };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.type === 'hello') {
        if (typeof message.payload?.primaryIp === 'string') {
          setLocalIp(message.payload.primaryIp);
        }
        return;
      }

      if (message.type === 'state' && role === 'student') {
        onState?.(message.payload || {});
        return;
      }

      if (message.type === 'teacher-offline') {
        setError('Teacher disconnected.');
      }
    };
  }, [appId, disconnect, onState]);

  const startTeacher = useCallback(async () => {
    setMode('teacher');
    try {
      const response = await fetch('http://127.0.0.1:4100/api/demo/network');
      const payload = await response.json();
      if (response.ok && typeof payload?.primaryIp === 'string') {
        setLocalIp(payload.primaryIp);
      }
    } catch {
      // ignore, websocket hello can still provide local ip
    }
    connect('teacher', window.location.hostname || '127.0.0.1');
  }, [connect]);

  const joinTeacher = useCallback((ip: string) => {
    const cleanIp = ip.trim();
    if (!cleanIp) {
      setError('Teacher IP is required.');
      return;
    }
    setTeacherIp(cleanIp);
    setMode('student');
    connect('student', cleanIp);
  }, [connect]);

  const stopDemo = useCallback(() => {
    setMode('off');
    setTeacherIp('');
    setError('');
    disconnect();
  }, [disconnect]);

  const broadcastState = useCallback((payload: DemoStatePayload) => {
    if (mode !== 'teacher' || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'state', payload }));
  }, [mode]);

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  return {
    mode,
    connectionStatus,
    localIp,
    teacherIp,
    error,
    startTeacher,
    joinTeacher,
    stopDemo,
    broadcastState,
    isTeacher: mode === 'teacher',
    isStudent: mode === 'student',
  };
}
